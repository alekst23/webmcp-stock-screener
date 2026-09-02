import { describe, expect, it } from 'vitest';
import { parseId, type ResourceId } from '../domain/ids';
import type { Clock } from '../domain/ports';
import { buildPreviewResult, type PreviewRecord } from '../domain/preview';
import { emptyWorkspace, type WorkspaceDocument } from '../domain/workspace';
import { createPreviewStore } from './previewStore';

interface FakeClock extends Clock {
	advance(ms: number): void;
}

function fakeClock(start = '2026-01-01T00:00:00.000Z'): FakeClock {
	let ms = Date.parse(start);
	return {
		now: () => new Date(ms).toISOString(),
		advance: (by: number) => {
			ms += by;
		}
	};
}

// Deterministic token source, so minted IDs are exact strings rather than
// samples of randomness.
function tokens(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `t${index}`;
}

function candidate(revision: number): WorkspaceDocument {
	return {
		...emptyWorkspace('workspace_1', 'Workspace', '2026-01-01T00:00:00.000Z'),
		revision
	};
}

function record(previewId: ResourceId, baseRevision = 7): PreviewRecord {
	return {
		previewId,
		baseRevision,
		candidate: candidate(baseRevision + 1),
		result: buildPreviewResult({
			previewId,
			baseRevision,
			diff: [
				{
					change: 'updated',
					entityType: 'panel',
					id: 'panel_1',
					fields: [{ field: 'title', before: 'Old', after: 'New' }]
				}
			],
			summary: 'Renamed 1 panel',
			warnings: [{ index: 0, kind: 'rename_panel', message: 'Title is long' }]
		})
	};
}

function storeWith(overrides: Partial<Parameters<typeof createPreviewStore>[0]> = {}) {
	const clock = fakeClock();
	const store = createPreviewStore({
		clock,
		randomToken: tokens('aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee'),
		ttlMs: 60_000,
		maxEntries: 3,
		...overrides
	});
	return { clock, store };
}

