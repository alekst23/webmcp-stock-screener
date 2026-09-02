// The real `results_table` PanelKindDefinition (T-1010-7), replacing the
// placeholder KIND_SPECS entry defaultPanelKinds.ts registers -- see that
// file's own comment ("each owning epic replaces its kind's definition by
// re-registering it") and registerDefaultPanelKinds's skip-if-present guard,
// which is what makes registering this BEFORE the defaults safe rather than
// a duplicate-registration throw.
//
// Config validation reuses the table renderer contract's own rules
// (tableRendererContract.ts's validateResultsTableWireConfig) instead of
// duplicating them: this kind's defaultRenderer is always 'table', so a
// panel of this kind is validated against exactly the same schema whether
// the call came in as create_panel's initial config or a later
// configure_panel_view.
import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import type { PanelUseCaseDeps } from '../../panels/application';
import type { GridSize } from '../../panels/domain/grid';
import type { PanelKindDefinition, PanelRegistry } from '../../panels/registry/panelKindRegistry';
import type { PinnedRunStore } from '../../screener/ports';
import type { TickerResolver } from '../domain/page';
import {
	RESULTS_TABLE_CONFIG_SCHEMA,
	defaultWireResultsTableConfig
} from '../application/tableConfigWire';
import { validateResultsTableWireConfig } from '../tools/tableRendererContract';
import { setResultsPanelRuntimeDeps } from '../panel/resultsPanelContext';

export interface ResultsTablePanelKindDeps {
	useCaseDeps: PanelUseCaseDeps;
	runs: PinnedRunStore;
	catalog?: CatalogRegistry;
	resolveTicker?: TickerResolver;
}

// Matches docs/design/panel-system/technical.md's matrix, reproduced by
// defaultPanelKinds.ts's own KIND_SPECS entry for results_table -- kept
// identical here so replacing the placeholder changes nothing about layout
// or linking, only rendering and validation.
const DEFAULT_SIZE: GridSize = { colSpan: 4, rowSpan: 2 };
const MIN_SIZE: GridSize = { colSpan: 2, rowSpan: 1 };

export function createResultsTablePanelKindDefinition(
	deps: ResultsTablePanelKindDeps
): PanelKindDefinition<Record<string, unknown>> {
	const catalog = deps.catalog ?? builtinCatalogRegistry;

	// Set synchronously here, at registration time -- before component() is
	// ever called -- so the lazily-loaded Svelte component (which cannot
	// receive kind-specific constructor args; see panelController.ts's
	// PanelBodyProps) reads a fully-formed dependency set the first time any
	// panel of this kind mounts. See resultsPanelContext.ts.
	setResultsPanelRuntimeDeps({
		useCaseDeps: deps.useCaseDeps,
		runs: deps.runs,
		resolveTicker: deps.resolveTicker
	});

	return {
		kind: 'results_table',
		defaultTitle: 'Results',
		defaultSize: DEFAULT_SIZE,
		minSize: MIN_SIZE,
		defaultConfig: () => defaultWireResultsTableConfig(),
		validateConfig: (input) => validateResultsTableWireConfig({ runs: deps.runs, catalog }, input),
		configSchema: RESULTS_TABLE_CONFIG_SCHEMA,
		linkChannels: ['symbol', 'result_selection', 'filters'],
		bindingTypes: ['screener_results', 'watchlist', 'panel_reference'],
		defaultRenderer: 'table',
		// A genuine dynamic import (code-split, unlike the placeholder kinds'
		// synchronous marker object) -- resolvePanelBody (panelController.ts)
		// already normalizes a `{ default: fn }` module load, which is exactly
		// what importing a .svelte file yields.
		component: async () => (await import('../panel/ResultsTablePanel.svelte')).default
	};
}

export function registerResultsTablePanelKind(
	registry: PanelRegistry,
	deps: ResultsTablePanelKindDeps
): void {
	registry.register(createResultsTablePanelKindDefinition(deps));
}
