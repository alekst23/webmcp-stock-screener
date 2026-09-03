// T-1015-12: component tests for the real watchlist panel body. Mirrors
// results/panel/ResultsTablePanel.test.ts's own mount/unmount shape and
// "explicit not-bound state, never a fabricated empty list" convention.
import { describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { emptyWorkspace } from '../../domain/workspace';
import type { PanelUseCaseDeps } from '../../../panels/application';
import type { Panel } from '../../../panels/domain/panel';
import { makePanel } from '../../../panels/domain/panel';
import { writeWatchlist, type DynamicWatchlist, type StaticWatchlist } from '../domain/watchlist';
import WatchlistPanel from './WatchlistPanel.svelte';

const WORKSPACE_ID = 'workspace_1';

function harness(): {
	deps: PanelUseCaseDeps;
	repository: ReturnType<typeof createLocalWorkspaceRepository>;
} {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	repository.put(emptyWorkspace(WORKSPACE_ID, 'Test', '2026-01-01T00:00:00.000Z'));
	const deps = {
		workspaceId: WORKSPACE_ID,
		repository
	} as unknown as PanelUseCaseDeps;
	return { deps, repository };
}

function panelWithSource(watchlistId: string | null): Panel {
	return makePanel({
		id: 'panel_1',
		kind: 'watchlist',
		title: 'Watchlist',
		config: { sortBy: 'symbol' },
		rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 },
		source: watchlistId ? { type: 'watchlist', ref: { watchlist_id: watchlistId } } : null
	});
}

interface Mounted {
	target: HTMLElement;
	instance: object;
}

function mountPanel(panel: Panel, deps: PanelUseCaseDeps): Mounted {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WatchlistPanel, {
		target,
		props: { panel, onBroadcast: () => {}, deps: { useCaseDeps: deps } }
	});
	flushSync();
	return { target, instance };
}

describe('WatchlistPanel', () => {
	it('renders an explicit "not bound" message when the panel has no source', () => {
		const { deps } = harness();
		const { target, instance } = mountPanel(panelWithSource(null), deps);
		expect(target.textContent).toContain('No watchlist is bound');
		unmount(instance);
	});

	it('renders an explicit "not found" message for a source pointing at a missing watchlist', () => {
		const { deps } = harness();
		const { target, instance } = mountPanel(panelWithSource('watchlist_missing'), deps);
		expect(target.textContent).toContain('Could not find watchlist');
		unmount(instance);
	});

	it('renders an explicit empty state for a static watchlist with no members', () => {
		const { deps, repository } = harness();
		const watchlist: StaticWatchlist = {
			watchlistId: 'watchlist_1',
			name: 'Momentum Names',
			kind: 'static',
			members: [],
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		};
		repository.put(writeWatchlist(repository.get(WORKSPACE_ID)!, watchlist));

		const { target, instance } = mountPanel(panelWithSource('watchlist_1'), deps);
		expect(target.textContent).toContain('has no members yet');
		unmount(instance);
	});

	it('renders each static watchlist member', () => {
		const { deps, repository } = harness();
		const watchlist: StaticWatchlist = {
			watchlistId: 'watchlist_1',
			name: 'Momentum Names',
			kind: 'static',
			members: [
				{
					instrumentId: 'inst:XNAS:AAPL',
					addedAt: '2026-01-01T00:00:00.000Z',
					source: { kind: 'manual' }
				},
				{
					instrumentId: 'inst:XNAS:MSFT',
					addedAt: '2026-01-01T00:00:00.000Z',
					source: { kind: 'manual' }
				}
			],
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		};
		repository.put(writeWatchlist(repository.get(WORKSPACE_ID)!, watchlist));

		const { target, instance } = mountPanel(panelWithSource('watchlist_1'), deps);
		expect(target.textContent).toContain('inst:XNAS:AAPL');
		expect(target.textContent).toContain('inst:XNAS:MSFT');
		unmount(instance);
	});

	it('renders a dynamic watchlist without fabricating a membership list', () => {
		const { deps, repository } = harness();
		const watchlist: DynamicWatchlist = {
			watchlistId: 'watchlist_2',
			name: 'Breakouts',
			kind: 'dynamic',
			screenerId: 'screener_1',
			screenerRevision: 3,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		};
		repository.put(writeWatchlist(repository.get(WORKSPACE_ID)!, watchlist));

		const { target, instance } = mountPanel(panelWithSource('watchlist_2'), deps);
		expect(target.textContent).toContain('screener_1');
		expect(
			target.querySelector('.members'),
			'a dynamic watchlist has no fixed member list'
		).toBeNull();
		unmount(instance);
	});
});
