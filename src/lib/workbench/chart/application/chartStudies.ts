// Editing the studies on a chart: adding, updating, reordering, toggling and
// removing instances, as one atomic batch.
//
// There is no `edit_chart_studies` tool. An agent reaches this through the
// generic `configure_panel_view` for a chart-rendered panel, which resolves to
// the renderer contract in `../tools/chartStudiesContract`, and the mutation
// half runs as the `chart.edit_studies` operation registered below. Registering
// there rather than committing directly is what gives every study edit
// `expected_revision`, `idempotency_key`, the mutation envelope, atomic apply
// and a working undo token -- none of that is reimplemented here.
//
// Nothing about a study's parameters is restated in this file. Defaults, valid
// ranges, enum members and cross-parameter constraints all come from the
// catalog by way of the study engine's resolver, so a catalog change takes
// effect here without an edit.

import { builtinCatalogRegistry, type CatalogRegistry } from '../../../catalog/registry';
import type { CatalogOutput, StudyItem } from '../../../catalog/types';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import { OperationValidationError } from '../../domain/errors';
import { createIdSequencer, type IdSequencer, type ResourceId } from '../../domain/ids';
import type { WorkspaceDocument } from '../../domain/workspace';
import {
	chartStateIdSeed,
	createChartState,
	readChartStateOrNull,
	writeChartState,
	type ChartConfig,
	type ChartState,
	type ChartTimeframe,
	type RelativeRangeToken
} from '../domain/chartState';
import {
	addStudy,
	removeStudy,
	reorderStudies,
	setStudyEnabled,
	toggleStudy,
	updateStudyParams,
	validateStudyInstance,
	type StudyInstance,
	type StudyPane,
	type StudyParamValue,
	type StudyTransition
} from '../domain/studies';
import {
	computeStudy,
	isStudySupported,
	resolveStudyParams,
	StudyParameterError,
	type OhlcvBar
} from '../domain/studyEngine';

export const CHART_EDIT_STUDIES_KIND = 'chart.edit_studies';

export interface ChartStudiesOptions {
	registry?: CatalogRegistry;
}

export type StudyOperation =
	| { op: 'add'; catalogItemId: string; params?: Record<string, StudyParamValue>; order?: number }
	| { op: 'update'; studyId: ResourceId; params: Record<string, StudyParamValue> }
	| { op: 'reorder'; orderedIds: ResourceId[] }
	| { op: 'toggle'; studyId: ResourceId; enabled?: boolean }
	| { op: 'remove'; studyId: ResourceId };

export interface EditChartStudiesInput {
	panelId: ResourceId;
	operations: StudyOperation[];
}

export interface StudyEditOutcome {
	studies: StudyInstance[];
	affectedIds: ResourceId[];
	changes: string[];
	warnings: string[];
	// Every instance the batch created or reparameterized, with its parameters
	// fully resolved -- this is where a caller reads the defaults the catalog
	// supplied for the ones it left out.
	resolvedParams: Record<ResourceId, Record<string, StudyParamValue>>;
}

export type StudyEditResult =
	{ ok: true; outcome: StudyEditOutcome } | { ok: false; issues: string[] };

const OVERLAY_TAG = 'overlay';
const PRICE_UNIT = 'currency';

// The catalog declares no `pane` field, and adding one would push a chart
// rendering concern into a registry that four other epics read. Placement is
// derived instead from what the catalog does declare about what a study
// measures. Both signals must agree before a study is drawn on the price axis:
// the item is tagged `overlay`, and every output it produces is a price. A
// study in its own sub-pane is never wrong, whereas a non-price series overlaid
// on price flattens the candles into a line, so ambiguity resolves to a
// sub-pane. Deriving it also means a study added to the catalog lands on the
// right pane with no edit here, which a per-ID lookup table could not do.
export function derivePane(item: StudyItem): StudyPane {
	if (!item.tags.includes(OVERLAY_TAG) || item.outputs.length === 0) {
		return 'sub_pane';
	}
	return item.outputs.every(isPriceOutput) ? 'price_overlay' : 'sub_pane';
}

function isPriceOutput(output: CatalogOutput): boolean {
	if (output.unit !== PRICE_UNIT) {
		return false;
	}
	// A bound on both sides is an oscillator's signature; a price has no ceiling.
	return output.range?.min === undefined || output.range?.max === undefined;
}

