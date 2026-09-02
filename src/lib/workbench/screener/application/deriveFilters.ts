// T-1014-3: `derive_filters_from_setup`'s "derive" half -- a heuristic,
// deliberately small and disclosed mapping from a captured chart setup
// (EPIC-1011) onto a draft filter tree built from EPIC-1009's own typed
// condition model. See this ticket's Solution Approach in
// docs/plan/EPIC-1014/T-1014-3-derive-filters-from-setup.md for the full
// rationale; this file is the implementation of that heuristic plus the
// `screener.derive_filter_draft` operation that runs it through EPIC-1006's
// write path.
//
// Application layer: orchestrates EPIC-1009's condition model, EPIC-1011's
// captured setup, EPIC-1008's catalog and EPIC-1006's operation registry.
// No I/O beyond the injected Clock.
import { builtinCatalogRegistry, type CatalogRegistry } from '../../../catalog/registry';
import type {
	CapturedAnnotation,
	CapturedChartSetup,
	CapturedStudy
} from '../../chart/domain/capturedSetup';
import { readCapturedSetup } from '../../chart/domain/capturedSetup';
import type { Condition, RangeCondition, StudyOutputCondition } from '../../../screener/conditions';
import { readScreener } from '../../../screener/state';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import { OperationValidationError } from '../../domain/errors';
import type { IdSequencer, ResourceId } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { DraftConditionProvenance, FilterDraft } from '../domain/filterDraft';
import { writeFilterDraft } from '../domain/filterDraft';

export const DERIVE_FILTER_DRAFT_KIND = 'screener.derive_filter_draft';

// A width derived from one example is a guess, not a measurement -- prefer a
// stated-tolerance range over an exact-value equality condition (ticket's
// Technical Considerations).
export const DRAFT_PRICE_TOLERANCE = 0.02;

// Keeps the draft short and legible rather than exhaustive (ticket's
// Technical Considerations: "a short, legible draft beats a long,
// unexplained one").
export const MAX_DRAFT_CONDITIONS = 6;

const PRICE_FIELD_ID = 'field.price.close';

export interface DeriveFiltersFromSetupInput {
	setupId: ResourceId;
	// Optional hint carried onto the draft; used here only to sanity-check the
	// screener exists, not to alter derivation.
	targetScreenerId?: ResourceId;
}

interface CandidateCondition {
	condition: Condition;
	characteristic: string;
	explanation: string;
	// A short, warning-facing name for what this condition depends on (a
	// study or field id), so AC7's "a warning names each one" names the
	// actual catalog item, not just the generic characteristic tag.
	label: string;
	// The catalog item id(s) this condition's usability depends on -- checked
	// for availability before the node is enabled.
	dependsOn: string[];
}

function describeParams(params: Record<string, unknown>): string {
	const entries = Object.entries(params);
	return entries.length === 0
		? '(defaults)'
		: entries.map(([k, v]) => `${k}=${String(v)}`).join(', ');
}

// One study_output candidate per enabled attached study, in the chart's own
// display order. No computed value was captured, so the predicate ("rising")
// is a disclosed guess -- there is no signal in a CapturedChartSetup that
// says which direction the study's output was actually moving.
function studyCandidates(
	setup: CapturedChartSetup,
	registry: CatalogRegistry
): CandidateCondition[] {
	const enabled = setup.studies.filter((s: CapturedStudy) => s.enabled);
	const ordered = [...enabled].sort((a, b) => a.order - b.order);
	const out: CandidateCondition[] = [];
	for (const study of ordered) {
		const item = registry.resolveStudy(study.catalogItemId);
		const output = item?.outputs[0];
		if (!item || !output) {
			continue; // not a known, filterable study -- nothing to derive
		}
		const condition: StudyOutputCondition = {
			type: 'study_output',
			studyId: item.id,
			params: { ...study.params },
			outputName: output.name,
			predicate: 'rising'
		};
		out.push({
			condition,
			characteristic: 'study',
			label: item.id,
			dependsOn: [item.id],
			explanation:
				`Derived from the "${item.label}" study attached to the captured chart ` +
				`(params: ${describeParams(study.params)}). The "rising" predicate is a guess from a ` +
				'single example -- no computed value was captured, so confirm the actual direction ' +
				'before relying on this filter.'
		});
	}
	return out;
}

