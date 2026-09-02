// Adding a drawing to a chart, as an operation the workbench registry owns.
//
// The domain knows what a valid annotation looks like; it deliberately does
// not know what "now" is, so it cannot tell whether an anchor falls inside a
// relative range like "6mo". That resolution, the anchor-shape triage that
// turns a wrong-kind request into an actionable message, and the registered
// `chart.add_annotation` operation itself all live here.
//
// Application layer: use cases over the chart domain plus EPIC-1006's
// operation registry. No I/O of its own -- time arrives through a Clock.
import type { IdSequencer, ResourceId } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { MutationDraft } from '../../application/revisionService';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { AnnotationKind, ChartAnnotation } from '../domain/annotations';
import {
	annotationTimes,
	createAnnotation,
	isAnnotationKind,
	isAnnotationStale,
	staleAnnotationIds,
	validateAnnotationAnchors
} from '../domain/annotations';
import type { ChartPriceAdjustment, ChartRange, RelativeRangeToken } from '../domain/chartState';
import { readChartState, writeChartState } from '../domain/chartState';

export const CHART_ADD_ANNOTATION_KIND = 'chart.add_annotation';

export interface ResolvedRange {
	start: string;
	end: string;
}

// The keys each kind's anchors are made of. Used only to tell a caller which
// anchors were missing or foreign -- the values themselves are the domain's
// business.
const REQUIRED_ANCHOR_KEYS: Record<AnnotationKind, readonly string[]> = {
	trendline: ['from', 'to'],
	price_level: ['price'],
	date_range: ['start', 'end'],
	setup_window: ['start', 'end'],
	label: ['at', 'text']
};

// Null means "no lower bound": `max` is the one range an anchor cannot fall
// outside of, so range checking is skipped rather than faked with an epoch.
function relativeStart(token: RelativeRangeToken, end: Date): Date | null {
	const start = new Date(end.getTime());
	switch (token) {
		case '1d':
			start.setUTCDate(start.getUTCDate() - 1);
			return start;
		case '5d':
			start.setUTCDate(start.getUTCDate() - 5);
			return start;
		case '1mo':
			start.setUTCMonth(start.getUTCMonth() - 1);
			return start;
		case '3mo':
			start.setUTCMonth(start.getUTCMonth() - 3);
			return start;
		case '6mo':
			start.setUTCMonth(start.getUTCMonth() - 6);
			return start;
		case 'ytd':
			return new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
		case '1y':
			start.setUTCFullYear(start.getUTCFullYear() - 1);
			return start;
		case '2y':
			start.setUTCFullYear(start.getUTCFullYear() - 2);
			return start;
		case '5y':
			start.setUTCFullYear(start.getUTCFullYear() - 5);
			return start;
		case 'max':
			return null;
	}
}

export function resolveChartRange(range: ChartRange, now: string): ResolvedRange | null {
	if (range.kind === 'explicit') {
		return { start: range.start, end: range.end };
	}
	const end = new Date(Date.parse(now));
	const start = relativeStart(range.token, end);
	return start ? { start: start.toISOString(), end: end.toISOString() } : null;
}

