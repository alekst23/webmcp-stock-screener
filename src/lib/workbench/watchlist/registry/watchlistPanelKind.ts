// The real `watchlist` PanelKindDefinition (T-1015-12), replacing the
// placeholder KIND_SPECS entry defaultPanelKinds.ts registers -- see that
// file's own comment ("each owning epic replaces its kind's definition by
// re-registering it") and registerDefaultPanelKinds's placeholder-precedence
// rule (panelKindRegistry.ts's register()), which is what makes registering
// this BEFORE the defaults safe rather than a duplicate-registration throw.
//
// defaultSize/minSize/linkChannels/bindingTypes/configSchema are reused
// verbatim from defaultPanelKinds.ts's own 'watchlist' KindSpec (per this
// ticket's Solution Approach: those already match the panel-system technical
// spec) -- only component() and validateConfig change here. Renders
// EPIC-1014's watchlist state (workbench/watchlist/domain/watchlist.ts),
// read off whichever watchlist this panel is bound to via its `source` ref
// (source type 'watchlist', { watchlist_id }, defaultSourceRendererTypes.ts).
import type {
	ConfigError,
	ConfigValidation,
	PanelKindDefinition,
	PanelRegistry
} from '../../../panels/registry/panelKindRegistry';
import type { GridSize } from '../../../panels/domain/grid';
import type { PanelUseCaseDeps } from '../../../panels/application';
import { setWatchlistPanelRuntimeDeps } from './watchlistPanelContext';

export interface WatchlistPanelConfig extends Record<string, unknown> {
	sortBy: string;
}

export interface WatchlistPanelKindDeps {
	useCaseDeps: PanelUseCaseDeps;
}

// Reproduced from defaultPanelKinds.ts's own KIND_SPECS entry for
// 'watchlist' -- kept identical here so replacing the placeholder changes
// nothing about layout or linking, only rendering and validation.
const DEFAULT_SIZE: GridSize = { colSpan: 2, rowSpan: 2 };
const MIN_SIZE: GridSize = { colSpan: 1, rowSpan: 1 };

function defaultConfig(): WatchlistPanelConfig {
	return { sortBy: 'symbol' };
}

function validateConfig(input: unknown): ConfigValidation<WatchlistPanelConfig> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return { ok: false, errors: [{ field: 'config', reason: 'must be an object' }] };
	}
	const record = input as Record<string, unknown>;
	const errors: ConfigError[] = [];
	for (const key of Object.keys(record)) {
		if (key !== 'sortBy') {
			errors.push({ field: key, reason: 'not a recognized configuration field' });
		}
	}
	if ('sortBy' in record && typeof record.sortBy !== 'string') {
		errors.push({ field: 'sortBy', reason: 'must be a string' });
	}
	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return {
		ok: true,
		value: { sortBy: typeof record.sortBy === 'string' ? record.sortBy : 'symbol' }
	};
}

export function createWatchlistPanelKindDefinition(
	deps: WatchlistPanelKindDeps
): PanelKindDefinition<Record<string, unknown>> {
	// Set synchronously here, at registration time -- before component() is
	// ever called -- mirroring resultsTablePanelKind.ts's own registration-time
	// singleton pattern (see watchlistPanelContext.ts).
	setWatchlistPanelRuntimeDeps({ useCaseDeps: deps.useCaseDeps });

	return {
		kind: 'watchlist',
		defaultTitle: 'Watchlist',
		defaultSize: DEFAULT_SIZE,
		minSize: MIN_SIZE,
		defaultConfig,
		validateConfig,
		configSchema: {
			type: 'object',
			properties: { sortBy: { type: 'string' } }
		},
		linkChannels: ['symbol', 'result_selection'],
		bindingTypes: ['watchlist', 'symbol_list'],
		defaultRenderer: null,
		component: async () => (await import('../panel/WatchlistPanel.svelte')).default
	};
}

export function registerWatchlistPanelKind(
	registry: PanelRegistry,
	deps: WatchlistPanelKindDeps
): void {
	registry.register(createWatchlistPanelKindDefinition(deps));
}
