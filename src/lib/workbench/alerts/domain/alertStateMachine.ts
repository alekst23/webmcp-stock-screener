// The alert state machine (T-1014-8, AC10) -- the epic's other non-negotiable
// safety property: no silently armed alerts. This module is deliberately the
// only place `AlertState` is defined, so every consumer -- this ticket's tools
// and T-1014-9's -- reads the same four states off one source.
//
// What makes `armed` unreachable from this ticket is not a runtime check here;
// it is an absence. This module exports exactly two executable things:
// `INITIAL_ALERT_STATE` (always 'draft') and `isDraft` (a predicate). There is
// no `transition(from, to)` function, no export that takes a target state as a
// parameter, and no export whose name suggests arming or confirming. A caller
// cannot reach `armed` through this module because there is nothing in it to
// call that would take them there.
//
// `ALERT_STATE_TRANSITIONS` is data, not a code path: it documents the whole
// intended graph (including the edges T-1014-9 implements) so that ticket's
// author has one place to find and extend the design, per this ticket's
// instructions, without that documentation itself being a way to arm anything.
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
