// ============================================================================
// THE EPIC-1011 -> EPIC-1012 INTERFACE.
//
// `CapturedChartSetup` is written by the chart epic's capture tool and read by
// the similarity epic's `find_similar_setups`, `explain_similarity` and
// `compare_setups`. Changing the shape of anything exported from this module is
// a coordinated cross-epic change: both sides must land together, and a captured
// record already persisted in a workspace must keep normalizing.
//
// Two invariants make that contract worth having:
//
//   1. Self-contained. A consumer never reads the live chart. Every field is a
//      value copied at capture time, never a reference into chart state, so
//      reconfiguring or deleting the source panel cannot change a captured
//      record.
//   2. Complete or absent. `buildCapturedSetup` throws `CaptureSetupError`
//      rather than emitting a record missing an instrument or covering no bars,
//      so a partial setup is never stored and never handed downstream.
//
// Domain layer: pure construction and pure serialization, no I/O.
// ============================================================================
import type { ResourceId } from '../../domain/ids';
import { parseId } from '../../domain/ids';
import type { WireError } from '../../domain/errors';
import type { MarketDataProvenance } from '../../domain/provenance';
import { toWireProvenance } from '../../domain/provenance';
import type { Revision, WorkspaceDocument } from '../../domain/workspace';
import type { AnnotationAnchors, AnnotationKind, ChartAnnotation } from './annotations';
import { copyAnnotation, normalizeAnnotations } from './annotations';
import type {
	ChartCandleType,
	ChartPriceAdjustment,
	ChartScale,
	ChartSession,
	ChartState,
	ChartTimeframe
} from './chartState';
import {
	isChartCandleType,
	isChartPriceAdjustment,
	isChartScale,
	isChartSession,
	isChartTimeframe,
	isIsoTimestamp
} from './chartState';
import type { ComparisonRef, InstrumentRef, Normalization } from './instrument';
import {
	DEFAULT_NORMALIZATION,
	copyComparison,
	copyInstrumentRef,
	copyNormalization,
	normalizeComparisons,
	normalizeInstrumentRef,
	normalizeNormalization
} from './instrument';
import type { StudyInstance, StudyPane, StudyParamValue } from './studies';
import { normalizeStudies } from './studies';

// Re-exported so a consumer imports the whole contract from one module rather
// than reaching into the chart epic's internals.
export type {
	ComparisonRef,
	InstrumentRef,
	Normalization,
	NormalizationAnchor,
	NormalizationMode
} from './instrument';
export type { AnnotationAnchors, AnnotationKind } from './annotations';
export type { StudyPane, StudyParamValue } from './studies';

export const CAPTURED_SETUP_EXTENSION_KEY = 'chart_setups';

export interface SetupWindow {
	// Inclusive ISO bounds of the historical window the setup covers.
	start: string;
	end: string;
	timeframe: ChartTimeframe;
	session: ChartSession;
	// Bars in the window at capture time. Zero means there is nothing to
	// capture, which is rejected rather than stored.
	barCount: number;
	// The bar the setup is "about", when one is distinguished.
	anchorTime?: string;
}

export interface CapturedStudy {
	studyId: ResourceId;
	catalogItemId: string;
	// Fully resolved, defaults included -- never partial.
	params: Record<string, StudyParamValue>;
	pane: StudyPane;
	order: number;
	enabled: boolean;
}

export interface CapturedAnnotation {
	annotationId: ResourceId;
	kind: AnnotationKind;
	anchors: AnnotationAnchors;
	// The policy in force when it was drawn; a mismatch with the setup's policy
	// marks it stale.
	priceAdjustment: ChartPriceAdjustment;
	label?: string;
}

export interface CapturedChartSetup {
	setupId: ResourceId;
	capturedAt: string;
	workspaceRevision: Revision;
	// Informational only. Not a live reference: the panel may be gone.
	sourcePanelId: ResourceId;
	name?: string;
	notes?: string;
	instrument: InstrumentRef;
	window: SetupWindow;
	candleType: ChartCandleType;
	scale: ChartScale;
	priceAdjustment: ChartPriceAdjustment;
	// Explicit, never defaulted at search time: how the series is made
	// comparable is part of what was captured.
	normalization: Normalization;
	studies: CapturedStudy[];
	comparisons: ComparisonRef[];
	annotations?: CapturedAnnotation[];
	provenance: MarketDataProvenance;
}

