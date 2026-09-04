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
import type { PanelWorkspaceObserver } from '../../panels/shell/panelController';
import type { PinnedRunStore, ScreenerEvaluationPort } from '../ports';

// T-0020-11: the "Run" control's own extra dependencies -- evaluationPort
// and runStore are the screener tool group's own instances (T-0020-1's
// shared composition root), and observer is the panel shell's own
// notification hub (registerPanelTools.ts) -- undefined until
// workbenchCompositionRoot.ts's registerWorkbenchComposition() has built
// both. That happens strictly after createFilterBuilderPanelKindDefinition
// registers this kind (see that module's own comment), so `run` starts
// absent and is filled in by setFilterBuilderPanelRunDeps() below once
// composition finishes -- always before this lazily-loaded panel body is
// ever mounted (registerWorkbenchComposition is awaited before `/`'s
// PanelContainer renders; see +page.svelte's connectComposition()).
export interface FilterBuilderPanelRunDeps {
	evaluationPort: ScreenerEvaluationPort;
	runStore: PinnedRunStore;
	observer: PanelWorkspaceObserver;
}

export interface FilterBuilderPanelRuntimeDeps {
	useCaseDeps: PanelUseCaseDeps;
	run?: FilterBuilderPanelRunDeps;
}

let current: FilterBuilderPanelRuntimeDeps | null = null;

export function setFilterBuilderPanelRuntimeDeps(deps: FilterBuilderPanelRuntimeDeps): void {
	current = deps;
}

// The composition root's second-phase call (see FilterBuilderPanelRunDeps'
// own comment for why this can't be folded into registration time): merges
// the Run control's dependencies into whatever useCaseDeps registration
// already set, without disturbing it.
export function setFilterBuilderPanelRunDeps(run: FilterBuilderPanelRunDeps): void {
	if (!current) {
		throw new Error(
			'Filter builder panel runtime dependencies were never configured -- register the ' +
				'filter_builder panel kind via createFilterBuilderPanelKindDefinition before calling ' +
				'setFilterBuilderPanelRunDeps.'
		);
	}
	current = { ...current, run };
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
