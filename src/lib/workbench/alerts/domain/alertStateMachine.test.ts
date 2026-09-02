import { describe, expect, it } from 'vitest';
import * as alertStateMachine from './alertStateMachine';
import {
	ALERT_STATES,
	ALERT_STATE_TRANSITIONS,
	INITIAL_ALERT_STATE,
	isArmed,
	isDisarmed,
	isDraft,
	isPendingActivation
} from './alertStateMachine';

describe('alert state machine', () => {
	it('defines exactly the four states draft, pending_activation, armed, disarmed (AC10)', () => {
		expect(ALERT_STATES).toEqual(['draft', 'pending_activation', 'armed', 'disarmed']);
	});

	it('starts every alert in draft', () => {
		expect(INITIAL_ALERT_STATE).toBe('draft');
	});

	it('isDraft is true only for draft', () => {
		expect(isDraft('draft')).toBe(true);
		expect(isDraft('pending_activation')).toBe(false);
		expect(isDraft('armed')).toBe(false);
		expect(isDraft('disarmed')).toBe(false);
	});

	it('isPendingActivation, isArmed and isDisarmed each classify exactly their own state', () => {
		expect(isPendingActivation('pending_activation')).toBe(true);
		expect(isPendingActivation('draft')).toBe(false);
		expect(isPendingActivation('armed')).toBe(false);
		expect(isPendingActivation('disarmed')).toBe(false);

		expect(isArmed('armed')).toBe(true);
		expect(isArmed('draft')).toBe(false);
		expect(isArmed('pending_activation')).toBe(false);
		expect(isArmed('disarmed')).toBe(false);

		expect(isDisarmed('disarmed')).toBe(true);
		expect(isDisarmed('draft')).toBe(false);
		expect(isDisarmed('pending_activation')).toBe(false);
		expect(isDisarmed('armed')).toBe(false);
	});

	// The safety property this module exists for: every executable export is a
	// predicate over an already-known state. There is no exported function
	// that performs a transition -- in particular nothing that could be called
	// with 'armed' as a target. This test pins the export surface so an
	// accidental addition (e.g. a generic `transition(from, to)` a future edit
	// adds "for completeness") fails CI instead of silently becoming a path to
	// `armed`.
	it('exports nothing beyond the documented, non-transition-performing surface', () => {
		expect(Object.keys(alertStateMachine).sort()).toEqual([
			'ALERT_STATES',
			'ALERT_STATE_TRANSITIONS',
			'INITIAL_ALERT_STATE',
			'isArmed',
			'isDisarmed',
			'isDraft',
			'isPendingActivation'
		]);
	});

	it('exposes no function whose signature could be handed a target state and asked to reach it', () => {
		const functionExports = Object.values(alertStateMachine).filter(
			(value) => typeof value === 'function'
		);
		// Every function export takes exactly one AlertState argument and returns
		// a boolean -- none can produce or store a state, only classify one.
		expect(functionExports).toHaveLength(4);
		expect(new Set(functionExports)).toEqual(
			new Set([isDraft, isPendingActivation, isArmed, isDisarmed])
		);
		for (const fn of functionExports) {
			expect(fn as (state: string) => unknown).toHaveLength(1);
			expect(typeof (fn as (state: string) => unknown)('armed')).toBe('boolean');
		}
	});

	it('documents the pending_activation -> armed edge as data only, for T-1014-9 to implement', () => {
		// This assertion is deliberately about the data, not a claim that armed is
		// reachable: no function in this module (or anywhere in this ticket) reads
		// this table and performs the write it describes.
		expect(ALERT_STATE_TRANSITIONS.pending_activation).toContain('armed');
		expect(ALERT_STATE_TRANSITIONS.draft).not.toContain('armed');
	});
});
