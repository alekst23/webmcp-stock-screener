// The eight panel kinds from the tool spec, registered as placeholders so
// the fourteen panel tools work end-to-end before any sibling epic lands.
// Sizes, link channels, binding types, and config schemas are real; only
// `component()` and `validateConfig` are provisional -- each owning epic
// (screener, chart, results-table, similarity, watchlist, alerts, symbol
// details) replaces its kind's definition by re-registering it, no edit to
// this file required.
import type {
	ConfigError,
	ConfigValidation,
	PanelKindDefinition,
	PanelRegistry
} from './panelKindRegistry';
import type { GridSize } from '../domain/grid';
import type { PanelLinkChannel } from '../domain/channels';

// Provisional strategy shared by every placeholder kind: accept any object
// whose keys are all declared in the kind's own config schema. Real
// validation (types, ranges, cross-field rules) is each owning epic's job.
function makePermissiveValidator<T extends Record<string, unknown>>(
	schema: object
): (input: unknown) => ConfigValidation<T> {
	const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
	const allowed = new Set(Object.keys(properties));
	return (input: unknown) => {
		if (typeof input !== 'object' || input === null || Array.isArray(input)) {
			return { ok: false, errors: [{ field: 'config', reason: 'must be an object' }] };
		}
		const errors: ConfigError[] = [];
		for (const key of Object.keys(input as Record<string, unknown>)) {
			if (!allowed.has(key)) {
				errors.push({ field: key, reason: 'not a recognized configuration field' });
			}
		}
		if (errors.length > 0) {
			return { ok: false, errors };
		}
		return { ok: true, value: input as T };
	};
}

function placeholderComponent(kind: string): () => Promise<unknown> {
	return async () => ({ placeholderKind: kind });
}

interface KindSpec {
	kind: string;
	defaultTitle: string;
	defaultSize: GridSize;
	minSize: GridSize;
	linkChannels: PanelLinkChannel[];
	bindingTypes: string[];
	defaultRenderer: string | null;
	configSchema: object;
	defaultConfig: () => Record<string, unknown>;
}

