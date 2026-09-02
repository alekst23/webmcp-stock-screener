import { describe, expect, it } from 'vitest';
import {
	PENDING_ACTIVATION_TTL_MS,
	appendActivationEvent,
	computeActivationExpiry,
	isActivationRequestExpired,
	type AlertActivationEvent
} from './alertActivation';

const NOW = '2026-09-02T00:00:00.000Z';

describe('computeActivationExpiry', () => {
	it('adds exactly the configured TTL to the given instant', () => {
		const expiry = computeActivationExpiry(NOW);
		expect(new Date(expiry).getTime() - new Date(NOW).getTime()).toBe(PENDING_ACTIVATION_TTL_MS);
	});
});

describe('isActivationRequestExpired', () => {
	const request = { requestedAt: NOW, expiresAt: computeActivationExpiry(NOW) };

	it('is false strictly before the expiry instant', () => {
		const justBefore = new Date(new Date(request.expiresAt).getTime() - 1).toISOString();
		expect(isActivationRequestExpired(request, justBefore)).toBe(false);
	});

	it('is true exactly at, and strictly after, the expiry instant', () => {
		expect(isActivationRequestExpired(request, request.expiresAt)).toBe(true);
		const after = new Date(new Date(request.expiresAt).getTime() + 1).toISOString();
		expect(isActivationRequestExpired(request, after)).toBe(true);
	});
});

describe('appendActivationEvent', () => {
	it('returns a new array with the event appended, never mutating the input', () => {
		const history: AlertActivationEvent[] = [{ kind: 'requested', at: NOW, actor: 'agent' }];
		const before = JSON.stringify(history);
		const next = appendActivationEvent(history, { kind: 'confirmed', at: NOW, actor: 'human' });
		expect(JSON.stringify(history)).toBe(before);
		expect(next).toEqual([
			{ kind: 'requested', at: NOW, actor: 'agent' },
			{ kind: 'confirmed', at: NOW, actor: 'human' }
		]);
	});

	it('trims from the oldest end once the history exceeds its bound', () => {
		let history: AlertActivationEvent[] = [];
		for (let i = 0; i < 60; i++) {
			history = appendActivationEvent(history, { kind: 'requested', at: `${i}`, actor: 'agent' });
		}
		expect(history.length).toBe(50);
		expect(history[0]?.at).toBe('10');
		expect(history[history.length - 1]?.at).toBe('59');
	});
});
