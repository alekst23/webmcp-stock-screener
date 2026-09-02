import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type WorkspaceDocument } from '../../domain/workspace';
import { makeProvenance, type MarketDataProvenance } from '../../domain/provenance';
import {
	addMembers,
	normalizeWatchlist,
	readWatchlist,
	readWatchlists,
	removeWatchlist,
	toWireWatchlist,
	watchlistIdSeed,
	WATCHLIST_EXTENSION_KEY,
	writeWatchlist,
	type StaticWatchlist,
	type Watchlist,
	type WatchlistMember
} from './watchlist';

const NOW = '2026-09-02T00:00:00.000Z';

function baseWorkspace(): WorkspaceDocument {
	return emptyWorkspace('workspace_1', 'Test Workspace', NOW);
}

function testProvenance(): MarketDataProvenance {
	return makeProvenance({
		asOf: NOW,
		sourceId: 'src.screener.engine',
		sourceLabel: 'Screener engine',
		liveness: 'end_of_day',
		timezone: 'America/New_York',
		currency: 'USD',
		priceAdjustment: 'adjusted'
	});
}

function manualMember(instrumentId: string): WatchlistMember {
	return { instrumentId, addedAt: NOW, source: { kind: 'manual' } };
}

function runMember(instrumentId: string, runId = 'run_1'): WatchlistMember {
	return {
		instrumentId,
		addedAt: NOW,
		source: { kind: 'run', runId, runCreatedAt: NOW, provenance: testProvenance() }
	};
}

