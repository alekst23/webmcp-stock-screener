import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdempotencyConflictError } from '../domain/errors';
import type { MutationEnvelope } from '../domain/mutation';
import { createIdempotencyCache, fingerprintRequest } from './idempotency';

function envelope(changeId: string): MutationEnvelope {
	return {
		changeId,
		newRevision: 2,
		affectedIds: [],
		diffSummary: 'did a thing',
		warnings: [],
		undoToken: null
	};
}

describe('createIdempotencyCache', () => {
	it('returns null on a miss', () => {
		const cache = createIdempotencyCache();
		expect(cache.lookup('key-1', 'fp')).toBeNull();
	});

	it('replays the recorded envelope on a fingerprint match', () => {
		const cache = createIdempotencyCache();
		const env = envelope('change_1');
		cache.remember('key-1', 'fp', env);
		expect(cache.lookup('key-1', 'fp')).toBe(env);
	});

	it('throws an idempotency conflict on a fingerprint mismatch', () => {
		const cache = createIdempotencyCache();
		cache.remember('key-1', 'fp-a', envelope('change_1'));
		expect(() => cache.lookup('key-1', 'fp-b')).toThrow(IdempotencyConflictError);
	});

	it('evicts the oldest entry once over maxEntries', () => {
		const cache = createIdempotencyCache({ maxEntries: 2 });
		cache.remember('key-1', 'fp', envelope('change_1'));
		cache.remember('key-2', 'fp', envelope('change_2'));
		cache.remember('key-3', 'fp', envelope('change_3'));
		expect(cache.lookup('key-1', 'fp')).toBeNull();
		expect(cache.lookup('key-3', 'fp')).not.toBeNull();
	});

	describe('ttl expiry', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('treats an expired entry as a new request rather than crashing', () => {
			const cache = createIdempotencyCache({ ttlMs: 1000 });
			cache.remember('key-1', 'fp', envelope('change_1'));
			vi.advanceTimersByTime(1001);
			expect(() => cache.lookup('key-1', 'fp')).not.toThrow();
			expect(cache.lookup('key-1', 'fp')).toBeNull();
		});
	});
});

describe('fingerprintRequest', () => {
	it('fingerprints identically regardless of key order', () => {
		const a = fingerprintRequest('chart.add_study', { symbol: 'AAPL', kind: 'sma' });
		const b = fingerprintRequest('chart.add_study', { kind: 'sma', symbol: 'AAPL' });
		expect(a).toBe(b);
	});

	it('fingerprints differently for materially different input', () => {
		const a = fingerprintRequest('chart.add_study', { symbol: 'AAPL' });
		const b = fingerprintRequest('chart.add_study', { symbol: 'MSFT' });
		expect(a).not.toBe(b);
	});
});