const TIMEFRAME_BAR_SECONDS: Record<ChartTimeframe, number> = {
	'1m': 60,
	'5m': 300,
	'15m': 900,
	'30m': 1_800,
	'1h': 3_600,
	'4h': 14_400,
	'1d': 86_400,
	'1wk': 604_800,
	'1mo': 2_629_800
};

// The catalog names five intervals; the chart's timeframe vocabulary is wider.
// A timeframe with no catalog interval cannot be judged for availability, so it
// is not judged rather than guessed at.
const TIMEFRAME_INTERVAL_IDS: Partial<Record<ChartTimeframe, string>> = {
	'1m': 'interval.1m',
	'5m': 'interval.5m',
	'1h': 'interval.1h',
	'1d': 'interval.1d',
	'1wk': 'interval.1w'
};

const DAY_SECONDS = 86_400;

// The widest span each token can cover. Calendar months, leap years and `ytd`
// all depend on today's date and this fold has no clock, so the widest span is
// used deliberately: the warm-up warning may stay silent when it could have
// spoken, but it can never fire on a range that is in fact long enough. `max`
// has no bound at all, so it yields no estimate.
const RELATIVE_SPAN_SECONDS: Record<RelativeRangeToken, number | null> = {
	'1d': DAY_SECONDS,
	'5d': 5 * DAY_SECONDS,
	'1mo': 31 * DAY_SECONDS,
	'3mo': 92 * DAY_SECONDS,
	'6mo': 184 * DAY_SECONDS,
	ytd: 366 * DAY_SECONDS,
	'1y': 366 * DAY_SECONDS,
	'2y': 732 * DAY_SECONDS,
	'5y': 1_827 * DAY_SECONDS,
	max: null
};

// Null when the range gives no honest bound. Calendar days are counted rather
// than trading sessions, which also overstates the bar count and so keeps the
// warning on the silent side of wrong.
export function estimateVisibleBars(config: ChartConfig): number | null {
	const span =
		config.range.kind === 'explicit'
			? (Date.parse(config.range.end) - Date.parse(config.range.start)) / 1000
			: RELATIVE_SPAN_SECONDS[config.range.token];
	if (span === null || !Number.isFinite(span) || span <= 0) {
		return null;
	}
	return Math.max(1, Math.floor(span / TIMEFRAME_BAR_SECONDS[config.timeframe]));
}

// Past this many bars the probe below costs more than the warning is worth, and
// no plausible study warms up that slowly.
const WARMUP_PROBE_CAP = 2_000;

// Warm-up length is a property of the arithmetic, which lives in the engine and
// is exported as no number. So it is measured rather than restated: run the
// study over a placeholder series exactly as long as the visible range and see
// whether any output ever acquires a value. A second copy of the warm-up rule
// here would drift the moment a calculator's seeding changed.
function plotsNothingInRange(
	item: StudyItem,
	params: Record<string, StudyParamValue>,
	visibleBars: number,
	registry: CatalogRegistry
): boolean {
	const probe = Math.min(visibleBars, WARMUP_PROBE_CAP);
	const computed = computeStudy(placeholderBars(probe), item.id, params, { registry });
	// Below the cap the probe covers the whole range, so this is exact. Above
	// it, a study still absent at the cap might yet warm up inside the real
	// range, and the warning declines to guess.
	return computed.warmupBars >= probe && visibleBars <= WARMUP_PROBE_CAP;
}

// Strictly rising so no calculator meets a zero range or a zero divisor; the
// values themselves are never reported, only whether an output exists.
function placeholderBars(count: number): OhlcvBar[] {
	const start = Date.UTC(2020, 0, 1);
	const bars: OhlcvBar[] = [];
	for (let i = 0; i < count; i += 1) {
		const close = 100 + i;
		bars.push({
			time: new Date(start + i * DAY_SECONDS * 1000).toISOString(),
			open: close,
			high: close + 1,
			low: close - 1,
			close,
			volume: 1_000 + i
		});
	}
	return bars;
}

interface StepContext {
	state: ChartState;
	ids: IdSequencer;
	registry: CatalogRegistry;
}

type StepResult =
	| {
			ok: true;
			studies: StudyInstance[];
			affected: ResourceId[];
			changes: string[];
			warnings: string[];
			resolved: Record<ResourceId, Record<string, StudyParamValue>>;
	  }
	| { ok: false; issues: string[] };

type ItemResolution = { ok: true; item: StudyItem } | { ok: false; issues: string[] };

