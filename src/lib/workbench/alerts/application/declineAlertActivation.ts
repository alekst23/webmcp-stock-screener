// The human-only counterpart to confirmAlertActivation.ts (T-1014-9 AC4).
// Declining a pending activation request always transitions
// pending_activation -> draft, never touches 'armed', and -- like
// confirmAlertActivation.ts -- is a plain application function, never
// registered as an OperationDefinition and never wired to a ToolSpec.
// alertActivationSafety.test.ts asserts the module boundary statically.
//
// This also bypasses recordCommit/ChangeHistory, for consistency with
// confirmAlertActivation.ts and so both human-only transitions are governed
// by the same reasoning: see that file's header comment for why. Declining
// only ever targets 'draft', which is never the protected state, so this
// bypass is not load-bearing for safety the way confirm's is -- it is kept
// symmetric anyway so the two human-only functions are trivially comparable
// and neither shows up in the workspace-wide change log or is reachable via
// undo_change.
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ResourceId } from '../../domain/ids';
import type { RevisionService } from '../../application/revisionService';
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import { appendActivationEvent } from '../domain/alertActivation';

export interface DeclineAlertActivationDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	clock: Clock;
}

export type DeclineAlertActivationFailureReason = 'not_found' | 'not_pending';

export type DeclineAlertActivationOutcome =
	| { ok: true; alert: AlertRecord; newRevision: number }
	| { ok: false; reason: DeclineAlertActivationFailureReason; message: string };

export function declineAlertActivation(
	deps: DeclineAlertActivationDeps,
	workspaceId: ResourceId,
	alertId: ResourceId
): DeclineAlertActivationOutcome {
	const doc = deps.repository.get(workspaceId);
	const existing = doc ? readAlert(doc, alertId) : null;
	if (!doc || !existing) {
		return { ok: false, reason: 'not_found', message: `Alert "${alertId}" was not found.` };
	}
	if (existing.state !== 'pending_activation') {
		return {
			ok: false,
			reason: 'not_pending',
			message: `Alert "${alertId}" has no pending activation request to decline.`
		};
	}
	const now = deps.clock.now();
	const envelope = deps.revisions.commit({
		workspaceId,
		context: { actor: 'human' },
		mutate: (current) => ({
			document: writeAlert(current, {
				...existing,
				state: 'draft',
				pendingActivation: null,
				activationHistory: appendActivationEvent(existing.activationHistory, {
					kind: 'declined',
					at: now,
					actor: 'human'
				}),
				updatedAt: now
			}),
			affectedIds: [alertId],
			diffSummary:
				`Declined the pending activation request for alert ${alertId} ` +
				`("${existing.name}"); it remains a draft.`,
			inverse: null
		})
	});
	const declinedDoc = deps.repository.get(workspaceId);
	const declined = declinedDoc ? readAlert(declinedDoc, alertId) : null;
	if (!declined) {
		// Unreachable in practice: commit() just wrote this alert.
		throw new Error(`declineAlertActivation: alert "${alertId}" vanished after commit.`);
	}
	return { ok: true, alert: declined, newRevision: envelope.newRevision };
}
