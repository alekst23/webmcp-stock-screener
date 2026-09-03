// Binding a chart panel to what it shows: instrument, timeframe, visible range
// and comparison series. This is the source half of the chart contract; the
// view half (candle type, scale, session, price-adjustment policy) lives in
// `chartView.ts`.
//
// There is no standalone chart configuration tool. An agent reaches this logic
// through the generic `bind_panel_source` tool, which validates through the
// source-type definition in `../tools/chartRendererContract` and mutates
// through the `chart.bind_source` operation registered here. Both entry points
// call the same exported validators, so they cannot drift apart.
//
// Registering as an OperationDefinition is what supplies expected-revision
// checking, idempotency replay, the mutation envelope and a working undo token.
// None of that is reimplemented here: a draft returned with a non-null
// `inverse` is everything undo needs.
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import { OperationValidationError } from '../../domain/errors';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import {
	addComparison,
	applyChartConfigPatch,
	createChartConfig,
	invalidatesChartData,
	isChartTimeframe,
	readChartState,
	removeComparison,
	validateChartRange,
	writeChartState,
	CHART_DATA_INVALIDATING_FIELDS,
	CHART_TIMEFRAMES,
	RELATIVE_RANGE_TOKENS,
	type ChartConfig,
	type ChartConfigChange,
	type ChartRange,
	type ChartTimeframe,
	type RelativeRangeToken
} from '../domain/chartState';
import {
	validateInstrumentRef,
	validateNormalization,
	DEFAULT_NORMALIZATION,
	type ComparisonRef,
	type InstrumentRef,
	type Normalization
} from '../domain/instrument';

export const CHART_BIND_SOURCE_KIND = 'chart.bind_source';

export interface ChartComparisonInput {
	instrument: InstrumentRef;
	// Omitted means the documented default, which the result reports rather
	// than applying silently.
	normalization?: Normalization;
}

export interface ChartSourceInput {
	panelId: string;
	instrument?: InstrumentRef;
	timeframe?: ChartTimeframe;
	range?: ChartRange;
	addComparisons?: ChartComparisonInput[];
	removeComparisons?: string[];
}

// What a bound chart source looks like as a whole, as opposed to a patch of it:
// a source that names no instrument is not a binding.
export interface ChartSourceReference {
	instrument: InstrumentRef;
	timeframe?: ChartTimeframe;
	range?: ChartRange;
	comparisons?: ChartComparisonInput[];
}

export interface InstrumentDataWindow {
	start: string;
	end: string;
}

// Answers the two questions the workspace document cannot: whether an
// instrument exists at all, and what it has data for. Synchronous on purpose --
// operation validation is synchronous, so the async bars port cannot serve
// here. An implementation that does not know a window returns null rather than
// guessing one.
export interface InstrumentAvailability {
	isKnownInstrument(instrumentId: string): boolean;
	dataWindow(instrumentId: string): InstrumentDataWindow | null;
}

export interface ChartSourceDeps {
	// Absent when nothing can answer availability yet: the checks are then
	// skipped, because rejecting every instrument as unknown is worse than not
	// checking.
	availability?: InstrumentAvailability;
	clock?: Clock;
}

const INSTRUMENT_REF_SCHEMA = {
	type: 'object',
	description:
		'A resolved instrument reference. The instrument is named by ID (for example ' +
		'"inst:XNAS:AAPL"), never by ticker -- resolve a ticker through instrument search first.',
	required: ['instrument_id', 'symbol', 'exchange', 'asset_type'],
	properties: {
		instrument_id: {
			type: 'string',
			description: 'Canonical instrument ID. A bare ticker such as "AAPL" is rejected.'
		},
		symbol: { type: 'string', description: 'Display ticker. Identity, not identifier.' },
		exchange: { type: 'string', description: 'ISO 10383 MIC of the listing venue.' },
		asset_type: {
			type: 'string',
			description: 'equity, etf, adr, fund, index, future, fx, crypto.'
		}
	}
};

const NORMALIZATION_SCHEMA = {
	type: 'object',
	description:
		'How a comparison series is rescaled onto the primary series. Omit it and the ' +
		'default (mode "none", anchor "window_start") is applied and reported in the result.',
	properties: {
		mode: { type: 'string', enum: ['none', 'percent_change', 'indexed_100', 'z_score'] },
		anchor: { type: 'string', enum: ['window_start', 'anchor_bar'] }
	}
};