// Default kind -> link channel matrix, reproduced exactly from
// docs/design/panel-system/technical.md.
const KIND_SPECS: KindSpec[] = [
	{
		kind: 'filter_builder',
		defaultTitle: 'Filter Builder',
		defaultSize: { colSpan: 1, rowSpan: 4 },
		minSize: { colSpan: 1, rowSpan: 2 },
		linkChannels: ['filters'],
		bindingTypes: [],
		defaultRenderer: null,
		configSchema: {
			type: 'object',
			properties: { filterTree: { type: 'object' } }
		},
		defaultConfig: () => ({ filterTree: {} })
	},
	{
		kind: 'chart',
		defaultTitle: 'Chart',
		defaultSize: { colSpan: 1, rowSpan: 1 },
		minSize: { colSpan: 1, rowSpan: 1 },
		linkChannels: ['symbol', 'timeframe', 'result_selection', 'crosshair'],
		bindingTypes: ['screener_results', 'watchlist', 'symbol_list', 'panel_reference'],
		defaultRenderer: 'chart_grid',
		configSchema: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				timeframe: { type: 'string' },
				studies: { type: 'array', items: { type: 'string' } }
			}
		},
		defaultConfig: () => ({ symbol: null, timeframe: '1D', studies: [] })
	},
	{
		kind: 'study_library',
		defaultTitle: 'Study Library',
		defaultSize: { colSpan: 2, rowSpan: 2 },
		minSize: { colSpan: 1, rowSpan: 1 },
		linkChannels: ['symbol'],
		bindingTypes: ['symbol_list', 'panel_reference'],
		defaultRenderer: null,
		configSchema: {
			type: 'object',
			properties: { category: { type: 'string' }, searchTerm: { type: 'string' } }
		},
		defaultConfig: () => ({ category: null, searchTerm: '' })
	},
	{
		kind: 'results_table',
		defaultTitle: 'Results',
		defaultSize: { colSpan: 4, rowSpan: 2 },
		minSize: { colSpan: 2, rowSpan: 1 },
		linkChannels: ['symbol', 'result_selection', 'filters'],
		bindingTypes: ['screener_results', 'watchlist', 'panel_reference'],
		defaultRenderer: 'table',
		configSchema: {
			type: 'object',
			properties: {
				columns: { type: 'array', items: { type: 'string' } },
				sortBy: { type: 'string' },
				sortDirection: { type: 'string' }
			}
		},
		defaultConfig: () => ({ columns: [], sortBy: null, sortDirection: 'desc' })
	},
	{
		kind: 'similar_opportunities',
		defaultTitle: 'Similar Opportunities',
		defaultSize: { colSpan: 2, rowSpan: 2 },
		minSize: { colSpan: 1, rowSpan: 1 },
		linkChannels: ['symbol', 'timeframe', 'result_selection'],
		bindingTypes: ['screener_results', 'watchlist', 'symbol_list', 'panel_reference'],
		defaultRenderer: 'chart_grid',
		configSchema: {
			type: 'object',
			properties: { symbol: { type: 'string' }, similarityThreshold: { type: 'number' } }
		},
		defaultConfig: () => ({ symbol: null, similarityThreshold: 0.8 })
	},
	{
		kind: 'watchlist',
		defaultTitle: 'Watchlist',
		defaultSize: { colSpan: 2, rowSpan: 2 },
		minSize: { colSpan: 1, rowSpan: 1 },
		linkChannels: ['symbol', 'result_selection'],
		bindingTypes: ['watchlist', 'symbol_list'],
		defaultRenderer: null,
		configSchema: {
			type: 'object',
			properties: { sortBy: { type: 'string' } }
		},
		defaultConfig: () => ({ sortBy: 'symbol' })
	},
	{
		kind: 'alerts',
		defaultTitle: 'Alerts',
		defaultSize: { colSpan: 2, rowSpan: 1 },
		minSize: { colSpan: 1, rowSpan: 1 },
		linkChannels: ['symbol'],
		bindingTypes: ['symbol_list', 'panel_reference'],
		defaultRenderer: null,
		configSchema: {
			type: 'object',
			properties: { onlyTriggered: { type: 'boolean' } }
		},
		defaultConfig: () => ({ onlyTriggered: false })
	},
	{
		kind: 'symbol_details',
		defaultTitle: 'Symbol Details',
		defaultSize: { colSpan: 2, rowSpan: 2 },
		minSize: { colSpan: 1, rowSpan: 1 },
		linkChannels: ['symbol'],
		bindingTypes: ['symbol_list', 'panel_reference'],
		defaultRenderer: null,
		configSchema: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				sections: { type: 'array', items: { type: 'string' } }
			}
		},
		defaultConfig: () => ({ symbol: null, sections: [] })
	}
];

function toDefinition(spec: KindSpec): PanelKindDefinition<Record<string, unknown>> {
	return {
		kind: spec.kind,
		defaultTitle: spec.defaultTitle,
		defaultSize: spec.defaultSize,
		minSize: spec.minSize,
		defaultConfig: spec.defaultConfig,
		validateConfig: makePermissiveValidator(spec.configSchema),
		configSchema: spec.configSchema,
		linkChannels: spec.linkChannels,
		bindingTypes: spec.bindingTypes,
		defaultRenderer: spec.defaultRenderer,
		component: placeholderComponent(spec.kind)
	};
}

// Registers every kind as a placeholder (PanelRegistry.register's
// `{ placeholder: true }` option), which is what makes every owning epic's
// own comment above ("replaces its kind's definition by re-registering it,
// no edit to this file required") actually true regardless of whether this
// function or the sibling epic's real registerPanelKind() call runs first:
// a placeholder never conflicts with, and steps aside for, a real
// registration on either side of it in call order -- see
// PanelRegistry.register's own comment for the full truth table. Starting
// from an empty registry (every call site before T-1010-7) is unaffected:
// nothing is ever already present, so every kind is still registered.
export function registerDefaultPanelKinds(registry: PanelRegistry): void {
	for (const spec of KIND_SPECS) {
		registry.register(toDefinition(spec), { placeholder: true });
	}
}