// A miss returns the closest catalog IDs and names the tool that lists them, so
// a wrong ID becomes a one-turn self-correction instead of a retry loop.
function unknownStudyMessage(catalogItemId: string, registry: CatalogRegistry): string {
	const suggestions = registry.suggestCatalogIds(catalogItemId);
	const closest =
		suggestions.length > 0 ? ` The closest catalog IDs are ${suggestions.join(', ')}.` : '';
	return (
		`catalog_item_id: "${catalogItemId}" is not a study in the catalog.${closest} ` +
		'Call search_catalog with kind "study" to find the right ID.'
	);
}

function timeframeIssue(item: StudyItem, timeframe: ChartTimeframe): string | null {
	const intervalId = TIMEFRAME_INTERVAL_IDS[timeframe];
	const declared = item.availability.intervalIds;
	// An empty list states no interval constraint -- the catalog uses it for
	// items limited for reasons other than the interval -- and a timeframe the
	// catalog has no interval for cannot be judged either way.
	if (!intervalId || declared.length === 0 || declared.includes(intervalId)) {
		return null;
	}
	return (
		`catalog_item_id: "${item.id}" is not available at the ${timeframe} timeframe; ` +
		`the catalog declares it over ${declared.join(', ')}. ` +
		'Call search_catalog to find a study for this timeframe.'
	);
}

export function resolveStudyItem(
	catalogItemId: string,
	timeframe: ChartTimeframe | null,
	registry: CatalogRegistry = builtinCatalogRegistry
): ItemResolution {
	const item = registry.resolveStudy(catalogItemId);
	if (!item) {
		return { ok: false, issues: [unknownStudyMessage(catalogItemId, registry)] };
	}
	if (!isStudySupported(item.id)) {
		return {
			ok: false,
			issues: [
				`catalog_item_id: "${item.id}" (${item.label}) is a catalog study this chart ` +
					'cannot plot. Call search_catalog with kind "study" to find one it can.'
			]
		};
	}
	const issue = timeframe === null ? null : timeframeIssue(item, timeframe);
	return issue ? { ok: false, issues: [issue] } : { ok: true, item };
}

// The catalog's own rejection already names the parameter, the supplied value
// and what would have been accepted, so it is passed through verbatim.
function resolveParamsOrIssues(
	item: StudyItem,
	params: Record<string, StudyParamValue>,
	registry: CatalogRegistry
): { ok: true; params: Record<string, StudyParamValue> } | { ok: false; issues: string[] } {
	try {
		return { ok: true, params: { ...resolveStudyParams(item.id, params, { registry }) } };
	} catch (error) {
		if (error instanceof StudyParameterError) {
			return { ok: false, issues: [error.message] };
		}
		throw error;
	}
}

function warmupWarnings(
	item: StudyItem,
	params: Record<string, StudyParamValue>,
	ctx: StepContext
): string[] {
	const visibleBars = estimateVisibleBars(ctx.state.config);
	if (visibleBars === null || !plotsNothingInRange(item, params, visibleBars, ctx.registry)) {
		return [];
	}
	return [
		`${item.label} warms up over more bars than the chart's current range shows ` +
			`(about ${visibleBars}), so it will have no plotted values in the current range.`
	];
}

function fromTransition(
	transition: StudyTransition,
	affected: ResourceId[],
	extras: {
		warnings?: string[];
		resolved?: Record<ResourceId, Record<string, StudyParamValue>>;
	} = {}
): StepResult {
	if (!transition.ok) {
		return { ok: false, issues: transition.issues };
	}
	return {
		ok: true,
		studies: transition.studies,
		affected,
		changes: transition.changes,
		warnings: extras.warnings ?? [],
		resolved: extras.resolved ?? {}
	};
}

function runAdd(
	studies: readonly StudyInstance[],
	op: Extract<StudyOperation, { op: 'add' }>,
	ctx: StepContext
): StepResult {
	const resolution = resolveStudyItem(op.catalogItemId, ctx.state.config.timeframe, ctx.registry);
	if (!resolution.ok) {
		return resolution;
	}
	const params = resolveParamsOrIssues(resolution.item, op.params ?? {}, ctx.registry);
	if (!params.ok) {
		return params;
	}
	const pane = derivePane(resolution.item);
	const id = ctx.ids.next('study');
	const instance: StudyInstance = {
		id,
		catalogItemId: resolution.item.id,
		params: params.params,
		pane,
		order: op.order ?? studies.filter((s) => s.pane === pane).length,
		enabled: true
	};
	return fromTransition(addStudy(studies, instance), [id], {
		warnings: warmupWarnings(resolution.item, params.params, ctx),
		resolved: { [id]: params.params }
	});
}

