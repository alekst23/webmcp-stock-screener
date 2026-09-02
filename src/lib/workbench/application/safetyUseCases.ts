// The epic's two use cases: preview a batch and atomically apply a
// previewed batch. Composes the single evaluation path (batchEvaluation),
// the diff (workspaceDiff), the preview store, and the revision service --
// nothing here re-implements any of them. See
// docs/design/safety-preview-apply/technical.md, "The central decision:
// one evaluation path".
import { evaluateBatch } from '../domain/batchEvaluation';
import type { IdSequencer, ResourceId } from '../domain/ids';
import type { Actor, MutationEnvelope } from '../domain/mutation';
import type { Clock, WorkspaceRepository } from '../domain/ports';
import type { ChangeBatch, PreviewRecord, PreviewResult } from '../domain/preview';
import { buildPreviewResult } from '../domain/preview';
import { SafetyError } from '../domain/previewErrors';
import type { Revision, WorkspaceDocument } from '../domain/workspace';
import { diffWorkspaces, summarizeDiff } from '../domain/workspaceDiff';
import type { PreviewStore } from '../infra/previewStore';
import { recordCommit } from './changeHistory';
import type { ChangeHistory } from './changeHistory';
import { fingerprintRequest } from './idempotency';
import type { IdempotencyCache } from './idempotency';
import type { OperationRegistry } from './operationRegistry';
import type { MutationDraft, RevisionService } from './revisionService';

export interface SafetyDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	previews: PreviewStore;
	idempotency: IdempotencyCache;
	clock: Clock;
	ids: IdSequencer;
}

// The one operation kind this file's fingerprints are computed against --
// shared between the top-level idempotency check and the commit passed to
// RevisionService, so both agree on what "the same request" means.
const APPLY_OPERATION_KIND = 'workbench.apply_previewed_changes';

function resolveWorkspace(
	workspaceId: ResourceId | undefined,
	deps: SafetyDeps
): WorkspaceDocument {
	const id = workspaceId ?? deps.repository.getActiveId();
	if (!id) {
		throw SafetyError.invalidInput('No workspace is active and none was specified.');
	}
	const doc = deps.repository.get(id);
	if (!doc) {
		throw SafetyError.invalidInput(`No workspace found with id "${id}".`);
	}
	return doc;
}

export function previewWorkspaceChanges(
	input: { batch: ChangeBatch; workspaceId?: ResourceId },
	deps: SafetyDeps
): PreviewResult {
	const doc = resolveWorkspace(input.workspaceId, deps);
	const evaluation = evaluateBatch(input.batch, doc, { registry: deps.registry, ids: deps.ids });
	const diff = evaluation.candidate ? diffWorkspaces(doc, evaluation.candidate) : [];
	const summary = summarizeDiff(diff, evaluation.fragments);
	const previewId = deps.previews.nextPreviewId();
	// Never a hand-assembled PreviewResult literal: buildPreviewResult derives
	// affectedIds/applicable from the diff and failures, so the two can never
	// disagree with each other.
	const result = buildPreviewResult({
		previewId,
		baseRevision: doc.revision,
		diff,
		summary,
		warnings: evaluation.warnings,
		failures: evaluation.failures,
		outcomes: evaluation.outcomes
	});
	// Nothing above this line, nor this call, touches the repository -- a
	// preview commits nothing (AC2), valid or not.
	deps.previews.put({
		previewId,
		baseRevision: doc.revision,
		candidate: evaluation.candidate ?? doc,
		result
	});
	return result;
}

function replayIfIdempotent(
	previewId: ResourceId,
	idempotencyKey: string | undefined,
	deps: SafetyDeps
): MutationEnvelope | null {
	if (!idempotencyKey) {
		return null;
	}
	const fingerprint = fingerprintRequest(APPLY_OPERATION_KIND, { previewId });
	return deps.idempotency.lookup(idempotencyKey, fingerprint);
}

function lookupApplicablePreview(previewId: ResourceId, deps: SafetyDeps): PreviewRecord {
	const lookup = deps.previews.get(previewId);
	if (lookup.status === 'not_found') {
		throw SafetyError.unknownPreview(previewId);
	}
	if (lookup.status === 'expired') {
		throw SafetyError.expiredPreview(previewId);
	}
	if (lookup.status === 'consumed') {
		throw SafetyError.alreadyApplied(previewId);
	}
	if (!lookup.record) {
		// Unreachable per PreviewStore's own contract (status 'found' always
		// carries a record); guarded so no cast is needed to narrow the type.
		throw SafetyError.unknownPreview(previewId);
	}
	if (!lookup.record.result.applicable) {
		throw SafetyError.notApplicable(lookup.record.result.failures);
	}
	return lookup.record;
}