function round(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}

function tolerantRange(a: number, b: number): { lower: number; upper: number } {
	const lo = Math.min(a, b);
	const hi = Math.max(a, b);
	return {
		lower: round(lo * (1 - DRAFT_PRICE_TOLERANCE)),
		upper: round(hi * (1 + DRAFT_PRICE_TOLERANCE))
	};
}

// Only the three annotation kinds that carry a price produce a candidate;
// date_range and setup_window carry no price and are not mapped.
function annotationRange(annotation: CapturedAnnotation): { lower: number; upper: number } | null {
	switch (annotation.anchors.kind) {
		case 'price_level':
			return tolerantRange(annotation.anchors.price, annotation.anchors.price);
		case 'label':
			return tolerantRange(annotation.anchors.at.price, annotation.anchors.at.price);
		case 'trendline':
			return tolerantRange(annotation.anchors.from.price, annotation.anchors.to.price);
		default:
			return null;
	}
}

function annotationCandidates(setup: CapturedChartSetup): CandidateCondition[] {
	const out: CandidateCondition[] = [];
	for (const annotation of setup.annotations ?? []) {
		const range = annotationRange(annotation);
		if (!range) {
			continue;
		}
		const condition: RangeCondition = {
			type: 'range',
			fieldId: PRICE_FIELD_ID,
			lower: range.lower,
			upper: range.upper,
			lowerInclusive: true,
			upperInclusive: true
		};
		out.push({
			condition,
			characteristic: `annotation.${annotation.kind}`,
			label: PRICE_FIELD_ID,
			dependsOn: [PRICE_FIELD_ID],
			explanation:
				`Derived from a "${annotation.kind}" annotation drawn on the captured chart. The bound ` +
				`is a ±${DRAFT_PRICE_TOLERANCE * 100}% tolerance band around the annotated price, ` +
				'not an exact-match requirement -- narrow or widen it as needed.'
		});
	}
	return out;
}

interface AvailabilityCheck {
	available: boolean;
	reason: string | null;
}

// AC7: every catalog item a candidate depends on is checked for
// availability.status === 'unavailable'. Nothing about this is
// universe-scoped -- this catalog has no per-universe availability model
// today (see universeValidation.ts), so "no data available for the target
// universe" is, honestly, "no data available at all" for this project.
function checkAvailability(
	candidate: CandidateCondition,
	registry: CatalogRegistry
): AvailabilityCheck {
	for (const id of candidate.dependsOn) {
		const item = registry.getCatalogItem(id);
		if (item && item.availability.status === 'unavailable') {
			return { available: false, reason: item.availability.reason };
		}
	}
	return { available: true, reason: null };
}

export interface DerivedDraft {
	tree: FilterDraft['tree'];
	provenance: DraftConditionProvenance[];
	warnings: string[];
}

// AC8 (nothing derivable): distinct from AC7 (unavailable) -- this fires
// only when the setup has no studies and no price-bearing annotations to
// begin with, never when a candidate existed but its data is unavailable.
function emptyDraftResult(ids: IdSequencer): DerivedDraft {
	const rootId = ids.next('filter');
	return {
		tree: { nodeId: rootId, kind: 'group', op: 'and', children: [], enabled: true },
		provenance: [],
		warnings: [
			'Nothing in this setup mapped to a supported filter condition: no enabled studies and no ' +
				'price-bearing annotations were found on the captured chart.'
		]
	};
}