function runUpdate(
	studies: readonly StudyInstance[],
	op: Extract<StudyOperation, { op: 'update' }>,
	ctx: StepContext
): StepResult {
	const existing = studies.find((s) => s.id === op.studyId);
	if (!existing) {
		return { ok: false, issues: [unknownStudyId(op.studyId)] };
	}
	const resolution = resolveStudyItem(existing.catalogItemId, null, ctx.registry);
	if (!resolution.ok) {
		return resolution;
	}
	// Resolved against the merged set, not the patch alone: a constraint between
	// two parameters can only be judged once both values are known.
	const params = resolveParamsOrIssues(
		resolution.item,
		{ ...existing.params, ...op.params },
		ctx.registry
	);
	if (!params.ok) {
		return params;
	}
	return fromTransition(updateStudyParams(studies, op.studyId, params.params), [op.studyId], {
		warnings: warmupWarnings(resolution.item, params.params, ctx),
		resolved: { [op.studyId]: params.params }
	});
}

function unknownStudyId(studyId: ResourceId): string {
	return `study_id: "${studyId}" is not a study on this chart.`;
}

function runOperation(
	studies: readonly StudyInstance[],
	op: StudyOperation,
	ctx: StepContext
): StepResult {
	switch (op.op) {
		case 'add':
			return runAdd(studies, op, ctx);
		case 'update':
			return runUpdate(studies, op, ctx);
		case 'reorder':
			return fromTransition(reorderStudies(studies, op.orderedIds), [...op.orderedIds]);
		case 'toggle':
			return fromTransition(
				op.enabled === undefined
					? toggleStudy(studies, op.studyId)
					: setStudyEnabled(studies, op.studyId, op.enabled),
				[op.studyId]
			);
		case 'remove':
			return fromTransition(removeStudy(studies, op.studyId), [op.studyId]);
		default:
			return {
				ok: false,
				issues: [`op: "${String((op as { op: string }).op)}" is not a study operation.`]
			};
	}
}

function describeOperation(op: StudyOperation): string {
	switch (op.op) {
		case 'add':
			return `add ${op.catalogItemId}`;
		case 'update':
			return `update ${op.studyId}`;
		case 'reorder':
			return 'reorder';
		case 'toggle':
			return `toggle ${op.studyId}`;
		case 'remove':
			return `remove ${op.studyId}`;
		default:
			return 'unknown operation';
	}
}

// Folds the whole batch over an in-memory study list. The first failing
// operation stops the fold and nothing is returned but issues, so a caller can
// never apply a partial batch by accident. Every issue is prefixed with the
// index and shape of the operation that produced it, because "which one failed"
// is the first thing an agent needs to fix its call.
export function applyStudyOperations(
	state: ChartState,
	operations: readonly StudyOperation[],
	ids: IdSequencer,
	options: ChartStudiesOptions = {}
): StudyEditResult {
	const ctx: StepContext = { state, ids, registry: options.registry ?? builtinCatalogRegistry };
	const outcome: StudyEditOutcome = {
		studies: state.studies,
		affectedIds: [],
		changes: [],
		warnings: [],
		resolvedParams: {}
	};
	const affected = new Set<ResourceId>();
	for (let index = 0; index < operations.length; index += 1) {
		const op = operations[index] as StudyOperation;
		const step = runOperation(outcome.studies, op, ctx);
		if (!step.ok) {
			const label = `operations[${index}] (${describeOperation(op)})`;
			return { ok: false, issues: step.issues.map((issue) => `${label}: ${issue}`) };
		}
		outcome.studies = step.studies;
		step.affected.forEach((id) => affected.add(id));
		outcome.changes.push(...step.changes);
		outcome.warnings.push(...step.warnings);
		Object.assign(outcome.resolvedParams, step.resolved);
	}
	outcome.affectedIds = [...affected];
	return { ok: true, outcome };
}

