// The ONLY function in the program that can transition an alert to 'armed'
// (T-1014-9 AC3, AC5, AC7). It exists to be called from one place: the
// app's own alerts-surface UI code (a Svelte component/store this ticket
// does not build), in direct, synchronous response to a person clicking
// "confirm". It is a plain application function -- not an OperationDefinition
// registered in the shared OperationRegistry, and not a ToolSpec. Nothing
// under tools/ imports it, and no tool input can name or reach it, because
// there is no operation kind string and no ToolSpec that would let an agent
// address it. alertActivationSafety.test.ts asserts this module boundary
// statically (by reading source, not just by convention) and re-asserts
// behaviourally that no combination of tool calls can produce the same
// effect.
//
// Why this bypasses recordCommit/ChangeHistory: every other mutation in the
// program goes through recordCommit, which appends an undo-token-bearing
// entry to ChangeHistory, and undo_change lets an agent undo an undo (which
// *redoes* the original change -- see changeHistory.ts's own "undoing an
// undo redoes the original" comment). If confirming were recorded that way,
// an agent could reach 'armed' with two ordinary, tool-reachable
// undo_change calls and zero human confirmations:
//   1. undo_change(the confirm's own undo token) -> un-arms to
//      pending_activation, producing a NEW change record whose inverse is
//      the original arm draft.
//   2. undo_change(that new record's undo token) -> redoes the arm.
// Calling revisionService.commit directly (skipping recordCommit
// entirely) means no ChangeHistory entry is ever created for a confirm, so
// there is no undo token anywhere for undo_change to find or redeem. The
// draft's own `inverse: null` makes this explicit even if that call path
// ever changed. The confirmation is still recorded -- as an 'confirmed'
// entry in the alert's own activationHistory (AC3's "who confirmed and
// when"), which is what the alerts surface reads, not the workspace-wide
// change log.
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ResourceId } from '../../domain/ids';
import type { RevisionService } from '../../application/revisionService';
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import { appendActivationEvent, isActivationRequestExpired } from '../domain/alertActivation';

export interface ConfirmAlertActivationDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	clock: Clock;
}

export type ConfirmAlertActivationFailureReason = 'not_found' | 'not_pending' | 'expired';

export type ConfirmAlertActivationOutcome =
	| { ok: true; alert: AlertRecord; newRevision: number }
	| { ok: false; reason: ConfirmAlertActivationFailureReason; message: string };

export function confirmAlertActivation(
	deps: ConfirmAlertActivationDeps,
	workspaceId: ResourceId,
	alertId: ResourceId
): ConfirmAlertActivationOutcome {
	const doc = deps.repository.get(workspaceId);
	const existing = doc ? readAlert(doc, alertId) : null;
	if (!doc || !existing) {
		return { ok: false, reason: 'not_found', message: `Alert "${alertId}" was not found.` };
	}
	if (existing.state !== 'pending_activation' || !existing.pendingActivation) {
		return {
			ok: false,
			reason: 'not_pending',
			message: `Alert "${alertId}" has no pending activation request to confirm.`
		};
	}
	const now = deps.clock.now();
	if (isActivationRequestExpired(existing.pendingActivation, now)) {
		return {
			ok: false,
			reason: 'expired',
			message: `The activation request for alert "${alertId}" has expired; request activation again.`
		};
	}
	const envelope = deps.revisions.commit({
		workspaceId,
		context: { actor: 'human' },
		mutate: (current) => ({
			document: writeAlert(current, {
				...existing,
				state: 'armed',
				pendingActivation: null,
				activationHistory: appendActivationEvent(existing.activationHistory, {
					kind: 'confirmed',
					at: now,
					actor: 'human'
				}),
				updatedAt: now
			}),
			affectedIds: [alertId],
			diffSummary: `Armed alert ${alertId} ("${existing.name}") after human confirmation.`,
			// See this module's header comment: a confirm is never undoable
			// through the standard change-history/undo_change mechanism.
			inverse: null
		})
	});
	const armedDoc = deps.repository.get(workspaceId);
	const armed = armedDoc ? readAlert(armedDoc, alertId) : null;
	if (!armed) {
		// Unreachable in practice: commit() just wrote this alert.
		throw new Error(`confirmAlertActivation: alert "${alertId}" vanished after commit.`);
	}
	return { ok: true, alert: armed, newRevision: envelope.newRevision };
}