export interface CaptureInput {
	setupId: ResourceId;
	capturedAt: string;
	workspaceRevision: Revision;
	sourcePanelId: ResourceId;
	// The live chart at capture time. Every value taken from it is copied.
	state: ChartState;
	window: SetupWindow;
	// Omitted applies `DEFAULT_NORMALIZATION`, which is then recorded on the
	// setup rather than left to be re-derived downstream.
	normalization?: Normalization;
	provenance: MarketDataProvenance;
	name?: string;
	notes?: string;
}

// Thrown, not returned: a caller that ignores the failure would otherwise carry
// on with an object that is not a valid setup. `issues` names every missing or
// invalid field at once so one round trip fixes them all.
export class CaptureSetupError extends Error {
	readonly issues: string[];

	constructor(issues: string[]) {
		super(`Cannot capture this chart setup: ${issues.join('; ')}`);
		this.name = 'CaptureSetupError';
		this.issues = issues;
	}

	toWireError(): WireError {
		return { error: 'capture_setup_incomplete', message: this.message, issues: this.issues };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSetupWindow(value: unknown, field: string): string[] {
	if (!isRecord(value)) {
		return [`${field}: expected a capture window.`];
	}
	const issues: string[] = [];
	if (!isIsoTimestamp(value.start)) {
		issues.push(`${field}.start: "${String(value.start)}" is not an ISO timestamp.`);
	}
	if (!isIsoTimestamp(value.end)) {
		issues.push(`${field}.end: "${String(value.end)}" is not an ISO timestamp.`);
	}
	if (issues.length === 0 && Date.parse(value.end as string) < Date.parse(value.start as string)) {
		issues.push(`${field}.end: must not precede ${field}.start.`);
	}
	if (!isChartTimeframe(value.timeframe)) {
		issues.push(`${field}.timeframe: "${String(value.timeframe)}" is not a supported timeframe.`);
	}
	if (!isChartSession(value.session)) {
		issues.push(`${field}.session: "${String(value.session)}" is not a supported session.`);
	}
	if (
		typeof value.barCount !== 'number' ||
		!Number.isInteger(value.barCount) ||
		value.barCount < 0
	) {
		issues.push(`${field}.barCount: expected a non-negative bar count.`);
	} else if (value.barCount === 0) {
		issues.push(`${field}.barCount: the window covers no bars, so there is nothing to capture.`);
	}
	if (value.anchorTime !== undefined && !isIsoTimestamp(value.anchorTime)) {
		issues.push(`${field}.anchorTime: "${String(value.anchorTime)}" is not an ISO timestamp.`);
	}
	return issues;
}

function copySetupWindow(window: SetupWindow): SetupWindow {
	return {
		start: window.start,
		end: window.end,
		timeframe: window.timeframe,
		session: window.session,
		barCount: window.barCount,
		...(window.anchorTime !== undefined ? { anchorTime: window.anchorTime } : {})
	};
}

function capturedStudy(study: StudyInstance): CapturedStudy {
	return {
		studyId: study.id,
		catalogItemId: study.catalogItemId,
		params: { ...study.params },
		pane: study.pane,
		order: study.order,
		enabled: study.enabled
	};
}

function capturedAnnotation(annotation: ChartAnnotation): CapturedAnnotation {
	const copy = copyAnnotation(annotation);
	return {
		annotationId: copy.id,
		kind: copy.kind,
		anchors: copy.anchors,
		priceAdjustment: copy.priceAdjustment,
		...(copy.label !== undefined ? { label: copy.label } : {})
	};
}

/**
 * Freeze a live chart into a self-contained, ID-addressable record.
 *
 * Every value is copied, so the returned setup shares no structure with the
 * `ChartState` it came from.
 *
 * @throws {CaptureSetupError} when the chart has no instrument, when the
 * window is malformed, or when the window covers no bars -- no partial record
 * is ever produced.
 */
export function buildCapturedSetup(input: CaptureInput): CapturedChartSetup {
	const issues = validateCaptureInput(input);
	if (issues.length > 0) {
		throw new CaptureSetupError(issues);
	}
	const config = input.state.config;
	return {
		setupId: input.setupId,
		capturedAt: input.capturedAt,
		workspaceRevision: input.workspaceRevision,
		sourcePanelId: input.sourcePanelId,
		...(input.name !== undefined ? { name: input.name } : {}),
		...(input.notes !== undefined ? { notes: input.notes } : {}),
		instrument: copyInstrumentRef(config.instrument as InstrumentRef),
		window: copySetupWindow(input.window),
		candleType: config.candleType,
		scale: config.scale,
		priceAdjustment: config.priceAdjustment,
		normalization: copyNormalization(input.normalization ?? DEFAULT_NORMALIZATION),
		studies: input.state.studies.map(capturedStudy),
		comparisons: config.comparisons.map(copyComparison),
		annotations: input.state.annotations.map(capturedAnnotation),
		provenance: input.provenance
	};
}

function validateCaptureInput(input: CaptureInput): string[] {
	const issues: string[] = [];
	if (typeof input.setupId !== 'string' || input.setupId.length === 0) {
		issues.push('setup_id: expected a stable setup ID.');
	}
	if (!isIsoTimestamp(input.capturedAt)) {
		issues.push(`captured_at: "${String(input.capturedAt)}" is not an ISO timestamp.`);
	}
	if (typeof input.sourcePanelId !== 'string' || input.sourcePanelId.length === 0) {
		issues.push('source_panel_id: expected the chart panel this was captured from.');
	}
	if (!isRecord(input.state) || !isRecord(input.state.config)) {
		return [...issues, 'state: expected the chart state to capture.'];
	}
	if (!input.state.config.instrument) {
		issues.push(
			'instrument: this chart has no instrument, so there is nothing to capture. ' +
				'Point the chart at a resolved instrument ID first.'
		);
	}
	issues.push(...validateSetupWindow(input.window, 'window'));
	if (!isRecord(input.provenance)) {
		issues.push('provenance: expected the provenance of the data the capture was taken from.');
	}
	return issues;
}

function toWireInstrument(ref: InstrumentRef): Record<string, unknown> {
	return {
		instrument_id: ref.instrumentId,
		symbol: ref.symbol,
		exchange: ref.exchange,
		asset_type: ref.assetType
	};
}

function toWireWindow(window: SetupWindow): Record<string, unknown> {
	const wire: Record<string, unknown> = {
		start: window.start,
		end: window.end,
		timeframe: window.timeframe,
		session: window.session,
		bar_count: window.barCount
	};
	if (window.anchorTime !== undefined) {
		wire.anchor_time = window.anchorTime;
	}
	return wire;
}

function toWireAnchors(anchors: AnnotationAnchors): Record<string, unknown> {
	switch (anchors.kind) {
		case 'trendline':
			return {
				from: { time: anchors.from.time, price: anchors.from.price },
				to: { time: anchors.to.time, price: anchors.to.price }
			};
		case 'price_level':
			return { price: anchors.price };
		case 'date_range':
		case 'setup_window':
			return { start: anchors.start, end: anchors.end };
		case 'label':
			return { time: anchors.at.time, price: anchors.at.price, text: anchors.text };
	}
}

function toWireAnnotation(annotation: CapturedAnnotation): Record<string, unknown> {
	const wire: Record<string, unknown> = {
		annotation_id: annotation.annotationId,
		kind: annotation.kind,
		anchors: toWireAnchors(annotation.anchors),
		price_adjustment: annotation.priceAdjustment
	};
	if (annotation.label !== undefined) {
		wire.label = annotation.label;
	}
	return wire;
}

function toWireStudy(study: CapturedStudy): Record<string, unknown> {
	return {
		study_id: study.studyId,
		catalog_item_id: study.catalogItemId,
		params: { ...study.params },
		pane: study.pane,
		order: study.order,
		enabled: study.enabled
	};
}

function toWireComparison(comparison: ComparisonRef): Record<string, unknown> {
	return {
		instrument: toWireInstrument(comparison.instrument),
		normalization: { mode: comparison.normalization.mode, anchor: comparison.normalization.anchor }
	};
}

// The single snake_case serializer for this contract. Provenance is delegated
// to its own owner rather than hand-serialized here, so the two can never
// disagree about a field name.
export function toWireCapturedSetup(setup: CapturedChartSetup): Record<string, unknown> {
	const wire: Record<string, unknown> = {
		setup_id: setup.setupId,
		captured_at: setup.capturedAt,
		workspace_revision: setup.workspaceRevision,
		source_panel_id: setup.sourcePanelId,
		instrument: toWireInstrument(setup.instrument),
		window: toWireWindow(setup.window),
		candle_type: setup.candleType,
		scale: setup.scale,
		price_adjustment: setup.priceAdjustment,
		normalization: { mode: setup.normalization.mode, anchor: setup.normalization.anchor },
		studies: setup.studies.map(toWireStudy),
		comparisons: setup.comparisons.map(toWireComparison),
		annotations: (setup.annotations ?? []).map(toWireAnnotation),
		provenance: toWireProvenance(setup.provenance)
	};
	if (setup.name !== undefined) {
		wire.name = setup.name;
	}
	if (setup.notes !== undefined) {
		wire.notes = setup.notes;
	}
	return wire;
}

// Normalize-on-read: a persisted setup that cannot be read back as a complete
// record is dropped rather than half-restored, because a partial setup is
// exactly what this contract promises never to hand downstream.
export function normalizeCapturedSetup(value: unknown): CapturedChartSetup | null {
	if (!isRecord(value) || typeof value.setupId !== 'string' || value.setupId.length === 0) {
		return null;
	}
	const instrument = normalizeInstrumentRef(value.instrument);
	if (!instrument || !isIsoTimestamp(value.capturedAt)) {
		return null;
	}
	if (validateSetupWindow(value.window, 'window').length > 0 || !isRecord(value.provenance)) {
		return null;
	}
	const studies = normalizeStudies(value.studies).map(capturedStudy);
	return {
		setupId: value.setupId,
		capturedAt: value.capturedAt,
		workspaceRevision: typeof value.workspaceRevision === 'number' ? value.workspaceRevision : 1,
		sourcePanelId: typeof value.sourcePanelId === 'string' ? value.sourcePanelId : '',
		...(typeof value.name === 'string' ? { name: value.name } : {}),
		...(typeof value.notes === 'string' ? { notes: value.notes } : {}),
		instrument,
		window: copySetupWindow(value.window as SetupWindow),
		candleType: isChartCandleType(value.candleType) ? value.candleType : 'candlestick',
		scale: isChartScale(value.scale) ? value.scale : 'linear',
		priceAdjustment: isChartPriceAdjustment(value.priceAdjustment)
			? value.priceAdjustment
			: 'adjusted',
		normalization: normalizeNormalization(value.normalization),
		studies,
		comparisons: normalizeComparisons(value.comparisons),
		annotations: normalizeAnnotations(normalizedAnnotationSource(value.annotations)).map(
			capturedAnnotation
		),
		// Passed through as stored rather than re-validated field by field:
		// provenance is another epic's contract, and a chart normalizer that
		// second-guessed its shape would be a second, drifting definition of it.
		provenance: value.provenance as unknown as MarketDataProvenance
	};
}

// Captured annotations key their ID as `annotationId`; the annotation
// normalizer expects the chart's `id`. Mapping here keeps both wire shapes
// stable rather than compromising one for the other.
function normalizedAnnotationSource(value: unknown): unknown {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((entry) =>
		isRecord(entry) && typeof entry.annotationId === 'string'
			? { ...entry, id: entry.annotationId }
			: entry
	);
}

function setupExtension(doc: WorkspaceDocument): Record<string, unknown> {
	const raw = doc.extensions[CAPTURED_SETUP_EXTENSION_KEY];
	return isRecord(raw) ? raw : {};
}

export function readCapturedSetup(
	doc: WorkspaceDocument,
	setupId: ResourceId
): CapturedChartSetup | null {
	return normalizeCapturedSetup(setupExtension(doc)[setupId]);
}

export function readCapturedSetups(doc: WorkspaceDocument): CapturedChartSetup[] {
	const out: CapturedChartSetup[] = [];
	for (const entry of Object.values(setupExtension(doc))) {
		const setup = normalizeCapturedSetup(entry);
		if (setup) {
			out.push(setup);
		}
	}
	return out;
}

// Returns a new document; the input is never mutated. A capture never replaces
// an earlier one -- each gets its own setup ID -- so repeated captures from the
// same chart accumulate rather than overwrite.
export function writeCapturedSetup(
	doc: WorkspaceDocument,
	setup: CapturedChartSetup
): WorkspaceDocument {
	return {
		...doc,
		extensions: {
			...doc.extensions,
			[CAPTURED_SETUP_EXTENSION_KEY]: { ...setupExtension(doc), [setup.setupId]: setup }
		}
	};
}

// High-water mark for `createIdSequencer`, so a reloaded workspace never mints
// a setup ID that an existing capture already holds.
export function capturedSetupIdSeed(doc: WorkspaceDocument): Record<string, number> {
	const seed: Record<string, number> = {};
	for (const setupId of Object.keys(setupExtension(doc))) {
		const parsed = parseId(setupId);
		if (!parsed || parsed.kind !== 'setup') {
			continue;
		}
		const key = parsed.discriminator ? `setup:${parsed.discriminator}` : 'setup';
		seed[key] = Math.max(seed[key] ?? 0, parsed.sequence);
	}
	return seed;
}