// Validation of a persisted study instance, for the renderer contract's
// `validateConfig`. It reaches the same catalog resolution, pane derivation and
// parameter resolution the operations use -- one implementation, two entry
// points -- so a config that survives the contract is one the operations accept.
export function validateStoredStudy(
	value: unknown,
	field: string,
	timeframe: ChartTimeframe | null,
	options: ChartStudiesOptions = {}
): string[] {
	const shapeIssues = validateStudyInstance(value, field);
	if (shapeIssues.length > 0) {
		return shapeIssues;
	}
	const study = value as StudyInstance;
	const registry = options.registry ?? builtinCatalogRegistry;
	const resolution = resolveStudyItem(study.catalogItemId, timeframe, registry);
	if (!resolution.ok) {
		return resolution.issues.map((issue) => `${field}: ${issue}`);
	}
	const params = resolveParamsOrIssues(resolution.item, study.params, registry);
	if (!params.ok) {
		return params.issues.map((issue) => `${field}: ${issue}`);
	}
	const pane = derivePane(resolution.item);
	return study.pane === pane
		? []
		: [`${field}.pane: the catalog places ${resolution.item.id} on ${pane}, not ${study.pane}.`];
}

// The wire shape an agent sends through `configure_panel_view`. snake_case,
// because that is what crosses the boundary; `fromWireEditChartStudiesInput`
// below is the single place it becomes camelCase.
export const EDIT_CHART_STUDIES_SCHEMA = {
	type: 'object',
	required: ['panel_id', 'operations'],
	additionalProperties: false,
	properties: {
		panel_id: { type: 'string', description: 'The chart panel whose studies are edited.' },
		operations: {
			type: 'array',
			minItems: 1,
			description: 'Applied in order, atomically: if any is invalid, none is applied.',
			items: {
				type: 'object',
				required: ['op'],
				properties: {
					op: { enum: ['add', 'update', 'reorder', 'toggle', 'remove'] },
					catalog_item_id: { type: 'string', description: 'add: the catalog study ID.' },
					params: {
						type: 'object',
						description: 'add/update: omitted parameters take the catalog default.'
					},
					order: { type: 'integer', minimum: 0, description: 'add: position within its pane.' },
					study_id: { type: 'string', description: 'update/toggle/remove: the instance ID.' },
					ordered_ids: {
						type: 'array',
						items: { type: 'string' },
						description: 'reorder: the complete new ordering, every instance included.'
					},
					enabled: { type: 'boolean', description: 'toggle: omit to flip the current state.' }
				}
			}
		}
	}
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const WIRE_KEYS: Record<string, string> = {
	panel_id: 'panelId',
	catalog_item_id: 'catalogItemId',
	study_id: 'studyId',
	ordered_ids: 'orderedIds'
};

// The one place the wire's snake_case becomes this module's camelCase.
export function fromWireEditChartStudiesInput(wire: unknown): EditChartStudiesInput {
	const source = isRecord(wire) ? wire : {};
	const operations = Array.isArray(source.operations) ? source.operations : [];
	return {
		panelId: String(source.panel_id ?? source.panelId ?? ''),
		operations: operations.map((op) => renameKeys(op) as StudyOperation)
	};
}

function renameKeys(value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		out[WIRE_KEYS[key] ?? key] = entry;
	}
	return out;
}

const OPERATION_REQUIRED_FIELDS: Record<string, readonly string[]> = {
	add: ['catalogItemId'],
	update: ['studyId', 'params'],
	reorder: ['orderedIds'],
	toggle: ['studyId'],
	remove: ['studyId']
};

function validateOperationShape(op: unknown, index: number): string[] {
	const field = `operations[${index}]`;
	if (!isRecord(op)) {
		return [`${field}: expected a study operation object.`];
	}
	const required = OPERATION_REQUIRED_FIELDS[String(op.op)];
	if (!required) {
		const kinds = Object.keys(OPERATION_REQUIRED_FIELDS).join(', ');
		return [`${field}.op: "${String(op.op)}" is not one of ${kinds}.`];
	}
	return required
		.filter((name) => op[name] === undefined)
		.map((name) => `${field}.${name}: required for a "${String(op.op)}" operation.`);
}

function validateInputShape(input: unknown): string[] {
	if (!isRecord(input)) {
		return ['input: expected an object with a panel ID and a list of operations.'];
	}
	const issues: string[] = [];
	if (typeof input.panelId !== 'string' || input.panelId.length === 0) {
		issues.push('panel_id: expected the ID of a chart panel.');
	}
	if (!Array.isArray(input.operations) || input.operations.length === 0) {
		issues.push('operations: expected at least one study operation.');
		return issues;
	}
	input.operations.forEach((op, index) => issues.push(...validateOperationShape(op, index)));
	return issues;
}

