// Freezing a live chart into a reference setup, as an operation the workbench
// registry owns.
//
// The record type, its constructor, its serializer and its workspace store all
// live in the domain. What this module adds is the part that cannot be pure: a
// capture has to state how many bars its window holds and where the data came
// from, and neither fact is in the workspace document. Both come from the bars
// port, which is async, while an operation's apply() is not. So a capture runs
// in two halves:
//
//   1. `prepareCapture` resolves the chart's range, fetches the series, and
//      returns the window and provenance as plain values.
//   2. The registered `chart.capture_setup` operation takes those values as
//      input and is therefore synchronous, pure over the document, and gets
//      revision guarding, idempotency replay, the envelope and undo for free.
//
// Application layer: use cases over the chart domain plus EPIC-1006's
// operation registry. The only I/O is the bars port, injected.
import type { IdSequencer, ResourceId } from '../../domain/ids';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { MarketDataProvenance } from '../../domain/provenance';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import type { SetupWindow } from '../domain/capturedSetup';
import {
	CaptureSetupError,
	buildCapturedSetup,
	validateSetupWindow,
	writeCapturedSetup
} from '../domain/capturedSetup';
import type { ChartState } from '../domain/chartState';
import { isIsoTimestamp, readChartState, readChartStateOrNull } from '../domain/chartState';
import type { Normalization } from '../domain/instrument';
import { validateNormalization } from '../domain/instrument';
import type { ChartSeriesResult, ChartSeriesPort, ChartSeriesWindow } from '../domain/seriesPort';
import { readChartAnnotationsView } from './chartAnnotations';
import { resolveChartRange } from './chartData';

export const CHART_CAPTURE_SETUP_KIND = 'chart.capture_setup';

// The chart half of "nothing to capture". The window half is the domain's own
// sentence, obtained from validateSetupWindow rather than restated here.
const NO_INSTRUMENT_ISSUE =
	'instrument: this chart has no instrument, so there is nothing to capture. ' +
	'Point the chart at a resolved instrument ID first.';

