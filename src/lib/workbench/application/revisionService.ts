// The program's single write path (T-1006-5). Every mutation in the
// program calls `commit` rather than writing through WorkspaceRepository
// directly -- nothing else in the codebase increments a revision or
// decides whether a write is safe.
import { RevisionConflictError } from '../domain/errors';
import type { IdSequencer, ResourceId } from '../domain/ids';
import { buildEnvelope } from '../domain/mutation';
import type { MutationContext, MutationEnvelope } from '../domain/mutation';
import type { Clock, WorkspaceRepository } from '../domain/ports';
import { normalizeWorkspace } from '../domain/workspace';
import type { WorkspaceDocument } from '../domain/workspace';
import { fingerprintRequest } from './idempotency';
import type { IdempotencyCache } from './idempotency';

export interface MutationDraft {
	// The next state; commit stamps `revision`/`updatedAt` itself.
	document: WorkspaceDocument;
	affectedIds: ResourceId[];
	diffSummary: string;
	warnings?: string[];
	// Omit or null to make the change non-undoable.
	inverse?: MutationDraft | null;
}

export interface RevisionService {
	commit(input: {
		workspaceId: ResourceId;
		context: MutationContext;
		// Used to fingerprint the request for idempotency-key replay
		// detection -- a technical.md refinement this ticket's code owns,
		// since a closure alone can't be hashed. Omit only when the caller
		// never expects idempotencyKey to be set.
		operationKind?: string;
		requestInput?: unknown;
		mutate(doc: WorkspaceDocument): MutationDraft;
	}): MutationEnvelope;
}

export function createRevisionService(deps: {
	repository: WorkspaceRepository;
	clock: Clock;
	ids: IdSequencer;
	idempotency: IdempotencyCache;
}): RevisionService {
	function loadCurrent(workspaceId: ResourceId): WorkspaceDocument {
		return deps.repository.get(workspaceId) ?? normalizeWorkspace({ id: workspaceId });
	}

	// Throws RevisionConflictError on mismatch; otherwise appends the
	// deliberate missing-expected_revision warning (epic Open Question 4).
	function checkExpectedRevision(
		current: WorkspaceDocument,
		context: MutationContext,
		warnings: string[]
	): void {
		if (context.expectedRevision === undefined) {
			warnings.push('Applied without expected_revision: no concurrency check was performed.');
			return;
		}
		if (context.expectedRevision !== current.revision) {
			throw new RevisionConflictError(context.expectedRevision, current.revision, []);
		}
	}

	function recordSuccess(
		workspaceId: ResourceId,
		current: WorkspaceDocument,
		draft: MutationDraft,
		warnings: string[]
	): MutationEnvelope {
		const newRevision = current.revision + 1;
		const now = deps.clock.now();
		const nextDoc: WorkspaceDocument = { ...draft.document, revision: newRevision, updatedAt: now };
		deps.repository.put(nextDoc);
		deps.repository.putRevision({
			workspaceId,
			revision: newRevision,
			name: null,
			savedAt: now,
			document: nextDoc
		});
		const changeId = deps.ids.next('change');
		const undoToken = draft.inverse ? deps.ids.next('undo') : null;
		return buildEnvelope({
			changeId,
			newRevision,
			affectedIds: draft.affectedIds,
			diffSummary: draft.diffSummary,
			warnings: [...(draft.warnings ?? []), ...warnings],
			undoToken
		});
	}

	return {
		commit(input): MutationEnvelope {
			const fingerprint = fingerprintRequest(input.operationKind ?? 'unknown', input.requestInput);
			if (input.context.idempotencyKey) {
				const replay = deps.idempotency.lookup(input.context.idempotencyKey, fingerprint);
				if (replay) {
					return replay;
				}
			}

			const current = loadCurrent(input.workspaceId);
			const warnings: string[] = [];
			checkExpectedRevision(current, input.context, warnings);

			// If mutate() throws, nothing below runs: no repository write, no
			// idempotency record (AC6).
			const draft = input.mutate(current);
			const envelope = recordSuccess(input.workspaceId, current, draft, warnings);

			if (input.context.idempotencyKey) {
				deps.idempotency.remember(input.context.idempotencyKey, fingerprint, envelope);
			}
			return envelope;
		}
	};
}