export const CHART_SOURCE_RANGE_SCHEMA = {
	description:
		'The visible range, either an explicit ISO 8601 {start, end} window or a relative ' +
		'token. Changing it invalidates cached bars and study output for this chart.',
	oneOf: [
		{
			type: 'object',
			required: ['kind', 'start', 'end'],
			properties: {
				kind: { const: 'explicit' },
				start: { type: 'string', description: 'ISO 8601 instant or date.' },
				end: { type: 'string', description: 'ISO 8601 instant or date, after start.' }
			}
		},
		{
			type: 'object',
			required: ['kind', 'token'],
			properties: {
				kind: { const: 'relative' },
				token: { type: 'string', enum: Object.keys(RELATIVE_RANGE_TOKENS) }
			}
		}
	]
};

const TIMEFRAME_SCHEMA = {
	type: 'string',
	enum: Object.keys(CHART_TIMEFRAMES),
	description: 'Bar interval. Changing it invalidates cached bars and study output.'
};

const COMPARISON_ITEM_SCHEMA = {
	type: 'object',
	required: ['instrument'],
	properties: { instrument: INSTRUMENT_REF_SCHEMA, normalization: NORMALIZATION_SCHEMA }
};

const SOURCE_DESCRIPTION =
	'What a chart panel shows: instrument, timeframe, visible range and comparison series. ' +
	'The instrument is named by ID, never by ticker. How the chart draws them -- candle ' +
	'type, scale, session, price-adjustment policy -- is a view concern, set through ' +
	'configure_panel_view.';

// Describes the wire shape (snake_case). `parseChartSourceInput` is the single
// place that shape is turned into the camelCase input the operation works with.
export const CHART_BIND_SOURCE_SCHEMA = {
	type: 'object',
	description:
		`${SOURCE_DESCRIPTION} Only the properties named are changed; every other property ` +
		'of the chart is left exactly as it was.',
	required: ['panel_id'],
	properties: {
		panel_id: { type: 'string', description: 'The chart panel to bind.' },
		instrument: INSTRUMENT_REF_SCHEMA,
		timeframe: TIMEFRAME_SCHEMA,
		range: CHART_SOURCE_RANGE_SCHEMA,
		add_comparisons: {
			type: 'array',
			description: 'Comparison instruments to draw beside the primary series.',
			items: COMPARISON_ITEM_SCHEMA
		},
		remove_comparisons: {
			type: 'array',
			description: 'Instrument IDs of comparisons to remove from this chart.',
			items: { type: 'string' }
		}
	}
};

// A whole binding rather than a patch of one, which is what the panel registry
// advertises as this source type's shape: an instrument is required, and the
// comparison edits (which only mean anything against an existing chart) are
// replaced by the comparison list itself.
export const CHART_SOURCE_REFERENCE_SCHEMA = {
	type: 'object',
	description: SOURCE_DESCRIPTION,
	required: ['instrument'],
	properties: {
		instrument: INSTRUMENT_REF_SCHEMA,
		timeframe: TIMEFRAME_SCHEMA,
		range: CHART_SOURCE_RANGE_SCHEMA,
		comparisons: {
			type: 'array',
			description: 'Comparison instruments drawn beside the primary series.',
			items: COMPARISON_ITEM_SCHEMA
		}
	}
};

const SOURCE_INPUT_KEYS: ReadonlySet<string> = new Set([
	'panel_id',
	'panelId',
	'instrument',
	'timeframe',
	'range',
	'add_comparisons',
	'addComparisons',
	'remove_comparisons',
	'removeComparisons'
]);

