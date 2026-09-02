// The chart's entry in the panel source/renderer registry: what a chart panel
// can be pointed at, and how it draws what it is pointed at.
//
// WHAT THIS MODULE ASSUMES ABOUT THE REGISTRY IT REGISTERS INTO
//
// The panel source/renderer registry is owned by another epic and is not on
// `main` yet, so nothing here imports from it. The definition interfaces below
// are declared structurally, from that registry's own acceptance criteria, and
// the assumptions are:
//
//   1. A source type is `{ name, schema, validateReference(ref) -> string[],
//      acceptsPanel(panelKind, rendererName) -> boolean }`, where an empty
//      issue array means the reference is valid.
//   2. A renderer type is `{ name, configSchema, validateConfig(config) ->
//      string[], defaultConfig() -> object, acceptedSourceTypes }`.
//   3. The registry VALIDATES but never APPLIES. Nothing here mutates a
//      workspace: the mutation half is the `chart.bind_source` and
//      `chart.configure_view` operations, which is where expected_revision,
//      idempotency, the mutation envelope and the undo token come from.
//   4. `schema` and `configSchema` describe the wire shape (snake_case), and
//      the values handed to `validateReference`/`validateConfig` are in that
//      same wire shape.
//   5. The registry accepts a definition through two register calls, named
//      `registerSourceType` and `registerRendererType`.
//
// If any of that turns out differently, the fix is confined to this file:
// the validators, the schemas and the defaults all live elsewhere and are
// reused as-is. The validators delegate to exactly the functions the two
// operations validate with, so the registry's answer and the mutation's answer
// can never disagree.
import {
	validateChartSourceReference,
	CHART_SOURCE_REFERENCE_SCHEMA,
	type ChartSourceDeps
} from '../application/chartSource';
import {
	defaultChartViewConfig,
	validateChartViewConfig,
	CHART_VIEW_CONFIG_SCHEMA
} from '../application/chartView';

// Both are exported constants so that renaming either is a one-line change.
export const CHART_RENDERER_NAME = 'chart_grid';
// None of the registry's placeholder source types describes an instrument with
// a timeframe, a range and comparison series, so the chart brings its own.
export const CHART_SOURCE_TYPE = 'instrument';

export const CHART_PANEL_KIND = 'chart';

export interface SourceTypeDefinition {
	name: string;
	schema: object;
	validateReference(ref: unknown): string[];
	acceptsPanel(kind: string, rendererName: string): boolean;
}

export interface RendererTypeDefinition {
	name: string;
	configSchema: object;
	validateConfig(config: unknown): string[];
	defaultConfig(): Record<string, unknown>;
	acceptedSourceTypes: readonly string[];
}

export interface PanelContractRegistry {
	registerSourceType(definition: SourceTypeDefinition): void;
	registerRendererType(definition: RendererTypeDefinition): void;
}

// Deps-taking because the "is this a known instrument, and does it have data in
// that range?" checks need an availability oracle the registry knows nothing
// about. Without one those two checks are skipped and the structural ones still
// run, which is what makes the deps-free constant below usable.
export function createChartSourceTypeDefinition(deps: ChartSourceDeps = {}): SourceTypeDefinition {
	return {
		name: CHART_SOURCE_TYPE,
		schema: CHART_SOURCE_REFERENCE_SCHEMA,
		validateReference: (ref) => validateChartSourceReference(ref, deps),
		acceptsPanel: (kind, rendererName) =>
			kind === CHART_PANEL_KIND && rendererName === CHART_RENDERER_NAME
	};
}

export const chartSourceTypeDefinition: SourceTypeDefinition = createChartSourceTypeDefinition();

export const chartRendererTypeDefinition: RendererTypeDefinition = {
	name: CHART_RENDERER_NAME,
	configSchema: CHART_VIEW_CONFIG_SCHEMA,
	validateConfig: validateChartViewConfig,
	defaultConfig: defaultChartViewConfig,
	// A chart draws an instrument. It has nothing to render from a screener
	// result set or a watchlist.
	acceptedSourceTypes: [CHART_SOURCE_TYPE]
};

// The single call site, so wiring the chart into the registry stays one line.
export function registerChartRendererContract(
	registry: PanelContractRegistry,
	deps: ChartSourceDeps = {}
): void {
	registry.registerSourceType(createChartSourceTypeDefinition(deps));
	registry.registerRendererType(chartRendererTypeDefinition);
}