describe('createPreviewStore', () => {
	it('retrieves a stored preview by its minted id and no other', () => {
		const { store } = storeWith();
		const idA = store.nextPreviewId();
		const idB = store.nextPreviewId();
		const recordA = record(idA);
		const recordB = record(idB);
		store.put(recordA);
		store.put(recordB);

		const lookupA = store.get(idA);
		expect(lookupA.status, 'a stored preview is found').toBe('found');
		// Identity, not field equality: two records built the same way must not
		// be able to stand in for one another.
		expect(lookupA.record, 'id A retrieves exactly the record put under it').toBe(recordA);
		expect(store.get(idB).record, 'id B retrieves its own record, not A').toBe(recordB);
	});

	it('mints distinct ids for every preview', () => {
		const { store } = storeWith();
		const ids = [store.nextPreviewId(), store.nextPreviewId(), store.nextPreviewId()];
		expect(new Set(ids).size, `expected 3 distinct ids, got ${ids.join(', ')}`).toBe(3);
	});

	it('mints unguessable ids that still parse as preview resource ids', () => {
		const { store } = storeWith();
		const first = store.nextPreviewId();
		const second = store.nextPreviewId();
		expect(first, 'the random token is a discriminator, the sequence stays last').toBe(
			'preview_aaaaaaaa_1'
		);
		expect(second, 'the sequence increments even though the token differs').toBe(
			'preview_bbbbbbbb_2'
		);
		expect(parseId(first), 'a minted id round-trips through parseId').toEqual({
			kind: 'preview',
			discriminator: 'aaaaaaaa',
			sequence: 1
		});
	});

	it('keeps the sequence monotonic so a repeated token still yields a fresh id', () => {
		const { store } = storeWith({ randomToken: () => 'same' });
		const first = store.nextPreviewId();
		const second = store.nextPreviewId();
		expect(first, 'first id carries sequence 1').toBe('preview_same_1');
		expect(second, 'a repeated token cannot reuse an id').toBe('preview_same_2');
	});

	it('returns everything apply needs from a retrieved preview', () => {
		const { store } = storeWith();
		const id = store.nextPreviewId();
		const stored = record(id, 7);
		store.put(stored);

		const found = store.get(id).record;
		expect(found?.baseRevision, 'the base revision the preview was computed against').toBe(7);
		expect(found?.candidate.revision, 'the candidate state apply commits').toBe(8);
		expect(found?.result.diff, 'the structured diff').toEqual(stored.result.diff);
		expect(found?.result.affectedIds, 'the affected ids').toEqual(['panel_1']);
		expect(found?.result.summary, 'the human-readable summary').toBe('Renamed 1 panel');
		expect(found?.result.warnings, 'the warnings').toHaveLength(1);
		expect(found?.result.applicable, 'its applicability').toBe(true);
	});

	it('returns the record put, so a caller can chain without a second lookup', () => {
		const { store } = storeWith();
		const id = store.nextPreviewId();
		const stored = record(id);
		expect(store.put(stored), 'put echoes the record it stored').toBe(stored);
	});

	it('reports an id that was never issued as not found', () => {
		const { store } = storeWith();
		const lookup = store.get('preview_never_1');
		expect(lookup.status, 'an id the store never issued is not found').toBe('not_found');
		expect(lookup.record, 'not found carries no record').toBeUndefined();
	});

	it('reports a consumed preview as consumed rather than returning it again', () => {
		const { store } = storeWith();
		const id = store.nextPreviewId();
		store.put(record(id));
		store.markConsumed(id);

		const lookup = store.get(id);
		expect(lookup.status, 'a preview is consumed once').toBe('consumed');
		expect(lookup.record, 'a consumed preview is never handed back for a second commit').toBe(
			undefined
		);
	});

	it('retains a consumed preview so a second apply is not told it never existed', () => {
		const { store } = storeWith();
		const id = store.nextPreviewId();
		store.put(record(id));
		store.markConsumed(id);
		store.get(id);
		expect(store.get(id).status, 'consumed survives being read').toBe('consumed');
	});

	it('reports an aged-out preview as expired, distinctly from not found', () => {
		const { clock, store } = storeWith();
		const id = store.nextPreviewId();
		store.put(record(id));
		clock.advance(60_001);
		expect(store.get(id).status, 'past the ttl the preview is expired').toBe('expired');
	});

	it('drops an expired preview so it is no longer retrievable', () => {
		const { clock, store } = storeWith();
		const id = store.nextPreviewId();
		store.put(record(id));
		clock.advance(60_001);
		expect(store.get(id).status, 'first read reports expiry').toBe('expired');

		const second = store.get(id);
		expect(second.record, 'an expired preview is gone, not merely flagged').toBeUndefined();
		expect(second.status, 'a dropped entry reads as not found afterwards').toBe('not_found');
	});

	it('keeps a preview alive right up to its ttl', () => {
		const { clock, store } = storeWith();
		const id = store.nextPreviewId();
		store.put(record(id));
		clock.advance(60_000);
		expect(store.get(id).status, 'exactly at the ttl the preview is still live').toBe('found');
		clock.advance(1);
		expect(store.get(id).status, 'one ms past the ttl it is expired').toBe('expired');
	});

	it('distinguishes not found, expired and consumed by three separate setups', () => {
		const { clock, store } = storeWith();
		const expiredId = store.nextPreviewId();
		store.put(record(expiredId));
		clock.advance(60_001);
		const consumedId = store.nextPreviewId();
		store.put(record(consumedId));
		store.markConsumed(consumedId);

		const statuses = [
			store.get('preview_never_1').status,
			store.get(expiredId).status,
			store.get(consumedId).status
		];
		expect(statuses, 'the three failure modes are separately reportable').toEqual([
			'not_found',
			'expired',
			'consumed'
		]);
	});

	it('ignores markConsumed for an id it never issued', () => {
		const { store } = storeWith();
		store.markConsumed('preview_never_1');
		expect(store.get('preview_never_1').status, 'marking an unknown id creates nothing').toBe(
			'not_found'
		);
	});

	it('holds at most maxEntries previews, evicting the oldest issued', () => {
		const { clock, store } = storeWith();
		const ids: ResourceId[] = [];
		for (let i = 0; i < 4; i += 1) {
			const id = store.nextPreviewId();
			ids.push(id);
			store.put(record(id));
			clock.advance(1_000);
		}

		expect(store.get(ids[0]!).status, 'the oldest preview was evicted').toBe('not_found');
		for (const id of ids.slice(1)) {
			expect(store.get(id).status, `${id} is newer than the evicted one and must survive`).toBe(
				'found'
			);
		}
	});

	it('never evicts a newer preview to make room for an older one', () => {
		const { clock, store } = storeWith();
		const ids: ResourceId[] = [];
		for (let i = 0; i < 3; i += 1) {
			const id = store.nextPreviewId();
			ids.push(id);
			store.put(record(id));
			clock.advance(1_000);
		}
		const newestBefore = ids[2]!;

		const arrival = store.nextPreviewId();
		store.put(record(arrival));

		expect(store.get(ids[0]!).status, 'the oldest entry made room for the arrival').toBe(
			'not_found'
		);
		expect(
			store.get(newestBefore).status,
			'the newest resident was not evicted in favour of an older one'
		).toBe('found');
		expect(store.get(ids[1]!).status, 'the middle resident was not evicted either').toBe('found');
		expect(store.get(arrival).status, 'the arriving preview did not evict itself').toBe('found');
	});

	it('breaks an eviction tie by issue order when two previews share a millisecond', () => {
		const { store } = storeWith({ maxEntries: 2 });
		// The clock never advances, so age alone cannot order these.
		const first = store.nextPreviewId();
		const second = store.nextPreviewId();
		const third = store.nextPreviewId();
		store.put(record(first));
		store.put(record(second));
		store.put(record(third));

		expect(store.get(first).status, 'the earliest-issued of the tied previews goes first').toBe(
			'not_found'
		);
		expect(store.get(second).status, 'a later-issued preview survives the tie').toBe('found');
		expect(store.get(third).status, 'the newest preview survives the tie').toBe('found');
	});

	it('evicts strictly in issue order across repeated overflow', () => {
		const { clock, store } = storeWith({ maxEntries: 2 });
		const ids: ResourceId[] = [];
		for (let i = 0; i < 5; i += 1) {
			const id = store.nextPreviewId();
			ids.push(id);
			store.put(record(id));
			clock.advance(1_000);
		}
		const surviving = ids.filter((id) => store.get(id).status === 'found');
		expect(surviving, 'only the two most recently issued previews remain').toEqual(ids.slice(3));
	});

	it('reads time only through the injected clock, never the ambient one', () => {
		const { clock, store } = storeWith();
		const realNow = Date.now;
		Date.now = () => {
			throw new Error('ambient time must not be read; the Clock port is the only source');
		};
		try {
			const id = store.nextPreviewId();
			store.put(record(id));
			expect(store.get(id).status, 'storing and reading need no ambient clock').toBe('found');
			clock.advance(60_001);
			expect(store.get(id).status, 'expiry is decided by the injected clock alone').toBe('expired');
		} finally {
			Date.now = realNow;
		}
	});

	it('works with no localStorage present and writes nothing persistent', () => {
		const globals = globalThis as { localStorage?: Storage };
		const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		delete globals.localStorage;
		try {
			const { clock, store } = storeWith();
			const id = store.nextPreviewId();
			store.put(record(id));
			expect(store.get(id).status, 'the store needs no persistent backing').toBe('found');
			store.markConsumed(id);
			expect(store.get(id).status, 'consumption works without storage too').toBe('consumed');
			clock.advance(60_001);
			expect(store.get(id).status, 'expiry works without storage too').toBe('expired');
		} finally {
			if (original) {
				Object.defineProperty(globalThis, 'localStorage', original);
			}
		}
	});

	it('starts empty for each store, so previews are per-session', () => {
		const { store } = storeWith();
		const id = store.nextPreviewId();
		store.put(record(id));
		const { store: fresh } = storeWith();
		expect(fresh.get(id).status, 'a new store shares nothing with an earlier one').toBe(
			'not_found'
		);
	});

	it('stores an inapplicable preview without judging it', () => {
		const { store } = storeWith();
		const id = store.nextPreviewId();
		const failing: PreviewRecord = {
			previewId: id,
			baseRevision: 3,
			candidate: candidate(3),
			result: buildPreviewResult({
				previewId: id,
				baseRevision: 3,
				diff: [],
				summary: 'No changes',
				failures: [{ index: 0, kind: 'unknown_kind', reason: 'Unregistered operation kind' }]
			})
		};
		store.put(failing);

		const lookup = store.get(id);
		expect(lookup.status, 'applicability is not the store to judge').toBe('found');
		expect(lookup.record?.result.applicable, 'the failure is carried through untouched').toBe(
			false
		);
	});
});
