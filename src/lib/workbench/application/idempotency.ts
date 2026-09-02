// Idempotency-key replay cache (T-1006-5). Repeating a mutation with a
// previously-seen idempotency key returns the original envelope instead of
// applying the change twice; reusing a key for a materially different
// request is refused as a conflict. Bounded in both entry count and age so
// an evicted entry is treated as a fresh request rather than crashing.
import { IdempotencyConflictError } from '../domain/errors';
import type { MutationEnvelope } from '../domain/mutation';

export interface IdempotencyCache {
	// Returns the recorded envelope on a fingerprint match, null on a miss
	// (new or evicted key -- indistinguishable, by design, from a first
	// call), or throws IdempotencyConflictError on a fingerprint mismatch.
	lookup(key: string, fingerprint: string): MutationEnvelope | null;
	remember(key: string, fingerprint: string, envelope: MutationEnvelope): void;
}

interface CacheEntry {
	fingerprint: string;
	envelope: MutationEnvelope;
	expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

export function createIdempotencyCache(options?: {
	maxEntries?: number;
	ttlMs?: number;
}): IdempotencyCache {
	const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
	// Map preserves insertion order, which doubles as our eviction order.
	const entries = new Map<string, CacheEntry>();

	function isExpired(entry: CacheEntry): boolean {
		return Date.now() > entry.expiresAt;
	}

	return {
		lookup(key: string, fingerprint: string): MutationEnvelope | null {
			const entry = entries.get(key);
			if (!entry || isExpired(entry)) {
				entries.delete(key);
				return null;
			}
			if (entry.fingerprint !== fingerprint) {
				throw new IdempotencyConflictError(key);
			}
			return entry.envelope;
		},

		remember(key: string, fingerprint: string, envelope: MutationEnvelope): void {
			entries.delete(key); // reset insertion order if the key existed
			entries.set(key, { fingerprint, envelope, expiresAt: Date.now() + ttlMs });
			while (entries.size > maxEntries) {
				const oldestKey = entries.keys().next().value;
				if (oldestKey === undefined) {
					break;
				}
				entries.delete(oldestKey);
			}
		}
	};
}

// A stable fingerprint of an operation kind and its input: sorted-key JSON
// so two calls differing only in property order fingerprint identically.
export function fingerprintRequest(operationKind: string, input: unknown): string {
	return JSON.stringify({ operationKind, input: sortKeysDeep(input) });
}

function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	if (value !== null && typeof value === 'object') {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
		}
		return sorted;
	}
	return value;
}
