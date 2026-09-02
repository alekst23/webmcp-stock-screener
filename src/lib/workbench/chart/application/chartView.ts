// How a chart draws what it shows: candle type, price scale, trading session
// and price-adjustment policy. This is the view half of the chart contract; the
// source half (instrument, timeframe, range, comparisons) lives in
// `chartSource.ts`.
//
// An agent reaches this logic through the generic `configure_panel_view` tool,
// which validates through the renderer-type definition in
// `../tools/chartRendererContract` and mutates through the
// `chart.configure_view` operation registered here. Both entry points call
// `validateChartViewPatch`, so the registry's answer and the mutation's answer
// are the same answer.
//
// Two of these four are not cosmetic. The session decides which bars exist at
// all, and the price-adjustment policy restates every price on the chart --
// bars, study values, annotation anchors and every read -- so both invalidate
// cached data when they change.
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import { OperationValidationError } from '../../domain/errors';
import type { WorkspaceDocument } from '../../domain/workspace';
import {
	applyChartConfigPatch,
	isChartCandleType,
	isChartPriceAdjustment,
	isChartScale,
	isChartSession,
	readChartState,
	writeChartState,
	CHART_CANDLE_TYPES,
	CHART_PRICE_ADJUSTMENTS,
	CHART_SCALES,
	CHART_SESSIONS,
	DEFAULT_CHART_CANDLE_TYPE,
	DEFAULT_CHART_PRICE_ADJUSTMENT,
	DEFAULT_CHART_SCALE,
	DEFAULT_CHART_SESSION,
	type ChartCandleType,
	type ChartPriceAdjustment,
	type ChartScale,
	type ChartSession
} from '../domain/chartState';
// Shared with the source half rather than duplicated; T-1011-9 reconciles where
// these common chart-application helpers finally live.
import {
	describeChartDataInvalidation,
	summarizeChartChanges,
	validateChartPanelTarget
} from './chartSource';

export const CHART_CONFIGURE_VIEW_KIND = 'chart.configure_view';

export interface ChartViewInput {
	panelId: string;
	candleType?: ChartCandleType;
	scale?: ChartScale;
	session?: ChartSession;
	priceAdjustment?: ChartPriceAdjustment;
}

const PRICE_ADJUSTMENT_DESCRIPTION =
	'The basis every price on this chart is stated on: "adjusted" (splits and dividends), ' +
	'"split_adjusted" (splits only) or "unadjusted" (as traded). It is not a display ' +
	'setting -- it restates every downstream price: bars, study values, annotation anchors ' +
	'and every read of this chart. Changing it invalidates cached bars and study output.';

// The renderer's own configuration, describing the wire shape (snake_case).
// Shared verbatim by the operation's input schema, which adds `panel_id`.
export const CHART_VIEW_CONFIG_SCHEMA = {
	type: 'object',
	description:
		'How a chart panel draws its series. Only the properties named are changed; every ' +
		'other property of the chart is left exactly as it was. What the chart shows -- ' +
		'instrument, timeframe, range, comparisons -- is a source concern, set through ' +
		'bind_panel_source.',
	properties: {
		candle_type: {
			type: 'string',
			enum: Object.keys(CHART_CANDLE_TYPES),
			description: 'How each bar is drawn.'
		},
		scale: {
			type: 'string',
			enum: Object.keys(CHART_SCALES),
			description: 'Price axis scale.'
		},
		session: {
			type: 'string',
			enum: Object.keys(CHART_SESSIONS),
			description:
				'Which trading session the bars cover. Changing it changes which bars exist, ' +
				'so it invalidates cached bars and study output.'
		},
		price_adjustment: {
			type: 'string',
			enum: Object.keys(CHART_PRICE_ADJUSTMENTS),
			description: PRICE_ADJUSTMENT_DESCRIPTION
		}
	}
};

export const CHART_CONFIGURE_VIEW_SCHEMA = {
	type: 'object',
	description: CHART_VIEW_CONFIG_SCHEMA.description,
	required: ['panel_id'],
	properties: {
		panel_id: { type: 'string', description: 'The chart panel to configure.' },
		...CHART_VIEW_CONFIG_SCHEMA.properties
	}
};

const VIEW_FIELDS: readonly { wire: string; key: keyof ChartViewInput }[] = [
	{ wire: 'candle_type', key: 'candleType' },
	{ wire: 'scale', key: 'scale' },
	{ wire: 'session', key: 'session' },
	{ wire: 'price_adjustment', key: 'priceAdjustment' }
];

const SOURCE_ONLY_KEYS: ReadonlySet<string> = new Set([
	'instrument',
	'timeframe',
	'range',
	'add_comparisons',
	'addComparisons',
	'remove_comparisons',
	'removeComparisons',
	'comparisons'
]);

const VIEW_WIRE_KEYS = 'candle_type, scale, session, price_adjustment';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function permitted(field: string, value: unknown, allowed: Record<string, true>): string {
	return `${field}: "${String(value)}" is not permitted. Permitted: ${Object.keys(allowed).join(', ')}.`;
}

// Shape-level validation of the fields a view patch may carry. Every field is
// optional: naming one property must not force the caller to restate the rest.
export function validateChartViewPatch(input: Partial<ChartViewInput>): string[] {
	const raw = input as Record<string, unknown>;
	const issues: string[] = [];
	if (raw.candleType !== undefined && !isChartCandleType(raw.candleType)) {
		issues.push(permitted('candle_type', raw.candleType, CHART_CANDLE_TYPES));
	}
	if (raw.scale !== undefined && !isChartScale(raw.scale)) {
		issues.push(permitted('scale', raw.scale, CHART_SCALES));
	}
	if (raw.session !== undefined && !isChartSession(raw.session)) {
		issues.push(permitted('session', raw.session, CHART_SESSIONS));
	}
	if (raw.priceAdjustment !== undefined && !isChartPriceAdjustment(raw.priceAdjustment)) {
		issues.push(permitted('price_adjustment', raw.priceAdjustment, CHART_PRICE_ADJUSTMENTS));
	}
	return issues;
}