export function deriveDraftConditions(
	setup: CapturedChartSetup,
	registry: CatalogRegistry,
	ids: IdSequencer
): DerivedDraft {
	const candidates = [...studyCandidates(setup, registry), ...annotationCandidates(setup)];
	if (candidates.length === 0) {
		return emptyDraftResult(ids);
	}
	const included = candidates.slice(0, MAX_DRAFT_CONDITIONS);
	const droppedCount = candidates.length - included.length;

	const rootId = ids.next('filter');
	const provenance: DraftConditionProvenance[] = [];
	const warnings: string[] = [];
	const children: FilterDraft['tree'][] = [];
	for (const candidate of included) {
		const nodeId = ids.next('filter');
		const availability = checkAvailability(candidate, registry);
		children.push({
			nodeId,
			kind: 'condition',
			condition: candidate.condition,
			enabled: availability.available
		});
		provenance.push({
			nodeId,
			characteristic: candidate.characteristic,
			explanation: candidate.explanation
		});
		if (!availability.available) {
			warnings.push(
				`Condition on node ${nodeId}, derived from "${candidate.label}" (${candidate.characteristic}), ` +
					`was created disabled: ${availability.reason}`
			);
		}
	}
	if (droppedCount > 0) {
		warnings.push(
			`${droppedCount} additional derivable condition(s) were left out to keep the draft short ` +
				`(limit ${MAX_DRAFT_CONDITIONS}).`
		);
	}
	return {
		tree: { nodeId: rootId, kind: 'group', op: 'and', children, enabled: true },
		provenance,
		warnings
	};
}

function validateDeriveInput(input: DeriveFiltersFromSetupInput, doc: WorkspaceDocument): string[] {
	const issues: string[] = [];
	if (!input.setupId) {
		issues.push('setup_id is required.');
	} else if (!readCapturedSetup(doc, input.setupId)) {
		issues.push(`Unknown setup id: ${input.setupId}.`);
	}
	if (input.targetScreenerId !== undefined && !readScreener(doc, input.targetScreenerId)) {
		issues.push(`Unknown screener id: ${input.targetScreenerId}.`);
	}
	return issues;
}

function applyDerive(
	input: DeriveFiltersFromSetupInput,
	doc: WorkspaceDocument,
	ids: IdSequencer,
	now: string,
	registry: CatalogRegistry
): MutationDraft {
	const setup = readCapturedSetup(doc, input.setupId);
	if (!setup) {
		throw new OperationValidationError([`Unknown setup id: ${input.setupId}.`]); // unreachable after validate()
	}
	const { tree, provenance, warnings } = deriveDraftConditions(setup, registry, ids);
	const draftId = ids.next('filter', 'draft');
	const draft: FilterDraft = {
		draftId,
		sourceSetupId: setup.setupId,
		createdAt: now,
		sourceRevision: doc.revision,
		...(input.targetScreenerId !== undefined ? { targetScreenerId: input.targetScreenerId } : {}),
		tree,
		provenance
	};
	return {
		document: writeFilterDraft(doc, draft),
		affectedIds: [draftId, setup.setupId],
		diffSummary:
			`Derived filter draft ${draftId} from captured setup ${setup.setupId} ` +
			`(${provenance.length} condition(s)).`,
		warnings,
		inverse: {
			document: doc,
			affectedIds: [draftId, setup.setupId],
			diffSummary: `Discarded filter draft ${draftId}.`
		}
	};
}

const DERIVE_FILTER_DRAFT_SCHEMA = {
	type: 'object',
	properties: {
		setupId: { type: 'string' },
		targetScreenerId: { type: 'string' }
	},
	required: ['setupId']
};

export function createDeriveFilterDraftOperation(deps: {
	clock: Clock;
	registry?: CatalogRegistry;
}): OperationDefinition<DeriveFiltersFromSetupInput> {
	const catalog = deps.registry ?? builtinCatalogRegistry;
	return {
		kind: DERIVE_FILTER_DRAFT_KIND,
		inputSchema: DERIVE_FILTER_DRAFT_SCHEMA,
		validate: validateDeriveInput,
		describe: (input) => `Derive a draft filter tree from captured setup ${input.setupId}.`,
		apply: (input, doc, ids) => applyDerive(input, doc, ids, deps.clock.now(), catalog)
	};
}

// Idempotent, mirroring captureSetup.ts's ensureCaptureChartSetupOperation:
// a tool factory can guarantee its operation exists without fighting a
// composition root that registered it first.
export function ensureDeriveFilterDraftOperation(
	registry: OperationRegistry,
	deps: { clock: Clock; registry?: CatalogRegistry }
): void {
	if (!registry.get(DERIVE_FILTER_DRAFT_KIND)) {
		registry.register(createDeriveFilterDraftOperation(deps));
	}
}
