// The dependency set the lazily-loaded ResultsTablePanel.svelte needs but
// cannot receive as a prop: PanelKindDefinition.component() is a zero-arg
// loader, and panelController.ts's PanelBodyProps is deliberately the
// generic, kind-agnostic per-instance data every real body gets
// (panel/linkedValue/onBroadcast) -- not a place for one kind's own
// dependencies. resultsTablePanelKind.ts's createResultsTablePanelKindDefinition
// sets this once, synchronously, at panel-kind registration time -- before
// component() is ever called -- the same "closes over its own dependency at
// registration time" pattern tableRendererContract.ts already established
// for its own PinnedRunStore.
//
// A module-scoped singleton rather than Svelte context: the shell does not
// wrap a real body in any context provider, and this kind is registered
// exactly once per running app (one PanelKindDefinition, however many panel
// instances of it exist). Component tests bypass this entirely by passing
// `deps` as an explicit prop override (see ResultsTablePanel.svelte) instead
// of relying on this singleton.
import type { PanelUseCaseDeps } from '../../panels/application';
import type { PinnedRunStore } from '../../screener/ports';
import type { TickerResolver } from '../domain/page';

export interface ResultsPanelRuntimeDeps {
	useCaseDeps: PanelUseCaseDeps;
	runs: PinnedRunStore;
	// Absent resolves to "no ticker available" (matching getScreenerResults's
	// own default) -- this area's honest-absence convention, not a fabricated
	// symbol.
	resolveTicker?: TickerResolver;
}

let current: ResultsPanelRuntimeDeps | null = null;

export function setResultsPanelRuntimeDeps(deps: ResultsPanelRuntimeDeps): void {
	current = deps;
}

// Throws rather than returning undefined: reaching this without deps having
// been set means the results_table panel kind was never registered through
// createResultsTablePanelKindDefinition, which is a wiring bug, not a state
// a person or agent can otherwise reach.
export function getResultsPanelRuntimeDeps(): ResultsPanelRuntimeDeps {
	if (!current) {
		throw new Error(
			'Results panel runtime dependencies were never configured -- register the ' +
				'results_table panel kind via createResultsTablePanelKindDefinition first.'
		);
	}
	return current;
}

// Test-only escape hatch so one test file's registration can never leak
// into another's.
export function resetResultsPanelRuntimeDeps(): void {
	current = null;
}