function validateUnknownKeys(raw: Record<string, unknown>, allowPanelId: boolean): string[] {
	const known = new Set<string>(VIEW_FIELDS.flatMap((field) => [field.wire, field.key as string]));
	if (allowPanelId) {
		known.add('panel_id');
		known.add('panelId');
	}
	return Object.keys(raw)
		.filter((key) => !known.has(key))
		.map((key) =>
			SOURCE_ONLY_KEYS.has(key)
				? `${key}: is a chart source property, not a view property. Set it through ` +
					'bind_panel_source instead.'
				: `${key}: is not a chart view property. Permitted: ${VIEW_WIRE_KEYS}.`
		);
}

// The one place the wire's snake_case becomes the camelCase this module works
// with. Accepts either casing and leaves malformed values alone for the
// validators.
export function parseChartViewInput(raw: unknown): ChartViewInput {
	const src = isRecord(raw) ? raw : {};
	const out: Record<string, unknown> = { panelId: src.panel_id ?? src.panelId };
	for (const field of VIEW_FIELDS) {
		const value = src[field.wire] ?? src[field.key as string];
		if (value !== undefined) {
			out[field.key] = value;
		}
	}
	return out as unknown as ChartViewInput;
}

// What a chart panel is drawn with before anyone configures it. Recorded rather
// than implied, so a payload never has to say "whatever the default is".
export function defaultChartViewConfig(): Record<string, unknown> {
	return {
		candle_type: DEFAULT_CHART_CANDLE_TYPE,
		scale: DEFAULT_CHART_SCALE,
		session: DEFAULT_CHART_SESSION,
		price_adjustment: DEFAULT_CHART_PRICE_ADJUSTMENT
	};
}

// The registry entry point: a renderer configuration checked without a
// workspace document. An absent property is valid -- the default applies -- but
// a property that belongs to the source half is not, because silently ignoring
// it would leave the caller believing the chart was pointed somewhere it isn't.
export function validateChartViewConfig(config: unknown): string[] {
	if (!isRecord(config)) {
		return ['config: expected an object of chart view properties.'];
	}
	const issues = validateUnknownKeys(config, false);
	return issues.length > 0 ? issues : validateChartViewPatch(parseChartViewInput(config));
}

function validateConfigureView(raw: unknown, doc: WorkspaceDocument): string[] {
	const issues = isRecord(raw) ? validateUnknownKeys(raw, true) : ['input: expected an object.'];
	if (issues.length > 0) {
		return issues;
	}
	const input = parseChartViewInput(raw);
	issues.push(...validateChartPanelTarget(doc, input.panelId));
	issues.push(...validateChartViewPatch(input));
	return issues;
}

function viewPatch(input: ChartViewInput): Partial<ChartViewInput> {
	return {
		candleType: input.candleType,
		scale: input.scale,
		session: input.session,
		priceAdjustment: input.priceAdjustment
	};
}

// Called by preview even for input that failed validation, so it never throws.
function describeConfigureView(raw: unknown, doc: WorkspaceDocument): string {
	const input = parseChartViewInput(raw);
	if (validateChartPanelTarget(doc, input.panelId).length > 0) {
		return `Cannot configure a chart view: "${String(input.panelId)}" is not a chart panel.`;
	}
	const transition = applyChartConfigPatch(
		readChartState(doc, input.panelId).config,
		viewPatch(input)
	);
	return transition.ok
		? summarizeChartChanges(input.panelId, transition.changes, 'Configured')
		: `Cannot configure the view of chart ${input.panelId}: ${transition.issues.join(' ')}`;
}

function applyConfigureView(raw: unknown, doc: WorkspaceDocument): MutationDraft {
	const input = parseChartViewInput(raw);
	const state = readChartState(doc, input.panelId);
	const transition = applyChartConfigPatch(state.config, viewPatch(input));
	if (!transition.ok) {
		throw new OperationValidationError(transition.issues);
	}
	const invalidation = describeChartDataInvalidation(input.panelId, transition.changes);
	const summary = summarizeChartChanges(input.panelId, transition.changes, 'Configured');
	return {
		document: writeChartState(doc, { ...state, config: transition.config }),
		affectedIds: [input.panelId],
		// The invalidation notice rides in the summary as well as in the warnings
		// because a collection apply merges per-operation drafts and keeps only
		// the diff summary; a cache that is no longer valid has to reach the
		// caller either way.
		diffSummary: invalidation ? `${summary} ${invalidation}` : summary,
		warnings: invalidation ? [invalidation] : [],
		// The pre-mutation document is the inverse: chart state is a value, so
		// restoring it restores the configuration exactly.
		inverse: {
			document: doc,
			affectedIds: [input.panelId],
			diffSummary: `Reverted the view of chart ${input.panelId}.`
		}
	};
}

export function createChartConfigureViewOperation(): OperationDefinition<ChartViewInput> {
	return {
		kind: CHART_CONFIGURE_VIEW_KIND,
		inputSchema: CHART_CONFIGURE_VIEW_SCHEMA,
		validate: (input, doc) => validateConfigureView(input, doc),
		describe: (input, doc) => describeConfigureView(input, doc),
		apply: (input, doc) => applyConfigureView(input, doc)
	};
}

export function registerChartConfigureViewOperation(registry: OperationRegistry): void {
	registry.register(createChartConfigureViewOperation());
}