function staticWatchlist(overrides: Partial<StaticWatchlist> = {}): StaticWatchlist {
	return {
		watchlistId: 'watchlist_1',
		name: 'Momentum names',
		kind: 'static',
		members: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

describe('readWatchlist / writeWatchlist', () => {
	it('test_readWatchlist_on_document_with_no_watchlists_extension_returns_null', () => {
		const doc = baseWorkspace();
		expect(readWatchlist(doc, 'watchlist_1')).toBeNull();
	});

	it('test_writeWatchlist_then_readWatchlist_round_trips_a_static_watchlist', () => {
		const doc = baseWorkspace();
		const watchlist = staticWatchlist({ members: [manualMember('inst_1')] });
		const written = writeWatchlist(doc, watchlist);
		expect(readWatchlist(written, 'watchlist_1')).toEqual(watchlist);
	});

	it('test_writeWatchlist_then_readWatchlist_round_trips_a_dynamic_watchlist', () => {
		const doc = baseWorkspace();
		const watchlist: Watchlist = {
			watchlistId: 'watchlist_2',
			name: 'Dynamic',
			kind: 'dynamic',
			screenerId: 'screener_1',
			screenerRevision: 3,
			createdAt: NOW,
			updatedAt: NOW
		};
		const written = writeWatchlist(doc, watchlist);
		expect(readWatchlist(written, 'watchlist_2')).toEqual(watchlist);
	});

	it('test_writeWatchlist_does_not_mutate_the_input_document', () => {
		const doc = baseWorkspace();
		writeWatchlist(doc, staticWatchlist());
		expect(doc.extensions[WATCHLIST_EXTENSION_KEY]).toBeUndefined();
	});

	it('test_removeWatchlist_removes_a_stored_entry', () => {
		const doc = writeWatchlist(baseWorkspace(), staticWatchlist());
		const removed = removeWatchlist(doc, 'watchlist_1');
		expect(readWatchlist(removed, 'watchlist_1')).toBeNull();
	});

	it('test_removeWatchlist_on_missing_id_is_a_no_op', () => {
		const doc = writeWatchlist(baseWorkspace(), staticWatchlist());
		const removed = removeWatchlist(doc, 'watchlist_missing');
		expect(readWatchlists(removed)).toHaveLength(1);
	});

	it('test_readWatchlist_treats_a_mismatched_stored_id_as_absent', () => {
		const doc: WorkspaceDocument = {
			...baseWorkspace(),
			extensions: {
				[WATCHLIST_EXTENSION_KEY]: { watchlist_1: { ...staticWatchlist(), watchlistId: 'other' } }
			}
		};
		expect(readWatchlist(doc, 'watchlist_1')).toBeNull();
	});
});

describe('normalizeWatchlist', () => {
	it('test_normalizeWatchlist_on_corrupt_entry_returns_null_instead_of_throwing', () => {
		expect(() => normalizeWatchlist('not an object')).not.toThrow();
		expect(normalizeWatchlist('not an object')).toBeNull();
	});

	it('test_normalizeWatchlist_drops_a_malformed_dynamic_entry_missing_screener_fields', () => {
		expect(
			normalizeWatchlist({
				watchlistId: 'watchlist_1',
				name: 'X',
				kind: 'dynamic',
				createdAt: NOW,
				updatedAt: NOW
			})
		).toBeNull();
	});

	it('test_normalizeWatchlist_drops_a_member_with_no_instrumentId', () => {
		const normalized = normalizeWatchlist({
			watchlistId: 'watchlist_1',
			name: 'X',
			kind: 'static',
			createdAt: NOW,
			updatedAt: NOW,
			members: [{ addedAt: NOW }, { instrumentId: 'inst_1', addedAt: NOW }]
		});
		expect(normalized?.kind).toBe('static');
		expect((normalized as StaticWatchlist).members).toHaveLength(1);
	});

	it('test_normalizeWatchlist_normalizes_an_unrecognized_source_to_manual', () => {
		const normalized = normalizeWatchlist({
			watchlistId: 'watchlist_1',
			name: 'X',
			kind: 'static',
			createdAt: NOW,
			updatedAt: NOW,
			members: [{ instrumentId: 'inst_1', addedAt: NOW, source: { kind: 'bogus' } }]
		}) as StaticWatchlist;
		expect(normalized.members[0]?.source).toEqual({ kind: 'manual' });
	});
});

describe('watchlistIdSeed', () => {
	it('test_watchlistIdSeed_on_empty_document_returns_empty_seed', () => {
		expect(watchlistIdSeed(baseWorkspace())).toEqual({});
	});

	it('test_watchlistIdSeed_reports_the_highest_sequence_stored', () => {
		let doc = baseWorkspace();
		doc = writeWatchlist(doc, staticWatchlist({ watchlistId: 'watchlist_2' }));
		doc = writeWatchlist(doc, staticWatchlist({ watchlistId: 'watchlist_5' }));
		expect(watchlistIdSeed(doc)).toEqual({ watchlist: 5 });
	});
});

describe('addMembers', () => {
	it('test_addMembers_adds_every_new_instrument_when_none_are_present', () => {
		const result = addMembers(staticWatchlist(), [manualMember('inst_1'), manualMember('inst_2')]);
		expect(result.addedCount).toBe(2);
		expect(result.alreadyPresentCount).toBe(0);
		expect(result.watchlist.members.map((m) => m.instrumentId)).toEqual(['inst_1', 'inst_2']);
	});

	it('test_addMembers_counts_an_existing_instrument_as_already_present_and_keeps_its_original_record', () => {
		const original = manualMember('inst_1');
		const watchlist = staticWatchlist({ members: [original] });
		const result = addMembers(watchlist, [runMember('inst_1'), manualMember('inst_2')]);
		expect(result.addedCount).toBe(1);
		expect(result.alreadyPresentCount).toBe(1);
		// The original manual record survives -- a later save from a run must
		// not overwrite an existing member's own provenance.
		expect(result.watchlist.members.find((m) => m.instrumentId === 'inst_1')).toEqual(original);
	});

	it('test_addMembers_deduplicates_a_repeated_instrument_within_the_same_incoming_batch', () => {
		const result = addMembers(staticWatchlist(), [manualMember('inst_1'), manualMember('inst_1')]);
		// A duplicate within one call's own selection is neither "added twice"
		// nor "already present" -- addedCount + alreadyPresentCount must equal
		// the de-duplicated incoming count (1), not the raw incoming length (2).
		expect(result.addedCount).toBe(1);
		expect(result.alreadyPresentCount).toBe(0);
		expect(result.watchlist.members).toHaveLength(1);
	});

	it('test_addMembers_does_not_mutate_the_input_watchlist', () => {
		const watchlist = staticWatchlist();
		addMembers(watchlist, [manualMember('inst_1')]);
		expect(watchlist.members).toEqual([]);
	});
});

describe('toWireWatchlist', () => {
	it('test_toWireWatchlist_serializes_a_static_watchlist_with_snake_case_members', () => {
		const watchlist = staticWatchlist({ members: [runMember('inst_1')] });
		const wire = toWireWatchlist(watchlist);
		expect(wire).toMatchObject({
			watchlist_id: 'watchlist_1',
			name: 'Momentum names',
			kind: 'static'
		});
		const members = wire.members as Record<string, unknown>[];
		expect(members[0]).toMatchObject({
			instrument_id: 'inst_1',
			source: { kind: 'run', run_id: 'run_1', run_created_at: NOW }
		});
		expect((members[0]?.source as Record<string, unknown>).provenance).toMatchObject({
			as_of: NOW,
			source_id: 'src.screener.engine'
		});
	});

	it('test_toWireWatchlist_serializes_a_dynamic_watchlist_without_a_members_field', () => {
		const watchlist: Watchlist = {
			watchlistId: 'watchlist_2',
			name: 'Dynamic',
			kind: 'dynamic',
			screenerId: 'screener_1',
			screenerRevision: 3,
			createdAt: NOW,
			updatedAt: NOW
		};
		const wire = toWireWatchlist(watchlist);
		expect(wire).toEqual({
			watchlist_id: 'watchlist_2',
			name: 'Dynamic',
			kind: 'dynamic',
			created_at: NOW,
			updated_at: NOW,
			screener_id: 'screener_1',
			screener_revision: 3
		});
	});
});