const VIEW_ONLY_KEYS: ReadonlySet<string> = new Set([
	'candle_type',
	'candleType',
	'scale',
	'session',
	'price_adjustment',
	'priceAdjustment'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

// camelCase identifiers, snake_case on the wire: a rejection has to name the
// field the caller actually wrote.
export function toWireFieldName(field: string): string {
	return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function validateChartPanelTarget(
	doc: WorkspaceDocument,
	panelId: unknown,
	field = 'panel_id'
): string[] {
	if (typeof panelId !== 'string' || panelId.length === 0) {
		return [`${field}: expected the ID of a chart panel in this workspace.`];
	}
	const panel = doc.panels.find((entry) => entry.id === panelId);
	if (!panel) {
		const charts = doc.panels.filter((entry) => entry.kind === 'chart').map((entry) => entry.id);
		return [
			`${field}: "${panelId}" is not a panel in this workspace. ` +
				`Chart panels here: ${charts.length > 0 ? charts.join(', ') : 'none'}.`
		];
	}
	if (panel.kind !== 'chart') {
		return [`${field}: panel "${panelId}" is a ${panel.kind} panel, not a chart panel.`];
	}
	return [];
}

// A ticker string where an instrument reference belongs is the single most
// likely caller mistake, and the generic "expected an object" would not tell
// them what to do about it.
function validateInstrumentInput(value: unknown, field: string): string[] {
	if (typeof value === 'string') {
		return [
			`${field}: "${value}" is a ticker, not an instrument ID. Resolve it through ` +
				'instrument search first and pass the resolved instrument reference; a bare ticker ' +
				'is never accepted.'
		];
	}
	return validateInstrumentRef(value, field);
}

function validateComparisonInputs(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		return [`${field}: expected an array of comparison instruments.`];
	}
	const issues: string[] = [];
	value.forEach((entry, index) => {
		const path = `${field}[${index}]`;
		if (!isRecord(entry)) {
			issues.push(`${path}: expected an object with an instrument and an optional normalization.`);
			return;
		}
		issues.push(...validateInstrumentInput(entry.instrument, `${path}.instrument`));
		if (entry.normalization !== undefined) {
			issues.push(...validateNormalization(entry.normalization, `${path}.normalization`));
		}
	});
	return issues;
}

const SOURCE_WIRE_KEYS =
	'panel_id, instrument, timeframe, range, add_comparisons, remove_comparisons';

function validateUnknownKeys(raw: Record<string, unknown>): string[] {
	return Object.keys(raw)
		.filter((key) => !SOURCE_INPUT_KEYS.has(key))
		.map((key) =>
			VIEW_ONLY_KEYS.has(key)
				? `${key}: is a chart view property, not a source property. Set it through ` +
					'configure_panel_view instead.'
				: `${key}: is not a chart source property. Permitted: ${SOURCE_WIRE_KEYS}.`
		);
}

// Shape-level validation of the fields a source patch may carry. Every field is
// optional here: naming one property must not force the caller to restate the
// rest (the "partial update" rule).
export function validateChartSourcePatch(input: Partial<ChartSourceInput>): string[] {
	const raw = input as Record<string, unknown>;
	const issues: string[] = [];
	if (raw.instrument !== undefined) {
		issues.push(...validateInstrumentInput(raw.instrument, 'instrument'));
	}
	if (raw.timeframe !== undefined && !isChartTimeframe(raw.timeframe)) {
		issues.push(
			`timeframe: "${String(raw.timeframe)}" is not a supported timeframe. Permitted: ` +
				`${Object.keys(CHART_TIMEFRAMES).join(', ')}.`
		);
	}
	if (raw.range !== undefined) {
		issues.push(...validateChartRange(raw.range, 'range'));
	}
	if (raw.addComparisons !== undefined) {
		issues.push(...validateComparisonInputs(raw.addComparisons, 'add_comparisons'));
	}
	if (raw.removeComparisons !== undefined && !Array.isArray(raw.removeComparisons)) {
		issues.push('remove_comparisons: expected an array of instrument IDs.');
	}
	return issues;
}

const RELATIVE_RANGE_DAYS: Record<Exclude<RelativeRangeToken, 'ytd' | 'max'>, number> = {
	'1d': 1,
	'5d': 5,
	'1mo': 31,
	'3mo': 92,
	'6mo': 183,
	'1y': 366,
	'2y': 731,
	'5y': 1827
};

const DAY_MS = 86_400_000;

// A relative range has to become a concrete window before it can be checked
// against what an instrument actually has data for.
export function resolveChartRange(range: ChartRange, nowIso: string): InstrumentDataWindow {
	if (range.kind === 'explicit') {
		return { start: range.start, end: range.end };
	}
	const parsed = Date.parse(nowIso);
	const now = Number.isNaN(parsed) ? Date.now() : parsed;
	const end = new Date(now).toISOString();
	if (range.token === 'max') {
		return { start: new Date(0).toISOString(), end };
	}
	if (range.token === 'ytd') {
		return { start: new Date(Date.UTC(new Date(now).getUTCFullYear(), 0, 1)).toISOString(), end };
	}
	return { start: new Date(now - RELATIVE_RANGE_DAYS[range.token] * DAY_MS).toISOString(), end };
}

function comparisonInstruments(config: ChartConfig): { field: string; ref: InstrumentRef }[] {
	return config.comparisons.map((comparison, index) => ({
		field: `comparisons[${index}].instrument`,
		ref: comparison.instrument
	}));
}

function validateRangeCoverage(
	config: ChartConfig,
	instrument: InstrumentRef,
	deps: ChartSourceDeps
): string[] {
	const coverage = deps.availability?.dataWindow(instrument.instrumentId) ?? null;
	if (!coverage) {
		return [];
	}
	const window = resolveChartRange(config.range, deps.clock?.now() ?? new Date().toISOString());
	const overlaps =
		Date.parse(window.start) <= Date.parse(coverage.end) &&
		Date.parse(window.end) >= Date.parse(coverage.start);
	return overlaps
		? []
		: [
				`range: no data is available for "${instrument.instrumentId}" between ` +
					`${window.start} and ${window.end}. ${instrument.symbol} has data from ` +
					`${coverage.start} to ${coverage.end}.`
			];
}

// The two checks the document cannot answer on its own. Skipped wholesale when
// no availability oracle is wired up.
export function validateSourceAvailability(config: ChartConfig, deps: ChartSourceDeps): string[] {
	const availability = deps.availability;
	if (!availability || !config.instrument) {
		return [];
	}
	const targets = [
		{ field: 'instrument', ref: config.instrument },
		...comparisonInstruments(config)
	];
	const unknown = targets
		.filter((target) => !availability.isKnownInstrument(target.ref.instrumentId))
		.map(
			(target) =>
				`${target.field}.instrument_id: "${target.ref.instrumentId}" is not a known ` +
				'instrument. Resolve it through instrument search first.'
		);
	return unknown.length > 0 ? unknown : validateRangeCoverage(config, config.instrument, deps);
}

interface ChartSourceTransition {
	config: ChartConfig;
	changes: ChartConfigChange[];
	warnings: string[];
}

type TransitionResult =
	{ ok: true; transition: ChartSourceTransition } | { ok: false; issues: string[] };

function defaultNormalizationWarning(instrument: InstrumentRef): string {
	return (
		`Comparison ${instrument.symbol} (${instrument.instrumentId}) was added without a ` +
		`normalization, so the default mode "${DEFAULT_NORMALIZATION.mode}" anchored at ` +
		`"${DEFAULT_NORMALIZATION.anchor}" was applied.`
	);
}

// Folds the patch and the comparison edits through the domain transitions in a
// fixed order -- removals before additions, so a caller can swap a comparison
// for another in one call.
function buildSourceTransition(config: ChartConfig, input: ChartSourceInput): TransitionResult {
	const patched = applyChartConfigPatch(config, {
		instrument: input.instrument,
		timeframe: input.timeframe,
		range: input.range
	});
	if (!patched.ok) {
		return { ok: false, issues: patched.issues };
	}
	let current = patched.config;
	const changes = [...patched.changes];
	const warnings: string[] = [];
	for (const instrumentId of asArray(input.removeComparisons)) {
		const step = removeComparison(current, String(instrumentId));
		if (!step.ok) {
			return { ok: false, issues: step.issues };
		}
		current = step.config;
		changes.push(...step.changes);
	}
	for (const entry of asArray(input.addComparisons) as ChartComparisonInput[]) {
		const normalization = entry?.normalization ?? DEFAULT_NORMALIZATION;
		// `describe` runs on unvalidated input too, so a malformed entry has to
		// reach addComparison's own validation rather than crash on the way.
		const step = addComparison(current, {
			instrument: entry?.instrument,
			normalization
		} as ComparisonRef);
		if (!step.ok) {
			return { ok: false, issues: step.issues };
		}
		if (entry?.normalization === undefined) {
			warnings.push(defaultNormalizationWarning(entry.instrument));
		}
		current = step.config;
		changes.push(...step.changes);
	}
	return { ok: true, transition: { config: current, changes, warnings } };
}

function changedFields(changes: readonly ChartConfigChange[]): string[] {
	return [...new Set(changes.map((change) => change.field))];
}

function describeConfigValue(field: string, value: unknown): string {
	if (field === 'instrument') {
		return value ? (value as InstrumentRef).instrumentId : 'none';
	}
	if (field === 'range') {
		const range = value as ChartRange;
		return range.kind === 'explicit' ? `${range.start}..${range.end}` : range.token;
	}
	if (field === 'comparisons') {
		const comparisons = value as ComparisonRef[];
		return comparisons.length === 0
			? 'no comparisons'
			: comparisons.map((entry) => entry.instrument.symbol).join(' + ');
	}
	return String(value);
}

// Shared with `chartView.ts`, which summarizes the other half of the same
// config with the same vocabulary.
export function summarizeChartChanges(
	panelId: string,
	changes: readonly ChartConfigChange[],
	verb: string
): string {
	if (changes.length === 0) {
		return `Chart ${panelId} was already configured that way; nothing changed.`;
	}
	const parts = changedFields(changes).map((field) => {
		const last = [...changes].reverse().find((change) => change.field === field);
		return `${toWireFieldName(field)} -> ${describeConfigValue(field, last?.to)}`;
	});
	return `${verb} chart ${panelId}: ${parts.join(', ')}.`;
}

// Cached bars and every study value derived from them stop being valid the
// moment the series they were computed from changes. There is no bar cache to
// evict yet, so the contract is the report: the caller is told, in the same
// envelope, that a subsequent read reflects the new configuration.
export function describeChartDataInvalidation(
	panelId: string,
	changes: readonly ChartConfigChange[]
): string | null {
	if (!invalidatesChartData(changes)) {
		return null;
	}
	const fields = changedFields(changes)
		.filter((field) => CHART_DATA_INVALIDATING_FIELDS.includes(field))
		.map(toWireFieldName);
	return (
		`Cached bars and study output for chart ${panelId} are invalidated because ` +
		`${fields.join(', ')} changed; a subsequent read reflects the new configuration.`
	);
}

function parseInstrumentRefInput(raw: unknown): unknown {
	if (!isRecord(raw)) {
		// Passed through unchanged so a bare ticker reaches the validator that
		// knows what to tell the caller about it.
		return raw;
	}
	return {
		instrumentId: raw.instrument_id ?? raw.instrumentId,
		symbol: raw.symbol,
		exchange: raw.exchange,
		assetType: raw.asset_type ?? raw.assetType
	};
}

function parseComparisonInputs(raw: unknown): unknown {
	if (!Array.isArray(raw)) {
		return raw;
	}
	return raw.map((entry) =>
		isRecord(entry)
			? {
					instrument: parseInstrumentRefInput(entry.instrument),
					normalization: entry.normalization
				}
			: entry
	);
}

// The one place the wire's snake_case becomes the camelCase this module works
// with. Accepts either casing so a caller that already speaks TypeScript keys
// is not punished, and leaves malformed values alone for the validators.
export function parseChartSourceInput(raw: unknown): ChartSourceInput {
	const src = isRecord(raw) ? raw : {};
	const out: Record<string, unknown> = { panelId: src.panel_id ?? src.panelId };
	if (src.instrument !== undefined) {
		out.instrument = parseInstrumentRefInput(src.instrument);
	}
	if (src.timeframe !== undefined) {
		out.timeframe = src.timeframe;
	}
	if (src.range !== undefined) {
		out.range = src.range;
	}
	const added = src.add_comparisons ?? src.addComparisons;
	if (added !== undefined) {
		out.addComparisons = parseComparisonInputs(added);
	}
	const removed = src.remove_comparisons ?? src.removeComparisons;
	if (removed !== undefined) {
		out.removeComparisons = removed;
	}
	return out as unknown as ChartSourceInput;
}

// The registry entry point: a whole source binding rather than a patch of one,
// checked without a workspace document. Delegates to exactly the validators the
// operation uses, so the registry and the mutation cannot disagree.
export function validateChartSourceReference(
	reference: unknown,
	deps: ChartSourceDeps = {}
): string[] {
	if (!isRecord(reference)) {
		return ['source_reference: expected an object naming an instrument by ID.'];
	}
	const comparisons = reference.comparisons ?? reference.add_comparisons;
	const input = parseChartSourceInput({ ...reference, add_comparisons: comparisons });
	const issues =
		reference.instrument === undefined
			? [
					'instrument: a chart source must name an instrument by ID (for example ' +
						'"inst:XNAS:AAPL"); resolve a ticker through instrument search first.'
				]
			: [];
	issues.push(...validateChartSourcePatch(input));
	if (issues.length > 0) {
		return issues;
	}
	const result = buildSourceTransition(createChartConfig('panel_reference'), input);
	return result.ok ? validateSourceAvailability(result.transition.config, deps) : result.issues;
}

function validateBindSource(raw: unknown, doc: WorkspaceDocument, deps: ChartSourceDeps): string[] {
	const issues = isRecord(raw) ? validateUnknownKeys(raw) : ['input: expected an object.'];
	if (issues.length > 0) {
		return issues;
	}
	const input = parseChartSourceInput(raw);
	issues.push(...validateChartPanelTarget(doc, input.panelId));
	issues.push(...validateChartSourcePatch(input));
	if (issues.length > 0) {
		return issues;
	}
	const result = buildSourceTransition(readChartState(doc, input.panelId).config, input);
	return result.ok ? validateSourceAvailability(result.transition.config, deps) : result.issues;
}

// Called by preview even for input that failed validation, so it never throws.
function describeBindSource(raw: unknown, doc: WorkspaceDocument): string {
	const input = parseChartSourceInput(raw);
	if (validateChartPanelTarget(doc, input.panelId).length > 0) {
		return `Cannot bind a chart source: "${String(input.panelId)}" is not a chart panel.`;
	}
	const result = buildSourceTransition(readChartState(doc, input.panelId).config, input);
	return result.ok
		? summarizeChartChanges(input.panelId, result.transition.changes, 'Bound')
		: `Cannot bind the source of chart ${input.panelId}: ${result.issues.join(' ')}`;
}

// Exported (bug fix, see git history) so chart/registry/chartPanelKind.ts's
// SourceTypeDefinition.applyBinding can call the exact same apply logic the
// chart.bind_source *operation* itself uses (createChartBindSourceOperation
// below), reused verbatim rather than reimplemented, from the entry point
// (the generic bind_panel_source tool) that actually needed it -- this
// file's own header already documented that intent, it just had no caller
// until now.
export function applyBindSource(raw: unknown, doc: WorkspaceDocument): MutationDraft {
	const input = parseChartSourceInput(raw);
	const state = readChartState(doc, input.panelId);
	const result = buildSourceTransition(state.config, input);
	if (!result.ok) {
		throw new OperationValidationError(result.issues);
	}
	const { config, changes, warnings } = result.transition;
	const invalidation = describeChartDataInvalidation(input.panelId, changes);
	const notices = invalidation ? [...warnings, invalidation] : warnings;
	return {
		document: writeChartState(doc, { ...state, config }),
		affectedIds: [input.panelId],
		// The notices ride in the summary as well as in the warnings because a
		// collection apply merges per-operation drafts and keeps only the diff
		// summary; a default that was applied on the caller's behalf, or a cache
		// that is no longer valid, has to reach them either way.
		diffSummary: [summarizeChartChanges(input.panelId, changes, 'Bound'), ...notices].join(' '),
		warnings: notices,
		// The pre-mutation document is the inverse: chart state is a value, so
		// restoring it restores the configuration exactly.
		inverse: {
			document: doc,
			affectedIds: [input.panelId],
			diffSummary: `Reverted the source of chart ${input.panelId}.`
		}
	};
}

export function createChartBindSourceOperation(
	deps: ChartSourceDeps = {}
): OperationDefinition<ChartSourceInput> {
	return {
		kind: CHART_BIND_SOURCE_KIND,
		inputSchema: CHART_BIND_SOURCE_SCHEMA,
		validate: (input, doc) => validateBindSource(input, doc, deps),
		describe: (input, doc) => describeBindSource(input, doc),
		apply: (input, doc) => applyBindSource(input, doc)
	};
}

export function registerChartBindSourceOperation(
	registry: OperationRegistry,
	deps: ChartSourceDeps = {}
): void {
	registry.register(createChartBindSourceOperation(deps));
}