// Names the range the way a rejection message needs to: the token the chart
// was configured with *and* the window it currently resolves to, because
// "6mo" alone does not tell a caller which dates it just missed.
export function describeChartRange(range: ChartRange, now: string): string {
	const resolved = resolveChartRange(range, now);
	if (range.kind === 'explicit') {
		return `explicit ${range.start} to ${range.end}`;
	}
	return resolved
		? `relative "${range.token}" (${resolved.start} to ${resolved.end})`
		: `relative "${range.token}" (unbounded)`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The domain owns the wording of what each kind expects. Asking it to validate
// absent anchors is how that sentence is obtained rather than copied, so there
// is exactly one definition of it.
function expectedAnchorsMessage(kind: AnnotationKind): string {
	return validateAnnotationAnchors(kind, undefined)[0] ?? `anchors: invalid for a ${kind}.`;
}

// Catches "a price for a date range" before value validation does, so the
// caller is told which anchors the kind wanted instead of being handed a pile
// of undefined-is-not-a-timestamp errors.
export function anchorShapeIssues(kind: AnnotationKind, anchors: unknown): string[] {
	if (!isRecord(anchors)) {
		return [expectedAnchorsMessage(kind)];
	}
	const required = REQUIRED_ANCHOR_KEYS[kind];
	const missing = required.filter((key) => !(key in anchors));
	const foreign = Object.keys(anchors).filter((key) => key !== 'kind' && !required.includes(key));
	if (missing.length === 0 && foreign.length === 0) {
		return [];
	}
	const parts: string[] = [];
	if (missing.length > 0) {
		parts.push(`missing ${missing.join(', ')}`);
	}
	if (foreign.length > 0) {
		parts.push(`unexpected ${foreign.join(', ')}`);
	}
	return [`${expectedAnchorsMessage(kind)} Anchors supplied: ${parts.join('; ')}.`];
}

// An annotation whose anchors sit outside the configured range would be
// stored, invisible, and indistinguishable from one the user simply scrolled
// past -- so it is refused at the door, naming the range it missed.
export function outOfRangeIssues(
	annotation: ChartAnnotation,
	range: ChartRange,
	now: string
): string[] {
	const resolved = resolveChartRange(range, now);
	if (!resolved) {
		return [];
	}
	const start = Date.parse(resolved.start);
	const end = Date.parse(resolved.end);
	return annotationTimes(annotation)
		.filter((time) => {
			const at = Date.parse(time);
			return at < start || at > end;
		})
		.map(
			(time) =>
				`anchors: "${time}" is outside the chart's configured range ` +
				`(${describeChartRange(range, now)}). Reconfigure the chart's range before ` +
				'annotating there.'
		);
}

export interface AnnotationView {
	annotation: ChartAnnotation;
	// True when the chart's price-adjustment policy has moved on since this
	// annotation was drawn: its price no longer means the same number.
	stale: boolean;
}

export interface ChartAnnotationsView {
	panelId: ResourceId;
	priceAdjustment: ChartPriceAdjustment;
	annotations: AnnotationView[];
	staleIds: ResourceId[];
}

// The read every consumer of chart annotations goes through, so staleness is
// impossible to read past: it is attached to each annotation rather than left
// for the caller to compute.
export function readChartAnnotationsView(
	doc: WorkspaceDocument,
	panelId: ResourceId
): ChartAnnotationsView {
	const state = readChartState(doc, panelId);
	const policy = state.config.priceAdjustment;
	return {
		panelId,
		priceAdjustment: policy,
		annotations: state.annotations.map((annotation) => ({
			annotation,
			stale: isAnnotationStale(annotation, policy)
		})),
		staleIds: staleAnnotationIds(state.annotations, policy)
	};
}

export interface AddChartAnnotationInput {
	panelId: ResourceId;
	kind: AnnotationKind;
	anchors: unknown;
	label?: string;
}

function panelIssues(input: AddChartAnnotationInput, doc: WorkspaceDocument): string[] {
	if (typeof input.panelId !== 'string' || input.panelId.length === 0) {
		return ['panel_id: expected the id of a chart panel.'];
	}
	const panel = doc.panels.find((p) => p.id === input.panelId);
	if (!panel) {
		return [`panel_id: "${input.panelId}" is not a panel in this workspace.`];
	}
	if (panel.kind !== 'chart') {
		return [`panel_id: panel "${input.panelId}" is a ${panel.kind} panel, not a chart.`];
	}
	return [];
}

// A placeholder so validate() can build the annotation it is about to check
// without minting a real, never-reused ID for a request that may be rejected.
const VALIDATION_ID = 'annotation_0';

function buildForValidation(
	input: AddChartAnnotationInput,
	policy: ChartPriceAdjustment,
	id: ResourceId
): { ok: true; annotation: ChartAnnotation } | { ok: false; issues: string[] } {
	const shape = anchorShapeIssues(input.kind, input.anchors);
	if (shape.length > 0) {
		return { ok: false, issues: shape };
	}
	return createAnnotation({
		id,
		kind: input.kind,
		anchors: { ...(input.anchors as Record<string, unknown>), kind: input.kind },
		priceAdjustment: policy,
		...(input.label !== undefined ? { label: input.label } : {})
	});
}

function validateAddAnnotation(
	input: AddChartAnnotationInput,
	doc: WorkspaceDocument,
	now: string
): string[] {
	const issues = panelIssues(input, doc);
	if (issues.length > 0) {
		return issues;
	}
	if (!isAnnotationKind(input.kind)) {
		return [`kind: "${String(input.kind)}" is not a supported annotation kind.`];
	}
	if (input.label !== undefined && typeof input.label !== 'string') {
		return ['label: expected a string.'];
	}
	const state = readChartState(doc, input.panelId);
	const built = buildForValidation(input, state.config.priceAdjustment, VALIDATION_ID);
	if (!built.ok) {
		return built.issues;
	}
	return outOfRangeIssues(built.annotation, state.config.range, now);
}

function applyAddAnnotation(
	input: AddChartAnnotationInput,
	doc: WorkspaceDocument,
	ids: IdSequencer
): MutationDraft {
	const state = readChartState(doc, input.panelId);
	const id = ids.next('annotation');
	const built = buildForValidation(input, state.config.priceAdjustment, id);
	if (!built.ok) {
		// validate() runs first on every registry path; reaching here means the
		// caller bypassed it, and a silent no-op would be worse than a throw.
		throw new Error(built.issues.join(' '));
	}
	const annotations = [...state.annotations, built.annotation];
	const document = writeChartState(doc, { ...state, annotations });
	return {
		document,
		affectedIds: [id, input.panelId],
		diffSummary: `Added a ${input.kind} annotation to chart panel ${input.panelId}.`,
		warnings: staleAnnotationWarnings(state.annotations, state.config.priceAdjustment),
		inverse: {
			// Removes exactly the annotation that was added, rather than
			// reverting whatever else the document happens to hold.
			document: writeChartState(document, { ...state, annotations: state.annotations }),
			affectedIds: [id, input.panelId],
			diffSummary: `Removed the ${input.kind} annotation ${id} from chart panel ${input.panelId}.`
		}
	};
}

// Exported because the operation registry's fold builds its combined draft
// without carrying per-operation warnings, so a tool that wants this on the
// wire has to add it to its own payload.
export function staleAnnotationWarnings(
	annotations: readonly ChartAnnotation[],
	policy: ChartPriceAdjustment
): string[] {
	const stale = staleAnnotationIds(annotations, policy);
	return stale.length === 0
		? []
		: [
				`Existing annotations ${stale.join(', ')} were drawn under a different ` +
					`price-adjustment policy and are stale against the chart's current "${policy}" policy.`
			];
}

const ANCHOR_SCHEMA = {
	type: 'object',
	description:
		'Kind-specific, in data coordinates. trendline: {from, to} each {time, price}. ' +
		'price_level: {price}. date_range and setup_window: {start, end} ISO timestamps. ' +
		'label: {at: {time, price}, text}.'
};

export const ADD_CHART_ANNOTATION_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		panel_id: { type: 'string', description: 'The chart panel to draw on.' },
		kind: {
			type: 'string',
			enum: ['trendline', 'price_level', 'date_range', 'label', 'setup_window']
		},
		anchors: ANCHOR_SCHEMA,
		label: { type: 'string', description: 'Optional note, returned verbatim in later reads.' },
		expected_revision: { type: 'number' },
		idempotency_key: { type: 'string' }
	},
	required: ['panel_id', 'kind', 'anchors']
};

// Registering this with EPIC-1006's registry is what gives the tool
// expected_revision, idempotency replay, the mutation envelope and a working
// undo token; none of that is reimplemented in this epic.
export function createAddChartAnnotationOperation(deps: {
	clock: Clock;
}): OperationDefinition<AddChartAnnotationInput> {
	return {
		kind: CHART_ADD_ANNOTATION_KIND,
		inputSchema: ADD_CHART_ANNOTATION_SCHEMA,
		validate: (input, doc) => validateAddAnnotation(input, doc, deps.clock.now()),
		describe: (input) => `Add a ${input.kind} annotation to chart panel ${input.panelId}.`,
		apply: applyAddAnnotation
	};
}

// Idempotent so a tool factory can guarantee its operation exists without
// fighting a composition root that registered it first.
export function ensureAddChartAnnotationOperation(
	registry: OperationRegistry,
	deps: { clock: Clock }
): void {
	if (!registry.get(CHART_ADD_ANNOTATION_KIND)) {
		registry.register(createAddChartAnnotationOperation(deps));
	}
}
