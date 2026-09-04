// The dependency set the lazily-loaded FilterBuilderPanel.svelte needs but
// cannot receive as a prop: PanelKindDefinition.component() is a zero-arg
// loader, and panelController.ts's PanelBodyProps is deliberately the
// generic, kind-agnostic per-instance data every real body gets
// (panel/linkedValue/onBroadcast) -- not a place for one kind's own
// dependencies. Mirrors watchlist/registry/watchlistPanelContext.ts's own
// module-scoped-singleton pattern exactly: filterBuilderPanelKind.ts's
// createFilterBuilderPanelKindDefinition sets this once, synchronously, at
// panel-kind registration time -- before component() is ever called.
import type { PanelUseCaseDeps } from '../../panels/application';

export interface FilterBuilderPanelRuntimeDeps {
	useCaseDeps: PanelUseCaseDeps;
}

let current: FilterBuilderPanelRuntimeDeps | null = null;

export function setFilterBuilderPanelRuntimeDeps(deps: FilterBuilderPanelRuntimeDeps): void {
	current = deps;
}

// Throws rather than returning undefined: reaching this without deps having
// been set means the filter_builder panel kind was never registered through
// createFilterBuilderPanelKindDefinition, which is a wiring bug, not a state
// a person or agent can otherwise reach.
export function getFilterBuilderPanelRuntimeDeps(): FilterBuilderPanelRuntimeDeps {
	if (!current) {
		throw new Error(
			'Filter builder panel runtime dependencies were never configured -- register the ' +
				'filter_builder panel kind via createFilterBuilderPanelKindDefinition first.'
		);
	}
	return current;
}

// Test-only escape hatch so one test file's registration can never leak
// into another's.
export function resetFilterBuilderPanelRuntimeDeps(): void {
	current = null;
}
