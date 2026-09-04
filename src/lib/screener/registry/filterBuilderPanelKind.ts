// The real `filter_builder` PanelKindDefinition (T-0027-1), replacing the
// placeholder KIND_SPECS entry defaultPanelKinds.ts registers -- see that
// file's own comment ("each owning epic replaces its kind's definition by
// re-registering it") and registerDefaultPanelKinds's placeholder-precedence
// rule (panelKindRegistry.ts's register()), which is what makes registering
// this BEFORE the defaults safe rather than a duplicate-registration throw.
//
// defaultSize/minSize/linkChannels/bindingTypes/defaultRenderer/configSchema
// are reused verbatim from defaultPanelKinds.ts's own 'filter_builder'
// KindSpec (same "only component() and validateConfig change" pattern
// watchlistPanelKind.ts and resultsTablePanelKind.ts already established) --
// this ticket only ever reads the workspace's current screener, it never
// writes through panel.config, so validateConfig stays permissive.
import type {
	ConfigError,
	ConfigValidation,
	PanelKindDefinition,
	PanelRegistry
} from '../../panels/registry/panelKindRegistry';
import type { GridSize } from '../../panels/domain/grid';
import type { PanelUseCaseDeps } from '../../panels/application';
import { setFilterBuilderPanelRuntimeDeps } from '../panel/filterBuilderPanelContext';

export interface FilterBuilderPanelKindDeps {
	useCaseDeps: PanelUseCaseDeps;
}

// Matches defaultPanelKinds.ts's own KIND_SPECS entry for 'filter_builder' --
// kept identical here so replacing the placeholder changes nothing about
// layout or linking, only rendering.
const DEFAULT_SIZE: GridSize = { colSpan: 2, rowSpan: 4 };
const MIN_SIZE: GridSize = { colSpan: 1, rowSpan: 2 };
const CONFIG_SCHEMA = {
	type: 'object',
	properties: { filterTree: { type: 'object' } }
};

function defaultConfig(): Record<string, unknown> {
	return { filterTree: {} };
}

// This panel never renders from its own config -- it reads the workspace's
// current screener directly (WorkspaceDocument.screenerId) -- so validation
// only needs to reject a config carrying an unrecognized field, matching
// defaultPanelKinds.ts's own permissive-placeholder behavior exactly rather
// than tightening it for no behavioral reason.
function validateConfig(input: unknown): ConfigValidation<Record<string, unknown>> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return { ok: false, errors: [{ field: 'config', reason: 'must be an object' }] };
	}
	const record = input as Record<string, unknown>;
	const errors: ConfigError[] = Object.keys(record)
		.filter((key) => key !== 'filterTree')
		.map((key) => ({ field: key, reason: 'not a recognized configuration field' }));
	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, value: record };
}

export function createFilterBuilderPanelKindDefinition(
	deps: FilterBuilderPanelKindDeps
): PanelKindDefinition<Record<string, unknown>> {
	// Set synchronously here, at registration time -- before component() is
	// ever called -- mirroring resultsTablePanelKind.ts's and
	// watchlistPanelKind.ts's own registration-time singleton pattern.
	setFilterBuilderPanelRuntimeDeps({ useCaseDeps: deps.useCaseDeps });

	return {
		kind: 'filter_builder',
		defaultTitle: 'Filter Builder',
		defaultSize: DEFAULT_SIZE,
		minSize: MIN_SIZE,
		defaultConfig,
		validateConfig,
		configSchema: CONFIG_SCHEMA,
		linkChannels: ['filters'],
		bindingTypes: [],
		defaultRenderer: null,
		component: async () => (await import('../panel/FilterBuilderPanel.svelte')).default
	};
}

export function registerFilterBuilderPanelKind(
	registry: PanelRegistry,
	deps: FilterBuilderPanelKindDeps
): void {
	registry.register(createFilterBuilderPanelKindDefinition(deps));
}
