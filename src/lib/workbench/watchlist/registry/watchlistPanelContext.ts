// The dependency set the lazily-loaded WatchlistPanel.svelte needs but
// cannot receive as a prop: PanelKindDefinition.component() is a zero-arg
// loader, and panelController.ts's PanelBodyProps is deliberately the
// generic, kind-agnostic per-instance data every real body gets
// (panel/linkedValue/onBroadcast) -- not a place for one kind's own
// dependencies. Mirrors results/panel/resultsPanelContext.ts's own
// module-scoped-singleton pattern exactly: watchlistPanelKind.ts's
// createWatchlistPanelKindDefinition sets this once, synchronously, at
// panel-kind registration time -- before component() is ever called.
import type { PanelUseCaseDeps } from '../../../panels/application';

export interface WatchlistPanelRuntimeDeps {
	useCaseDeps: PanelUseCaseDeps;
}

let current: WatchlistPanelRuntimeDeps | null = null;

export function setWatchlistPanelRuntimeDeps(deps: WatchlistPanelRuntimeDeps): void {
	current = deps;
}

// Throws rather than returning undefined: reaching this without deps having
// been set means the watchlist panel kind was never registered through
// createWatchlistPanelKindDefinition, which is a wiring bug, not a state a
// person or agent can otherwise reach.
export function getWatchlistPanelRuntimeDeps(): WatchlistPanelRuntimeDeps {
	if (!current) {
		throw new Error(
			'Watchlist panel runtime dependencies were never configured -- register the ' +
				'watchlist panel kind via createWatchlistPanelKindDefinition first.'
		);
	}
	return current;
}

// Test-only escape hatch so one test file's registration can never leak
// into another's.
export function resetWatchlistPanelRuntimeDeps(): void {
	current = null;
}