export interface CaptureChartSetupInput {
	panelId: ResourceId;
	// Already resolved against the bars port by `prepareCapture`; the operation
	// never fetches anything itself.
	window: SetupWindow;
	provenance: MarketDataProvenance;
	normalization?: Normalization;
	name?: string;
	notes?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function panelIssues(panelId: ResourceId, doc: WorkspaceDocument): string[] {
	if (typeof panelId !== 'string' || panelId.length === 0) {
		return ['panel_id: expected the id of a chart panel.'];
	}
	const panel = doc.panels.find((p) => p.id === panelId);
	if (!panel) {
		return [`panel_id: "${panelId}" is not a panel in this workspace.`];
	}
	if (panel.kind !== 'chart') {
		return [`panel_id: panel "${panelId}" is a ${panel.kind} panel, not a chart.`];
	}
	return [];
}

// An anchor bar the window does not contain would name a bar the consumer
// cannot find in the series the setup describes, which is worse than having no
// anchor at all.
function anchorIssues(window: SetupWindow): string[] {
	if (window.anchorTime === undefined || !isIsoTimestamp(window.anchorTime)) {
		return [];
	}
	const at = Date.parse(window.anchorTime);
	if (at < Date.parse(window.start) || at > Date.parse(window.end)) {
		return [
			`window.anchorTime: "${window.anchorTime}" is outside the captured window ` +
				`(${window.start} to ${window.end}).`
		];
	}
	return [];
}

// Everything that makes a capture impossible rather than merely imperfect.
// Shared by the async prologue and the operation's own validate(), so a caller
// reaching the registry directly cannot store a partial record either.
export function captureBlockers(state: ChartState | null, window: unknown): string[] {
	const issues: string[] = [];
	if (!state || !state.config.instrument) {
		issues.push(NO_INSTRUMENT_ISSUE);
	}
	const windowIssues = validateSetupWindow(window, 'window');
	issues.push(...windowIssues);
	if (windowIssues.length === 0) {
		issues.push(...anchorIssues(window as SetupWindow));
	}
	return issues;
}

function validateCaptureSetup(input: CaptureChartSetupInput, doc: WorkspaceDocument): string[] {
	const panel = panelIssues(input.panelId, doc);
	if (panel.length > 0) {
		return panel;
	}
	const issues = captureBlockers(readChartStateOrNull(doc, input.panelId), input.window);
	if (input.normalization !== undefined) {
		issues.push(...validateNormalization(input.normalization, 'normalization'));
	}
	for (const field of ['name', 'notes'] as const) {
		if (input[field] !== undefined && typeof input[field] !== 'string') {
			issues.push(`${field}: expected a string.`);
		}
	}
	if (!isRecord(input.provenance)) {
		issues.push('provenance: expected the provenance of the data the capture was taken from.');
	}
	return issues;
}

// Stale drawings are captured as drawn rather than dropped or silently
// re-based, so the record says what the chart said; the warning is how the
// caller finds out that is what happened.
function captureWarnings(doc: WorkspaceDocument, panelId: ResourceId): string[] {
	const view = readChartAnnotationsView(doc, panelId);
	return view.staleIds.length === 0
		? []
		: [
				`Annotations ${view.staleIds.join(', ')} were drawn under a different ` +
					`price-adjustment policy than the chart's current "${view.priceAdjustment}" and are ` +
					'captured as drawn.'
			];
}

function applyCaptureSetup(
	input: CaptureChartSetupInput,
	doc: WorkspaceDocument,
	ids: IdSequencer,
	now: string
): MutationDraft {
	const state = readChartState(doc, input.panelId);
	const setupId = ids.next('setup');
	const setup = buildCapturedSetup({
		setupId,
		capturedAt: now,
		// The revision whose state was frozen. The capture itself lands at
		// revision + 1, and the record's own existence is the only difference
		// between the two.
		workspaceRevision: doc.revision,
		sourcePanelId: input.panelId,
		state,
		window: input.window,
		...(input.normalization !== undefined ? { normalization: input.normalization } : {}),
		provenance: input.provenance,
		...(input.name !== undefined ? { name: input.name } : {}),
		...(input.notes !== undefined ? { notes: input.notes } : {})
	});
	return {
		document: writeCapturedSetup(doc, setup),
		affectedIds: [setupId, input.panelId],
		diffSummary: `Captured chart panel ${input.panelId} as reference setup ${setupId}.`,
		warnings: captureWarnings(doc, input.panelId),
		inverse: {
			// A capture only ever adds one record, so the pre-capture document is
			// exactly this document with the capture discarded.
			document: doc,
			affectedIds: [setupId, input.panelId],
			diffSummary: `Discarded captured setup ${setupId}.`
		}
	};
}

const NORMALIZATION_SCHEMA = {
	type: 'object',
	description:
		'How the series is made comparable. Recorded on the setup rather than ' +
		'left to be re-derived at search time. Defaults to {mode: "none", anchor: "window_start"}.',
	properties: {
		mode: { type: 'string', enum: ['none', 'percent_change', 'indexed_100', 'z_score'] },
		anchor: { type: 'string', enum: ['window_start', 'anchor_bar'] }
	}
};

export const CAPTURE_CHART_SETUP_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		panel_id: { type: 'string', description: 'The chart panel to capture.' },
		name: { type: 'string', description: 'Optional name, stored and returned with the record.' },
		notes: { type: 'string', description: 'Optional notes, stored and returned with the record.' },
		anchor_time: {
			type: 'string',
			description:
				'Optional ISO timestamp of the bar the setup is "about". Must fall inside the ' +
				'captured window.'
		},
		normalization: NORMALIZATION_SCHEMA,
		expected_revision: { type: 'number' },
		idempotency_key: { type: 'string' }
	},
	required: ['panel_id']
};

export function createCaptureChartSetupOperation(deps: {
	clock: Clock;
}): OperationDefinition<CaptureChartSetupInput> {
	return {
		kind: CHART_CAPTURE_SETUP_KIND,
		inputSchema: CAPTURE_CHART_SETUP_SCHEMA,
		validate: validateCaptureSetup,
		describe: (input) =>
			`Capture chart panel ${input.panelId} as a reference setup over ` +
			`${input.window.start} to ${input.window.end}.`,
		apply: (input, doc, ids) => applyCaptureSetup(input, doc, ids, deps.clock.now())
	};
}

// Idempotent so a tool factory can guarantee its operation exists without
// fighting a composition root that registered it first.
export function ensureCaptureChartSetupOperation(
	registry: OperationRegistry,
	deps: { clock: Clock }
): void {
	if (!registry.get(CHART_CAPTURE_SETUP_KIND)) {
		registry.register(createCaptureChartSetupOperation(deps));
	}
}

export interface PrepareCaptureDeps {
	repository: WorkspaceRepository;
	series: ChartSeriesPort;
	// A relative range token ("6mo") cannot become an explicit window without a
	// notion of now.
	clock: Clock;
}

export interface PrepareCaptureRequest {
	panelId: ResourceId;
	workspaceId?: ResourceId;
	anchorTime?: string;
}

export interface PreparedCapture {
	panelId: ResourceId;
	window: SetupWindow;
	provenance: MarketDataProvenance;
	warnings: string[];
}

// Only the failures that are about the workspace rather than about the chart
// being incomplete. "Nothing to capture" is a CaptureSetupError, not a refusal,
// so AC7's two halves come back through one wire shape.
export type PrepareCaptureRefusalReason =
	'workspace_not_found' | 'chart_panel_not_found' | 'series_unavailable';

