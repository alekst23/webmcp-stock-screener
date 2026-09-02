import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type WorkspaceDocument } from '../../domain/workspace';
import { createIdSequencer } from '../../domain/ids';
import { createScreener, type ScreenerDefinition } from '../../../screener/definition';
import { writeScreener } from '../../../screener/state';
import { screenerReachesWatchlist } from './cycles';
import { writeWatchlist, type Watchlist } from './watchlist';

const NOW = '2026-09-02T00:00:00.000Z';

function baseWorkspace(): WorkspaceDocument {
	return emptyWorkspace('workspace_1', 'Test Workspace', NOW);
}

function screenerWithUniverseWatchlists(
	screenerId: string,
	watchlistIds: string[]
): ScreenerDefinition {
	const definition = createScreener(createIdSequencer(), 'workspace_1', 'Screener');
	return {
		...definition,
		screenerId,
		universe: { ...definition.universe, watchlists: watchlistIds }
	};
}

function dynamicWatchlist(watchlistId: string, screenerId: string): Watchlist {
	return {
		watchlistId,
		name: 'Dynamic',
		kind: 'dynamic',
		screenerId,
		screenerRevision: 1,
		createdAt: NOW,
		updatedAt: NOW
	};
}

describe('screenerReachesWatchlist', () => {
	it('test_returns_false_when_the_screener_does_not_exist', () => {
		const doc = baseWorkspace();
		expect(screenerReachesWatchlist(doc, 'screener_missing', 'watchlist_1')).toBe(false);
	});

	it('test_returns_false_when_the_universe_has_no_watchlists', () => {
		const doc = writeScreener(baseWorkspace(), screenerWithUniverseWatchlists('screener_1', []));
		expect(screenerReachesWatchlist(doc, 'screener_1', 'watchlist_1')).toBe(false);
	});

	it('test_detects_a_direct_cycle_a_screeners_universe_includes_the_watchlist_it_would_define', () => {
		// screener_1's universe already names watchlist_1; if watchlist_1 were
		// made dynamic on screener_1, its membership would depend on a universe
		// that depends on it.
		const doc = writeScreener(
			baseWorkspace(),
			screenerWithUniverseWatchlists('screener_1', ['watchlist_1'])
		);
		expect(screenerReachesWatchlist(doc, 'screener_1', 'watchlist_1')).toBe(true);
	});

	it('test_returns_false_for_a_watchlist_the_universe_does_not_reference', () => {
		const doc = writeScreener(
			baseWorkspace(),
			screenerWithUniverseWatchlists('screener_1', ['watchlist_other'])
		);
		expect(screenerReachesWatchlist(doc, 'screener_1', 'watchlist_1')).toBe(false);
	});

	it('test_detects_a_transitive_cycle_through_a_second_screener_and_dynamic_watchlist', () => {
		// screener_1's universe -> watchlist_2 (dynamic, defined by screener_2)
		// screener_2's universe -> watchlist_1 (the one under test)
		let doc = baseWorkspace();
		doc = writeScreener(doc, screenerWithUniverseWatchlists('screener_1', ['watchlist_2']));
		doc = writeScreener(doc, screenerWithUniverseWatchlists('screener_2', ['watchlist_1']));
		doc = writeWatchlist(doc, dynamicWatchlist('watchlist_2', 'screener_2'));
		expect(screenerReachesWatchlist(doc, 'screener_1', 'watchlist_1')).toBe(true);
	});

	it('test_a_static_watchlist_in_the_chain_does_not_extend_the_walk', () => {
		// screener_1's universe -> watchlist_2, but watchlist_2 is static, so
		// there is no further screener reference to follow -- no cycle.
		let doc = baseWorkspace();
		doc = writeScreener(doc, screenerWithUniverseWatchlists('screener_1', ['watchlist_2']));
		doc = writeWatchlist(doc, {
			watchlistId: 'watchlist_2',
			name: 'Static',
			kind: 'static',
			members: [],
			createdAt: NOW,
			updatedAt: NOW
		});
		expect(screenerReachesWatchlist(doc, 'screener_1', 'watchlist_1')).toBe(false);
	});

	it('test_does_not_hang_when_an_existing_cycle_is_present_elsewhere_in_the_graph', () => {
		// screener_1 <-> watchlist_1 (dynamic on screener_1) is already a
		// self-cycle unrelated to the target; the walk must terminate rather
		// than loop forever while checking a different target.
		let doc = baseWorkspace();
		doc = writeScreener(doc, screenerWithUniverseWatchlists('screener_1', ['watchlist_1']));
		doc = writeWatchlist(doc, dynamicWatchlist('watchlist_1', 'screener_1'));
		expect(screenerReachesWatchlist(doc, 'screener_1', 'watchlist_9')).toBe(false);
	});
});
