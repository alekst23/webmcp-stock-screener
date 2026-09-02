// The four source types and four renderer types named in the tool spec,
// registered as placeholders so bind_panel_source, set_panel_renderer,
// configure_panel_view, and configure_chart_grid work end-to-end before
// EPIC-1009 (screener_results), EPIC-1010 (table), EPIC-1011 (chart_grid),
// and EPIC-1012 (the chart_grid collection case) replace each validator by
// re-registering its type -- no edit to this file required.
import type {
	ConfigError,
	ConfigValidation,
	RendererTypeDefinition,
	SourceRendererRegistry,
	SourceTypeDefinition
} from './sourceRendererRegistry';

interface JsonObjectSchema {
	type: 'object';
	properties: Record<string, { type: string }>;
	required?: string[];
}

// Provisional strategy shared by every placeholder type: accept an object
// whose declared `required` fields are present, of the declared primitive
// type, and whose other present fields are all declared properties. Real
// validation is each owning epic's job.
function makePermissiveValidator<T extends Record<string, unknown>>(
	schema: JsonObjectSchema
): (input: unknown) => ConfigValidation<T> {
	return (input: unknown) => {
		if (typeof input !== 'object' || input === null || Array.isArray(input)) {
			return { ok: false, errors: [{ field: '$', reason: 'must be an object' }] };
		}
		const candidate = input as Record<string, unknown>;
		const errors: ConfigError[] = [];

		for (const field of schema.required ?? []) {
			if (!(field in candidate)) {
				errors.push({ field, reason: 'is required' });
			}
		}

		for (const [field, value] of Object.entries(candidate)) {
			const declared = schema.properties[field];
			if (!declared) {
				errors.push({ field, reason: 'not a recognized field' });
				continue;
			}
			if (declared.type === 'array' && !Array.isArray(value)) {
				errors.push({ field, reason: 'must be an array' });
			} else if (declared.type !== 'array' && typeof value !== declared.type) {
				errors.push({ field, reason: `must be a ${declared.type}` });
			}
		}

		if (errors.length > 0) {
			return { ok: false, errors };
		}
		return { ok: true, value: candidate as T };
	};
}

function buildSourceTypes(registry: SourceRendererRegistry): SourceTypeDefinition[] {
	// A source with no renderer chosen yet is compatible with everything --
	// the renderer, once chosen, is what actually constrains the source, so
	// there is nothing to reject before that choice exists.
	const isCompatible =
		(name: string) =>
		({ renderer }: { renderer: string | null }): boolean =>
			renderer === null ||
			(registry.getRendererType(renderer)?.acceptedSourceTypes.includes(name) ?? false);

	return [
		{
			name: 'screener_results',
			refSchema: {
				type: 'object',
				properties: { run_id: { type: 'string' } },
				required: ['run_id']
			},
			validateRef: makePermissiveValidator({
				type: 'object',
				properties: { run_id: { type: 'string' } },
				required: ['run_id']
			}),
			isCompatible: isCompatible('screener_results'),
			compatibilityDescription:
				'Accepted by any renderer that declares "screener_results" in its acceptedSourceTypes, or by a panel with no renderer chosen yet.'
		},
		{
			name: 'watchlist',
			refSchema: {
				type: 'object',
				properties: { watchlist_id: { type: 'string' } },
				required: ['watchlist_id']
			},
			validateRef: makePermissiveValidator({
				type: 'object',
				properties: { watchlist_id: { type: 'string' } },
				required: ['watchlist_id']
			}),
			isCompatible: isCompatible('watchlist'),
			compatibilityDescription:
				'Accepted by any renderer that declares "watchlist" in its acceptedSourceTypes, or by a panel with no renderer chosen yet.'
		},
		{
			name: 'symbol_list',
			refSchema: {
				type: 'object',
				properties: { symbols: { type: 'array' } },
				required: ['symbols']
			},
			validateRef: makePermissiveValidator({
				type: 'object',
				properties: { symbols: { type: 'array' } },
				required: ['symbols']
			}),
			isCompatible: isCompatible('symbol_list'),
			compatibilityDescription:
				'Accepted by any renderer that declares "symbol_list" in its acceptedSourceTypes, or by a panel with no renderer chosen yet.'
		},
		{
			name: 'panel_reference',
			refSchema: {
				type: 'object',
				properties: { panel_id: { type: 'string' } },
				required: ['panel_id']
			},
			validateRef: makePermissiveValidator({
				type: 'object',
				properties: { panel_id: { type: 'string' } },
				required: ['panel_id']
			}),
			isCompatible: isCompatible('panel_reference'),
			compatibilityDescription:
				'Accepted by any renderer that declares "panel_reference" in its acceptedSourceTypes, or by a panel with no renderer chosen yet.'
		}
	];
}

