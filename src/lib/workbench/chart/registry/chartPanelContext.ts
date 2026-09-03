// The dependency set the lazily-loaded ChartPanelBody.svelte needs but
// cannot receive as a prop: PanelKindDefinition.component() is a zero-arg
// loader, and panelController.ts's PanelBodyProps is deliberately the
// generic, kind-agnostic per-instance data every real body gets
// (panel/linkedValue/onBroadcast) -- not a place for one kind's own
// dependencies. chartPanelKind.ts's createChartPanelKindDefinition sets this
// once, synchronously, at panel-kind registration time -- before component()
// is ever called. Mirrors results/panel/resultsPanelContext.ts's and
// workbench/watchlist/registry/watchlistPanelContext.ts's own
// module-scoped-singleton pattern exactly -- see either for why this isn't
// Svelte context instead.
import type { PanelUseCaseDeps } from '../../../panels/application';
import type { CatalogRegistry } from '../../../catalog/registry';
import type { ChartSeriesPort } from '../domain/seriesPort';

export interface ChartPanelRuntimeDeps {
	useCaseDeps: PanelUseCaseDeps;
	series: ChartSeriesPort;
	// Absent means the built-in study catalog, matching ChartDataDeps' own
	// default (chartData.ts's readChartData).
	catalog?: CatalogRegistry;
}

let current: ChartPanelRuntimeDeps | null = null;

export function setChartPanelRuntimeDeps(deps: ChartPanelRuntimeDeps): void {
	current = deps;
}

// Throws rather than returning undefined: reaching this without deps having
// been set means the chart panel kind was never registered through
// createChartPanelKindDefinition, which is a wiring bug, not a state a
// person or agent can otherwise reach.
export function getChartPanelRuntimeDeps(): ChartPanelRuntimeDeps {
	if (!current) {
		throw new Error(
			'Chart panel runtime dependencies were never configured -- register the chart panel ' +
				'kind via createChartPanelKindDefinition first.'
		);
	}
	return current;
}

// Test-only escape hatch so one test file's registration can never leak
// into another's.
export function resetChartPanelRuntimeDeps(): void {
	current = null;
}