export interface PrepareCaptureRefusal {
	reason: PrepareCaptureRefusalReason;
	message: string;
	remedies: string[];
	panelId?: ResourceId;
}

export type PrepareCaptureOutcome =
	{ ok: true; prepared: PreparedCapture } | { ok: false; refusal: PrepareCaptureRefusal };

function refuse(refusal: PrepareCaptureRefusal): PrepareCaptureOutcome {
	return { ok: false, refusal };
}

// The span the bars actually cover, not the chart's resolved range: a chart
// configured with "max" resolves to a range starting at the epoch, and
// recording that would tell a consumer to search decades the instrument never
// traded. The range is the fallback only when there are no bars to span, and
// that case is rejected immediately afterwards anyway.
function toSetupWindow(
	state: ChartState,
	series: ChartSeriesResult,
	range: ChartSeriesWindow,
	anchorTime?: string
): SetupWindow {
	const first = series.bars[0];
	const last = series.bars[series.bars.length - 1];
	return {
		start: first ? first.time : range.start,
		end: last ? last.time : range.end,
		timeframe: state.config.timeframe,
		session: series.session,
		barCount: series.bars.length,
		...(anchorTime !== undefined ? { anchorTime } : {})
	};
}

// The record states the chart's policy; provenance states what the source
// applied. When those disagree -- or when the source states nothing at all --
// the difference is surfaced rather than resolved by guessing.
function adjustmentWarnings(state: ChartState, series: ChartSeriesResult): string[] {
	const policy = state.config.priceAdjustment;
	if (series.appliedPriceAdjustment === null) {
		return [
			`The source does not state which price-adjustment basis these bars use. The setup ` +
				`records the chart's "${policy}" policy, which the bars may not honour.`
		];
	}
	if (series.appliedPriceAdjustment !== policy) {
		return [
			`The bars were adjusted "${series.appliedPriceAdjustment}" but the chart's policy is ` +
				`"${policy}"; the setup records both.`
		];
	}
	return [];
}

function isOutcome(value: unknown): value is PrepareCaptureOutcome {
	return typeof value === 'object' && value !== null && 'ok' in value;
}

function resolveCaptureState(
	deps: PrepareCaptureDeps,
	request: PrepareCaptureRequest
): ChartState | PrepareCaptureOutcome {
	const workspaceId = request.workspaceId ?? deps.repository.getActiveId();
	const doc = workspaceId ? deps.repository.get(workspaceId) : null;
	if (!doc) {
		return refuse({
			reason: 'workspace_not_found',
			message: workspaceId
				? `Workspace "${workspaceId}" was not found.`
				: 'There is no active workspace to capture a chart from.',
			remedies: ['Name an existing workspace_id.', 'Create or activate a workspace first.']
		});
	}
	const state = readChartStateOrNull(doc, request.panelId);
	if (!state) {
		return refuse({
			reason: 'chart_panel_not_found',
			message: `Panel "${request.panelId}" has no chart on it.`,
			remedies: ['Name a chart panel that exists.', 'Read the canvas state to list the panels.'],
			panelId: request.panelId
		});
	}
	return state;
}

/**
 * Resolve everything a capture needs that the workspace document cannot supply.
 *
 * @throws {CaptureSetupError} when the chart has no instrument or its window
 * holds no bars -- thrown before anything is committed, so no partial record is
 * ever stored.
 */
export async function prepareCapture(
	deps: PrepareCaptureDeps,
	request: PrepareCaptureRequest
): Promise<PrepareCaptureOutcome> {
	const resolved = resolveCaptureState(deps, request);
	if (isOutcome(resolved)) {
		return resolved;
	}
	const state = resolved;
	const instrument = state.config.instrument;
	if (!instrument) {
		throw new CaptureSetupError([NO_INSTRUMENT_ISSUE]);
	}
	const range = resolveChartRange(state.config.range, deps.clock.now());
	let series: ChartSeriesResult;
	try {
		series = await deps.series.fetchSeries({
			instrumentId: instrument.instrumentId,
			timeframe: state.config.timeframe,
			window: range,
			priceAdjustment: state.config.priceAdjustment,
			session: state.config.session
		});
	} catch (error) {
		return refuse({
			reason: 'series_unavailable',
			message: error instanceof Error ? error.message : String(error),
			remedies: ['Retry the capture.', "Check the chart's instrument and timeframe."],
			panelId: request.panelId
		});
	}
	const window = toSetupWindow(state, series, range, request.anchorTime);
	const blockers = captureBlockers(state, window);
	if (blockers.length > 0) {
		throw new CaptureSetupError(blockers);
	}
	return {
		ok: true,
		prepared: {
			panelId: request.panelId,
			window,
			provenance: series.provenance,
			warnings: [...series.warnings, ...adjustmentWarnings(state, series)]
		}
	};
}