const TABLE_SCHEMA: JsonObjectSchema = {
	type: 'object',
	properties: {
		columns: { type: 'array' },
		sortBy: { type: 'string' },
		sortDirection: { type: 'string' }
	}
};

const CHART_GRID_SCHEMA: JsonObjectSchema = {
	type: 'object',
	properties: {
		rows: { type: 'number' },
		columns: { type: 'number' },
		itemCount: { type: 'number' },
		page: { type: 'number' },
		pageSize: { type: 'number' },
		sharedStudies: { type: 'array' },
		chartSettings: { type: 'object' }
	}
};

const HEATMAP_SCHEMA: JsonObjectSchema = {
	type: 'object',
	properties: {
		metric: { type: 'string' },
		colorScale: { type: 'string' },
		groupBy: { type: 'string' }
	}
};

const SCATTER_PLOT_SCHEMA: JsonObjectSchema = {
	type: 'object',
	properties: {
		xAxis: { type: 'string' },
		yAxis: { type: 'string' },
		colorBy: { type: 'string' }
	}
};

function buildRendererTypes(): RendererTypeDefinition[] {
	return [
		{
			name: 'table',
			configSchema: TABLE_SCHEMA,
			validateConfig: makePermissiveValidator(TABLE_SCHEMA),
			defaultConfig: () => ({ columns: [], sortBy: '', sortDirection: 'desc' }),
			acceptedSourceTypes: ['screener_results', 'watchlist', 'symbol_list']
		},
		{
			name: 'chart_grid',
			configSchema: CHART_GRID_SCHEMA,
			validateConfig: makePermissiveValidator(CHART_GRID_SCHEMA),
			defaultConfig: () => ({
				rows: 3,
				columns: 3,
				itemCount: 9,
				page: 1,
				pageSize: 9,
				sharedStudies: [],
				chartSettings: {}
			}),
			acceptedSourceTypes: ['screener_results', 'watchlist', 'symbol_list', 'panel_reference']
		},
		{
			name: 'heatmap',
			configSchema: HEATMAP_SCHEMA,
			validateConfig: makePermissiveValidator(HEATMAP_SCHEMA),
			defaultConfig: () => ({ metric: 'change_pct', colorScale: 'redGreen', groupBy: '' }),
			acceptedSourceTypes: ['screener_results', 'watchlist', 'symbol_list']
		},
		{
			name: 'scatter_plot',
			configSchema: SCATTER_PLOT_SCHEMA,
			validateConfig: makePermissiveValidator(SCATTER_PLOT_SCHEMA),
			defaultConfig: () => ({ xAxis: '', yAxis: '', colorBy: '' }),
			acceptedSourceTypes: ['screener_results', 'symbol_list']
		}
	];
}

export function registerDefaultSourceRendererTypes(registry: SourceRendererRegistry): void {
	for (const rendererType of buildRendererTypes()) {
		registry.registerRendererType(rendererType);
	}
	for (const sourceType of buildSourceTypes(registry)) {
		registry.registerSourceType(sourceType);
	}
}
