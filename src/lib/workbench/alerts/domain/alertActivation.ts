// Pure data and predicates for the alert activation gate (T-1014-9). Nothing
// here performs a write: a pending activation request and an activation
// history entry are plain records, and the functions in this module only
// ever compute a value (an expiry timestamp, a boolean, a trimmed array) --
// never a document. The functions that actually store these onto an
// AlertRecord live in the application layer, split across two boundaries
// that matter for this ticket's central safety property:
//   - application/enableAlert.ts (tool-reachable): can only ever write a
//     *pending* activation request, never 'armed'.
//   - application/confirmAlertActivation.ts and declineAlertActivation.ts
//     (human-only, never wired to a ToolSpec): the only code in the program
//     that can write 'armed'.
import type { Actor } from '../../domain/mutation';

// Bounded so a stale request can never be confirmed against conditions the
// researcher reviewed long ago and may no longer remember (AC7). Chosen
// generously enough that a researcher reading the alerts surface and
// clicking confirm within one sitting won't race it.
export const PENDING_ACTIVATION_TTL_MS = 15 * 60 * 1000;

export interface AlertActivationRequest {
	requestedAt: string;
	expiresAt: string;
}

// 'requested'/'invalidated'/'expired' are agent- or system-attributed;
// 'confirmed'/'declined' are only ever written by the human-only functions,
// which hard-code actor: 'human' rather than accepting it as a parameter --
// see confirmAlertActivation.ts and declineAlertActivation.ts.
export type AlertActivationEventKind =
	| 'requested'
	| 'confirmed'
	| 'declined'
	| 'invalidated'
	| 'expired'
	| 'disarmed';

export const ACTIVATION_EVENT_KINDS: readonly AlertActivationEventKind[] = [
	'requested',
	'confirmed',
	'declined',
	'invalidated',
	'expired',
	'disarmed'
];

export interface AlertActivationEvent {
	kind: AlertActivationEventKind;
	at: string;
	actor: Actor;
}

// Unbounded growth is the only realistic failure mode for a per-alert log
// that nothing ever prunes upstream (unlike ChangeHistory, which caps and
// evicts per workspace) -- bounded here for the same reason, at a size that
// comfortably covers a real alert's lifetime of request/confirm/disarm
// cycles.
const MAX_ACTIVATION_HISTORY = 50;

export function computeActivationExpiry(nowIso: string): string {
	return new Date(new Date(nowIso).getTime() + PENDING_ACTIVATION_TTL_MS).toISOString();
}

// Inclusive of the boundary: a request expiring at exactly `nowIso` is
// treated as expired, so "expires after a bounded time" (AC7) never leaves a
// one-instant window where it's ambiguous.
export function isActivationRequestExpired(
	request: AlertActivationRequest,
	nowIso: string
): boolean {
	return new Date(nowIso).getTime() >= new Date(request.expiresAt).getTime();
}

// Pure append: never mutates `history`, always returns a new array, trimmed
// to the oldest MAX_ACTIVATION_HISTORY entries dropped first.
export function appendActivationEvent(
	history: readonly AlertActivationEvent[],
	event: AlertActivationEvent
): AlertActivationEvent[] {
	const next = [...history, event];
	return next.length > MAX_ACTIVATION_HISTORY
		? next.slice(next.length - MAX_ACTIVATION_HISTORY)
		: next;
}
