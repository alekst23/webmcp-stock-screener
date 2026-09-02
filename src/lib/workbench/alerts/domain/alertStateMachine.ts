// The alert state machine (T-1014-8 AC10, extended by T-1014-9) -- the
// epic's other non-negotiable safety property: no silently armed alerts.
// This module is deliberately the only place `AlertState` is defined, so
// every consumer reads the same four states off one source.
//
// What makes `armed` unreachable from this module is not a runtime check
// here; it is an absence. Every executable export below is a predicate: it
// takes a state (or, for isDraft/isPendingActivation/isArmed/isDisarmed, one
// already-known state) and returns a boolean classification of it. There is
// still no `transition(from, to)` function, no export that takes a *target*
// state and produces or stores it, and no export whose name suggests arming
// or confirming -- `isArmed` answers "is this armed", it does not perform
// arming. A caller cannot reach `armed` through this module because there is
// nothing in it to call that would take them there. The functions that
// actually write a new state live in application/enableAlert.ts and
// application/disableAlert.ts (tool-reachable, and provably unable to reach
// 'armed' -- see alertActivationSafety.test.ts) and in
// application/confirmAlertActivation.ts / declineAlertActivation.ts
// (human-only, never wired to a ToolSpec).
//
// `ALERT_STATE_TRANSITIONS` is data, not a code path: it documents the whole
// intended graph so every consumer has one place to find and cross-check the
// design, without that documentation itself being a way to arm anything.
// Describing that `pending_activation -> armed` is a legal transition is not
// the same as performing it -- nothing here reads this table and calls
// `repository.put()`.
export type AlertState = 'draft' | 'pending_activation' | 'armed' | 'disarmed';

// The exact four states AC10 requires -- asserted verbatim by a test, so a
// future edit that silently renames or adds a state is caught immediately.
export const ALERT_STATES: readonly AlertState[] = [
	'draft',
	'pending_activation',
	'armed',
	'disarmed'
];

// Every legal edge in the whole feature's design, not just this ticket's
// slice. T-1014-9 owns implementing the functions that perform
// `draft -> pending_activation`, `pending_activation -> armed` (human-gated
// only), `pending_activation -> draft` (decline, or edit-invalidation), and
// `armed -> disarmed` (and disarm's own idempotent `disarmed -> disarmed`,
// omitted here because a no-op is not a transition). This ticket implements
// none of them.
export const ALERT_STATE_TRANSITIONS: Readonly<Record<AlertState, readonly AlertState[]>> = {
	draft: ['pending_activation'],
	pending_activation: ['armed', 'draft'],
	armed: ['disarmed'],
	disarmed: []
};

// The only state a draft this ticket creates can ever be minted in.
export const INITIAL_ALERT_STATE: AlertState = 'draft';

export function isDraft(state: AlertState): boolean {
	return state === 'draft';
}

export function isPendingActivation(state: AlertState): boolean {
	return state === 'pending_activation';
}

export function isArmed(state: AlertState): boolean {
	return state === 'armed';
}

export function isDisarmed(state: AlertState): boolean {
	return state === 'disarmed';
}
