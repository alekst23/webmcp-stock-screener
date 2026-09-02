// Pure data contracts for the safety layer: what a proposed batch is, what a
// preview reports, and how per-operation failures and warnings are carried.
// No I/O, no clock, no ID generation -- see
// docs/design/safety-preview-apply/technical.md's layering table.
import type { ResourceId } from './ids';
import type { Revision, WorkspaceDocument } from './workspace';

// `kind` is a key into the operation registry, typed as a bare string rather
// than a union: kinds are contributed by sibling epics, and a newly registered
// one must not require an edit here.
export interface ProposedOperation {
	kind: string;
	// Only the kind's registered validator knows this shape.
	input: unknown;
}

// A plain array, so batch ordering is structurally significant: evaluation
// folds left to right and a later operation sees an earlier one's effect.
export type ChangeBatch = ProposedOperation[];

// `index` addresses the offending operation by its position in the batch,
// which is the only stable handle a proposed (not yet applied) operation has.
export interface OperationFailure {
	index: number;
	kind: string;
	reason: string;
}

// A separate interface from OperationFailure rather than a severity flag on a
// shared one, so applicability can never hinge on a mis-set enum value.
export interface OperationWarning {
	index: number;
	kind: string;
	message: string;
}

export interface OperationOutcome {
	index: number;
	kind: string;
	describe: string;
	// Held per-operation as well as batch-wide so a caller can render one
	// operation's detail without filtering the batch lists by index.
	failures: OperationFailure[];
	warnings: OperationWarning[];
}

export type DiffChangeType = 'added' | 'removed' | 'updated';

export interface FieldChange {
	field: string;
	before: unknown;
	after: unknown;
}

// `entityType` is a free string ('panel', 'link', 'workspace', or an
// extension key) for the same reason `kind` is: entity types arrive from
// sibling epics and must not be enumerated here.
export interface DiffEntry {
	change: DiffChangeType;
	entityType: string;
	id: ResourceId;
	// Empty for added and removed; for updated, only the fields that actually
	// changed, each with its before and after value.
	fields: FieldChange[];
}

export type WorkspaceDiff = DiffEntry[];

export interface PreviewResult {
	previewId: ResourceId;
	baseRevision: Revision;
	diff: WorkspaceDiff;
	affectedIds: ResourceId[];
	summary: string;
	warnings: OperationWarning[];
	failures: OperationFailure[];
	outcomes: OperationOutcome[];
	applicable: boolean;
}

// What the preview store persists. Apply commits `candidate` rather than
// re-folding the batch, which is what makes the honesty guarantee structural
// instead of a promise.
export interface PreviewRecord {
	previewId: ResourceId;
	baseRevision: Revision;
	candidate: WorkspaceDocument;
	result: PreviewResult;
}

// Warnings are advisory and never block; any failure does.
export function isApplicable(failures: readonly OperationFailure[]): boolean {
	return failures.length === 0;
}

// First-appearance order, deduplicated, so the same batch always reports the
// same affected_ids sequence.
export function collectAffectedIds(diff: readonly DiffEntry[]): ResourceId[] {
	const seen = new Set<ResourceId>();
	const ids: ResourceId[] = [];
	for (const entry of diff) {
		if (!seen.has(entry.id)) {
			seen.add(entry.id);
			ids.push(entry.id);
		}
	}
	return ids;
}

// Derives affectedIds and applicable rather than accepting them, so a result
// cannot be built with a diff and an affected-ID list that disagree.
export function buildPreviewResult(input: {
	previewId: ResourceId;
	baseRevision: Revision;
	diff: WorkspaceDiff;
	summary: string;
	warnings?: OperationWarning[];
	failures?: OperationFailure[];
	outcomes?: OperationOutcome[];
}): PreviewResult {
	const failures = input.failures ?? [];
	return {
		previewId: input.previewId,
		baseRevision: input.baseRevision,
		diff: input.diff,
		affectedIds: collectAffectedIds(input.diff),
		summary: input.summary,
		warnings: input.warnings ?? [],
		failures,
		outcomes: input.outcomes ?? [],
		applicable: isApplicable(failures)
	};
}

export interface WireFieldChange {
	field: string;
	before: unknown;
	after: unknown;
}

export interface WireDiffEntry {
	change: DiffChangeType;
	entity_type: string;
	id: string;
	fields: WireFieldChange[];
}

export interface WireOperationFailure {
	index: number;
	kind: string;
	reason: string;
}

export interface WireOperationWarning {
	index: number;
	kind: string;
	message: string;
}

export interface WireOperationOutcome {
	index: number;
	kind: string;
	describe: string;
	failures: WireOperationFailure[];
	warnings: WireOperationWarning[];
}

export interface WirePreviewResult {
	preview_id: string;
	base_revision: number;
	diff: WireDiffEntry[];
	affected_ids: string[];
	diff_summary: string;
	warnings: WireOperationWarning[];
	failures: WireOperationFailure[];
	per_operation: WireOperationOutcome[];
	applicable: boolean;
}

function toWireDiffEntry(entry: DiffEntry): WireDiffEntry {
	return {
		change: entry.change,
		entity_type: entry.entityType,
		id: entry.id,
		fields: entry.fields.map((field) => ({
			field: field.field,
			before: field.before,
			after: field.after
		}))
	};
}

function toWireOutcome(outcome: OperationOutcome): WireOperationOutcome {
	return {
		index: outcome.index,
		kind: outcome.kind,
		describe: outcome.describe,
		failures: outcome.failures.map(toWireFailure),
		warnings: outcome.warnings.map(toWireWarning)
	};
}

function toWireFailure(failure: OperationFailure): WireOperationFailure {
	return { index: failure.index, kind: failure.kind, reason: failure.reason };
}

function toWireWarning(warning: OperationWarning): WireOperationWarning {
	return { index: warning.index, kind: warning.kind, message: warning.message };
}

// The only function in this module allowed to emit snake_case keys.
export function toWirePreviewResult(result: PreviewResult): WirePreviewResult {
	return {
		preview_id: result.previewId,
		base_revision: result.baseRevision,
		diff: result.diff.map(toWireDiffEntry),
		affected_ids: result.affectedIds,
		diff_summary: result.summary,
		warnings: result.warnings.map(toWireWarning),
		failures: result.failures.map(toWireFailure),
		per_operation: result.outcomes.map(toWireOutcome),
		applicable: result.applicable
	};
}