// A chart panel that has never been configured has no stored chart state yet,
// but is still a legitimate target: studies are configuration and do not need an
// instrument to be bound first.
function chartStateFor(doc: WorkspaceDocument, panelId: ResourceId): ChartState | null {
	const stored = readChartStateOrNull(doc, panelId);
	if (stored) {
		return stored;
	}
	const panel = doc.panels.find((p) => p.id === panelId);
	return panel?.kind === 'chart' ? createChartState(panelId) : null;
}

function unknownPanelMessage(panelId: ResourceId): string {
	return `panel_id: "${panelId}" is not a chart panel in this workspace.`;
}

export function validateEditChartStudies(
	input: EditChartStudiesInput,
	doc: WorkspaceDocument,
	options: ChartStudiesOptions = {}
): string[] {
	const shapeIssues = validateInputShape(input);
	if (shapeIssues.length > 0) {
		return shapeIssues;
	}
	const state = chartStateFor(doc, input.panelId);
	if (!state) {
		return [unknownPanelMessage(input.panelId)];
	}
	// A dry run must not consume real IDs, and must not mint one that collides
	// with a live study, so it gets its own sequencer seeded from the document's
	// high-water marks.
	const ids = createIdSequencer(chartStateIdSeed(doc));
	const result = applyStudyOperations(state, input.operations, ids, options);
	return result.ok ? [] : result.issues;
}

export function describeEditChartStudies(
	input: EditChartStudiesInput,
	doc: WorkspaceDocument,
	options: ChartStudiesOptions = {}
): string {
	const state = chartStateFor(doc, input.panelId);
	if (!state || validateInputShape(input).length > 0) {
		return `Edit studies on ${input?.panelId ?? 'an unnamed panel'}: the request is not valid.`;
	}
	const ids = createIdSequencer(chartStateIdSeed(doc));
	const result = applyStudyOperations(state, input.operations, ids, options);
	if (!result.ok) {
		return `Edit studies on ${input.panelId}: ${result.issues[0]}`;
	}
	return `Edited studies on ${input.panelId}: ${result.outcome.changes.join('; ')}.`;
}

export function applyEditChartStudies(
	input: EditChartStudiesInput,
	doc: WorkspaceDocument,
	ids: IdSequencer,
	options: ChartStudiesOptions = {}
): MutationDraft {
	const shapeIssues = validateInputShape(input);
	if (shapeIssues.length > 0) {
		throw new OperationValidationError(shapeIssues);
	}
	const state = chartStateFor(doc, input.panelId);
	if (!state) {
		throw new OperationValidationError([unknownPanelMessage(input.panelId)]);
	}
	const result = applyStudyOperations(state, input.operations, ids, options);
	if (!result.ok) {
		throw new OperationValidationError(result.issues);
	}
	return draftFrom(doc, state, input.panelId, result.outcome);
}

function draftFrom(
	doc: WorkspaceDocument,
	state: ChartState,
	panelId: ResourceId,
	outcome: StudyEditOutcome
): MutationDraft {
	const summary = `Edited studies on ${panelId}: ${outcome.changes.join('; ')}.`;
	return {
		document: writeChartState(doc, { ...state, studies: outcome.studies }),
		affectedIds: outcome.affectedIds,
		diffSummary: summary,
		warnings: outcome.warnings,
		// The pre-edit document is the inverse target, so undo restores the
		// previous study set exactly rather than replaying the batch backwards.
		inverse: {
			document: doc,
			affectedIds: outcome.affectedIds,
			diffSummary: `Restored the previous ${state.studies.length} studies on ${panelId}.`
		}
	};
}

export function createEditChartStudiesOperation(
	options: ChartStudiesOptions = {}
): OperationDefinition<EditChartStudiesInput> {
	return {
		kind: CHART_EDIT_STUDIES_KIND,
		inputSchema: EDIT_CHART_STUDIES_SCHEMA,
		validate: (input, doc) => validateEditChartStudies(input, doc, options),
		describe: (input, doc) => describeEditChartStudies(input, doc, options),
		apply: (input, doc, ids) => applyEditChartStudies(input, doc, ids, options)
	};
}

export const editChartStudiesOperation = createEditChartStudiesOperation();

// One call site, so wiring this into the shared registry is a single line.
export function registerChartStudyOperations(
	registry: OperationRegistry,
	options: ChartStudiesOptions = {}
): void {
	registry.register(createEditChartStudiesOperation(options));
}
