// In-memory store holding computed previews between the preview call and the
// apply call, so apply commits the exact candidate state that was reported
// rather than re-folding the batch. The epic's only infra component: it owns
// ID minting, the clock, TTL and eviction, all injected so tests are
// deterministic. See docs/design/safety-preview-apply/technical.md's layering
// table.
//
// Deliberately dumb: it answers only whether a preview exists, is consumed, or
// has aged out. It never inspects the base revision, the diff or
// `applicable` -- the safety guarantee is the revision check at apply time, so
// expiry here is resource hygiene and never a safety mechanism.
import { mintId, parseId, type ResourceId } from '../domain/ids';
import type { Clock } from '../domain/ports';
import type { PreviewRecord } from '../domain/preview';

export type PreviewLookupStatus = 'found' | 'not_found' | 'expired' | 'consumed';

export interface PreviewLookup {
	status: PreviewLookupStatus;
	// Present only when status === 'found'. A consumed preview is never handed
	// back, so a second commit cannot be built from it.
	record?: PreviewRecord;
}

export interface PreviewStore {
	// Mints the unguessable ID up front, so the caller can build a
	// PreviewResult that already carries its own previewId before storing.
	nextPreviewId(): ResourceId;
	put(record: PreviewRecord): PreviewRecord;
	get(previewId: ResourceId): PreviewLookup;
	markConsumed(previewId: ResourceId): void;
}

interface PreviewEntry {
	record: PreviewRecord;
	// Age is measured from the moment the record entered the store, which is
	// the same call in which its ID was minted.
	storedAtMs: number;
	// Tie-breaker when two previews share a millisecond, so eviction order is
	// total rather than dependent on Map insertion order.
	sequence: number;
	consumed: boolean;
}

// The spec's assumption is a preview lives "a handful of minutes" -- long
// enough that a human can read a diff and decide, short enough that an
// unbounded session does not accumulate candidate documents.
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 50;

const TOKEN_BYTES = 4;

// Unguessability comes from the token, not from the sequence number, which is
// trivially predictable. Crypto where the runtime has it; Math.random is a
// fallback for environments that don't, not the preferred path.
function defaultRandomToken(): string {
	const webCrypto = globalThis.crypto;
	if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
		const bytes = new Uint8Array(TOKEN_BYTES);
		webCrypto.getRandomValues(bytes);
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	}
	return Math.floor(Math.random() * 0xffffffff)
		.toString(16)
		.padStart(TOKEN_BYTES * 2, '0');
}

export function createPreviewStore(deps: {
	clock: Clock;
	// Injected so tests assert exact IDs instead of sampling randomness.
	randomToken?: () => string;
	ttlMs?: number;
	maxEntries?: number;
}): PreviewStore {
	const clock = deps.clock;
	const randomToken = deps.randomToken ?? defaultRandomToken;
	const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
	const maxEntries = deps.maxEntries ?? DEFAULT_MAX_ENTRIES;
	// Session-scoped and in-memory by construction: no Storage is reachable
	// from here, so no persisted key can be read or written.
	const entries = new Map<ResourceId, PreviewEntry>();
	let sequence = 0;

	// Every reading of "now" goes through the injected clock; Date.now() is
	// never called, so a test can advance time without waiting.
	function nowMs(): number {
		return Date.parse(clock.now());
	}

	function isExpired(entry: PreviewEntry, at: number): boolean {
		return at - entry.storedAtMs > ttlMs;
	}

	// Chooses the oldest entry by (age, issue order) rather than trusting Map
	// insertion order, so the ordering stays total even when several previews
	// land in the same millisecond and a newer one can never be evicted to
	// make room for an older one.
	function evictOldest(): void {
		let oldestId: ResourceId | undefined;
		let oldest: PreviewEntry | undefined;
		for (const [id, entry] of entries) {
			if (
				!oldest ||
				entry.storedAtMs < oldest.storedAtMs ||
				(entry.storedAtMs === oldest.storedAtMs && entry.sequence < oldest.sequence)
			) {
				oldestId = id;
				oldest = entry;
			}
		}
		if (oldestId !== undefined) {
			entries.delete(oldestId);
		}
	}

	return {
		nextPreviewId(): ResourceId {
			sequence += 1;
			// The random token is a discriminator, not the last segment, so the
			// ID stays parseable as kind 'preview' with a sequence.
			return mintId('preview', sequence, randomToken());
		},

		put(record: PreviewRecord): PreviewRecord {
			// Stored by reference; callers must not mutate a record they put or
			// retrieve. Cloning a whole candidate WorkspaceDocument on every
			// access would cost more than the discipline is worth.
			entries.set(record.previewId, {
				record,
				storedAtMs: nowMs(),
				sequence: parseId(record.previewId)?.sequence ?? 0,
				consumed: false
			});
			while (entries.size > maxEntries) {
				evictOldest();
			}
			return record;
		},

		get(previewId: ResourceId): PreviewLookup {
			const entry = entries.get(previewId);
			if (!entry) {
				return { status: 'not_found' };
			}
			if (isExpired(entry, nowMs())) {
				// Dropped on read so an aged-out preview is not retrievable
				// afterwards. Checked ahead of consumption so hygiene applies
				// uniformly, whether or not the preview was ever applied.
				entries.delete(previewId);
				return { status: 'expired' };
			}
			if (entry.consumed) {
				// Retained rather than deleted, so a second apply is told the
				// preview was already used instead of that it never existed.
				return { status: 'consumed' };
			}
			return { status: 'found', record: entry.record };
		},

		markConsumed(previewId: ResourceId): void {
			// A no-op for an unknown ID: the store records what happened, it does
			// not adjudicate whether the caller should have asked.
			const entry = entries.get(previewId);
			if (entry) {
				entry.consumed = true;
			}
		}
	};
}