function loadCurrentDocument(
	workspaceId: ResourceId,
	baseRevision: Revision,
	deps: SafetyDeps
): WorkspaceDocument {
	const current = deps.repository.get(workspaceId);
	if (!current || current.revision !== baseRevision) {
		throw SafetyError.staleRevision(baseRevision, current?.revision ?? 0);
	}
	return current;
}

function checkPrecondition(
	expectedRevision: Revision | undefined,
	baseRevision: Revision,
	currentRevision: Revision
): void {
	// By the time this runs, loadCurrentDocument has already confirmed
	// baseRevision === currentRevision, so disagreeing with one is
	// disagreeing with both.
	if (expectedRevision !== undefined && expectedRevision !== baseRevision) {
		throw SafetyError.preconditionMismatch(expectedRevision, baseRevision, currentRevision);
	}
}

function reversalSentence(summary: string): string {
	return `Reverted: ${summary}`;
}

// Exactly one inverse for the whole batch -- never one per operation -- so
// exactly one undo_token is issued per applied batch (AC11).
function buildApplyDraft(record: PreviewRecord, preApply: WorkspaceDocument): MutationDraft {
	return {
		document: record.candidate,
		affectedIds: record.result.affectedIds,
		diffSummary: record.result.summary,
		warnings: record.result.warnings.map((warning) => warning.message),
		inverse: {
			document: preApply,
			affectedIds: record.result.affectedIds,
			diffSummary: reversalSentence(record.result.summary)
		}
	};
}

function commitPreviewedChanges(
	record: PreviewRecord,
	input: { expectedRevision?: Revision; idempotencyKey?: string; actor?: Actor },
	preApply: WorkspaceDocument,
	deps: SafetyDeps
): MutationEnvelope {
	return recordCommit(
		{ history: deps.history, revisionService: deps.revisions, clock: deps.clock },
		{
			workspaceId: record.candidate.id,
			context: {
				// Always the preview's own base revision, never a read-then-write:
				// the revision service performs its own compare-and-swap, and this
				// also suppresses the "applied without expected_revision" warning.
				expectedRevision: record.baseRevision,
				idempotencyKey: input.idempotencyKey,
				actor: input.actor ?? 'agent'
			},
			operationKind: APPLY_OPERATION_KIND,
			requestInput: { previewId: record.previewId },
			mutate: () => buildApplyDraft(record, preApply)
		}
	);
}

// RevisionService.recordSuccess writes the advanced document with
// repository.put and only then writes the revision snapshot with
// repository.putRevision -- so a failure in between is a real half-applied
// state: the document moved but no revision was recorded for it. Restoring
// the pre-apply document closes that window instead of leaving it
// observable.
function rollbackIfNeeded(
	workspaceId: ResourceId,
	pristine: WorkspaceDocument,
	deps: SafetyDeps
): void {
	const stored = deps.repository.get(workspaceId);
	if (stored !== null && JSON.stringify(stored) !== JSON.stringify(pristine)) {
		deps.repository.put(pristine);
	}
}

export function applyPreviewedChanges(
	input: {
		previewId: ResourceId;
		expectedRevision?: Revision;
		idempotencyKey?: string;
		actor?: Actor;
	},
	deps: SafetyDeps
): MutationEnvelope {
	// Checked before the preview store: a successful apply marks the preview
	// consumed, so checking the store first would tell an idempotent retry
	// it was "already applied" instead of replaying its original result.
	const replay = replayIfIdempotent(input.previewId, input.idempotencyKey, deps);
	if (replay) {
		return replay;
	}

	const record = lookupApplicablePreview(input.previewId, deps);
	const workspaceId = record.candidate.id;
	const current = loadCurrentDocument(workspaceId, record.baseRevision, deps);
	checkPrecondition(input.expectedRevision, record.baseRevision, current.revision);

	const pristine = structuredClone(current);
	try {
		const envelope = commitPreviewedChanges(record, input, pristine, deps);
		deps.previews.markConsumed(input.previewId);
		return envelope;
	} catch (err) {
		rollbackIfNeeded(workspaceId, pristine, deps);
		throw err;
	}
}
