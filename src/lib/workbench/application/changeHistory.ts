// Append-only change log, undo-token issuance/redemption, and restoring a
// workspace to an earlier revision (T-1006-6). Undo and restore both go
// back through RevisionService.commit, so reversing a change is itself a
// numbered, recorded, undoable change -- history grows, it never rewrites.
import { OperationValidationError, UndoTokenError } from '../domain/errors';
import type { ResourceId } from '../domain/ids';
import type { Actor, MutationContext, MutationEnvelope } from '../domain/mutation';
import type { Clock, WorkspaceRepository } from '../domain/ports';
import type { Revision, WorkspaceDocument } from '../domain/workspace';
import type { MutationDraft, RevisionService } from './revisionService';

export type UndoState = 'available' | 'redeemed' | 'superseded' | 'none';

export interface ChangeRecord {
	changeId: ResourceId;
	workspaceId: ResourceId;
	revision: Revision;
	at: string;
	actor: Actor;
	diffSummary: string;
	affectedIds: ResourceId[];
	undoToken: ResourceId | null;
	undoState: UndoState;
	// Internal bookkeeping, never serialized to an agent: the draft
	// undoChange applies to reverse this record. Its own `.inverse` chains
	// back to the forward draft, so undoing an undo redoes the original
	// (AC4). Absent whenever undoToken is null.
	inverseDraft?: MutationDraft | null;
}

const MAX_RECORDS_PER_WORKSPACE = 200;

export interface ChangeHistory {
	append(record: ChangeRecord): void;
	list(workspaceId: ResourceId, options?: { limit?: number; before?: Revision }): ChangeRecord[];
	findByUndoToken(token: ResourceId): ChangeRecord | null;
	markRedeemed(token: ResourceId): void;
}

export function createChangeHistory(): ChangeHistory {
	const byWorkspace = new Map<ResourceId, ChangeRecord[]>();

	function prune(workspaceId: ResourceId): void {
		const records = byWorkspace.get(workspaceId) ?? [];
		if (records.length <= MAX_RECORDS_PER_WORKSPACE) {
			return;
		}
		// Oldest-first pruning that never removes a still-redeemable token.
		const keep = [...records].sort((a, b) => a.revision - b.revision);
		while (keep.length > MAX_RECORDS_PER_WORKSPACE) {
			const oldestIndex = keep.findIndex((r) => r.undoState !== 'available');
			if (oldestIndex === -1) {
				break; // everything left is redeemable; stop pruning
			}
			keep.splice(oldestIndex, 1);
		}
		byWorkspace.set(workspaceId, keep);
	}

	return {
		append(record: ChangeRecord): void {
			const records = byWorkspace.get(record.workspaceId) ?? [];
			records.push(record);
			byWorkspace.set(record.workspaceId, records);
			prune(record.workspaceId);
		},

		list(workspaceId: ResourceId, options?: { limit?: number; before?: Revision }): ChangeRecord[] {
			const records = (byWorkspace.get(workspaceId) ?? [])
				.filter((r) => options?.before === undefined || r.revision < options.before)
				.sort((a, b) => b.revision - a.revision);
			return options?.limit !== undefined ? records.slice(0, options.limit) : records;
		},

		findByUndoToken(token: ResourceId): ChangeRecord | null {
			for (const records of byWorkspace.values()) {
				const found = records.find((r) => r.undoToken === token);
				if (found) {
					return found;
				}
			}
			return null;
		},

		markRedeemed(token: ResourceId): void {
			for (const records of byWorkspace.values()) {
				const found = records.find((r) => r.undoToken === token);
				if (found) {
					found.undoState = 'redeemed';
					return;
				}
			}
		}
	};
}

interface HistoryDeps {
	history: ChangeHistory;
	revisionService: RevisionService;
	clock: Clock;
}

// Commits through the revision service and, unless this was an idempotency
// replay (no new change happened), records the result in the change log.
// The single path every mutating operation in the program should call
// through -- not exported in technical.md's original contract list, but
// necessary so AC1 ("every applied change is recorded") holds regardless
// of which sibling epic or tool initiated the change.
export function recordCommit(
	deps: HistoryDeps,
	input: {
		workspaceId: ResourceId;
		context: MutationContext;
		operationKind?: string;
		requestInput?: unknown;
		mutate(doc: WorkspaceDocument): MutationDraft;
	}
): MutationEnvelope {
	let captured: MutationDraft | null | undefined;
	const envelope = deps.revisionService.commit({
		...input,
		mutate: (doc) => {
			const draft = input.mutate(doc);
			if (draft.inverse) {
				draft.inverse.inverse = draft.inverse.inverse ?? draft;
			}
			captured = draft.inverse ?? null;
			return draft;
		}
	});
	if (captured === undefined) {
		return envelope; // idempotency replay: no new change to record
	}
	deps.history.append({
		changeId: envelope.changeId,
		workspaceId: input.workspaceId,
		revision: envelope.newRevision,
		at: deps.clock.now(),
		actor: input.context.actor,
		diffSummary: envelope.diffSummary,
		affectedIds: envelope.affectedIds,
		undoToken: envelope.undoToken,
		undoState: envelope.undoToken ? 'available' : 'none',
		inverseDraft: captured
	});
	return envelope;
}

export function undoChange(
	token: ResourceId,
	deps: HistoryDeps & { context: MutationContext }
): MutationEnvelope {
	const record = deps.history.findByUndoToken(token);
	if (!record) {
		throw new UndoTokenError('unknown');
	}
	if (record.undoState === 'redeemed') {
		throw new UndoTokenError('already_redeemed');
	}
	if (!record.inverseDraft) {
		throw new UndoTokenError('unknown');
	}
	const newest = deps.history.list(record.workspaceId, { limit: 1 })[0];
	if (!newest || newest.changeId !== record.changeId) {
		throw new UndoTokenError(
			'superseded',
			'This change is no longer the newest change for its workspace; call ' +
				'restore_workspace_revision instead.'
		);
	}

	const inverseDraft = record.inverseDraft;
	const envelope = recordCommit(deps, {
		workspaceId: record.workspaceId,
		context: deps.context,
		operationKind: 'workbench.undo',
		requestInput: { token },
		mutate: () => inverseDraft
	});
	deps.history.markRedeemed(token);
	return envelope;
}

export function restoreRevision(
	workspaceId: ResourceId,
	revision: Revision,
	context: MutationContext,
	deps: HistoryDeps & { repository: WorkspaceRepository }
): MutationEnvelope {
	const target = deps.repository.getRevision(workspaceId, revision);
	if (!target) {
		throw new OperationValidationError([
			`No stored snapshot for workspace ${workspaceId} at revision ${revision}.`
		]);
	}
	const before = deps.repository.get(workspaceId);

	return recordCommit(deps, {
		workspaceId,
		context,
		operationKind: 'workbench.restore_revision',
		requestInput: { revision },
		mutate: (doc) => ({
			// Forward-only: content becomes the target's, revision keeps moving
			// forward -- commit stamps revision/updatedAt itself.
			document: { ...target, id: doc.id, revision: doc.revision, updatedAt: doc.updatedAt },
			affectedIds: [workspaceId],
			diffSummary: `Restored workspace to revision ${revision}.`,
			inverse: before
				? {
						document: { ...before, id: doc.id, revision: doc.revision, updatedAt: doc.updatedAt },
						affectedIds: [workspaceId],
						diffSummary: `Reverted restore back to revision ${before.revision}.`
					}
				: null
		})
	});
}
