// The real `chart` PanelKindDefinition plus its real source/renderer
// contract (bug fix, see git history), replacing defaultPanelKinds.ts's
// placeholder `chart` KindSpec and defaultSourceRendererTypes.ts's
// placeholder `instrument`/`chart_grid` entries -- see watchlistPanelKind.ts's
// and resultsTablePanelKind.ts's own header comments for the established
// "replace the placeholder" pattern this follows.
//
// WHY AN ADAPTER, NOT A DIRECT REGISTRATION
//
// chart/tools/chartRendererContract.ts's SourceTypeDefinition/
// RendererTypeDefinition were declared structurally, before the real panel
// source/renderer registry (panels/registry/sourceRendererRegistry.ts)
// existed on main -- see that file's own header. Now that it does, two
// shapes differ from what that module assumed:
//
//   1. validateReference/validateConfig return a bare string[] of issues
//      there; the real registry's validateRef/validateConfig return
//      ConfigValidation<T> -- `{ ok: true, value }` on success, not just "no
//      issues". adaptToConfigValidation below is the seam: on success it
//      hands back the caller's own (already-validated) input as the value,
//      the same "echo the validated input back as the value" convention
//      defaultPanelKinds.ts's and defaultSourceRendererTypes.ts's own
//      placeholder validators already use.
//   2. acceptsPanel(kind, rendererName) -> boolean there; the real
//      registry's isCompatible({ panelKind, renderer }) +
//      compatibilityDescription pair here.
//
// Everything else -- the schemas, the defaults, and the validators' actual
// logic (validateChartSourceReference, chartRendererTypeDefinition's own
// validateConfig, composeRendererWithStudies) -- is reused completely
// unchanged, exactly as chartRendererContract.ts's header promises: "the fix
// is confined to this file."
import type {
	ConfigError,
	ConfigValidation,
	PanelKindDefinition
} from '../../../panels/registry/panelKindRegistry';
import type { PanelRegistry } from '../../../panels/registry/panelKindRegistry';
import type {
	RendererTypeDefinition as RealRendererTypeDefinition,
	SourceRendererRegistry,
	SourceTypeDefinition as RealSourceTypeDefinition
} from '../../../panels/registry/sourceRendererRegistry';
import type { GridSize } from '../../../panels/domain/grid';
import type { PanelLinkChannel } from '../../../panels/domain/channels';
import {
	buildChartRendererDefinition,
	sourceDeps,
	CHART_RENDERER_NAME,
	CHART_SOURCE_TYPE,
	type ChartToolsDeps
} from '../tools/index';
import {
	createChartSourceTypeDefinition,
	CHART_PANEL_KIND,
	type RendererTypeDefinition as StructuralRendererTypeDefinition,
	type SourceTypeDefinition as StructuralSourceTypeDefinition
} from '../tools/chartRendererContract';
import { applyBindSource } from '../application/chartSource';
import { setChartPanelRuntimeDeps, type ChartPanelRuntimeDeps } from './chartPanelContext';

// Matches defaultPanelKinds.ts's own KIND_SPECS entry for 'chart' -- kept
// identical here so replacing the placeholder changes nothing about layout
// or linking, only rendering, validation, and the source/renderer contract.
const DEFAULT_SIZE: GridSize = { colSpan: 3, rowSpan: 2 };
const MIN_SIZE: GridSize = { colSpan: 2, rowSpan: 2 };
const LINK_CHANNELS: PanelLinkChannel[] = ['symbol', 'timeframe', 'result_selection', 'crosshair'];

function adaptToConfigValidation<T extends Record<string, unknown>>(
	input: unknown,
	issues: string[]
): ConfigValidation<T> {
	if (issues.length > 0) {
		const errors: ConfigError[] = issues.map((message) => ({ field: '$', reason: message }));
		return { ok: false, errors };
	}
	return { ok: true, value: input as T };
}

// A validated chart source ref's own field names (CHART_SOURCE_REFERENCE_SCHEMA:
// instrument/timeframe/range/comparisons) onto the wire shape
// chart.bind_source's own apply logic (applyBindSource, chartSource.ts)
// expects (CHART_BIND_SOURCE_SCHEMA: panel_id/instrument/timeframe/range/
// add_comparisons) -- the two schemas differ in exactly one field name
// because a whole binding replaces its comparison list outright ("comparisons")
// where a patch only ever adds to it ("add_comparisons"); everything else
// already matches.
function toBindSourceOperationInput(
	panelId: string,
	ref: Record<string, unknown>
): Record<string, unknown> {
	const { comparisons, ...rest } = ref;
	return {
		panel_id: panelId,
		...rest,
		...(comparisons !== undefined ? { add_comparisons: comparisons } : {})
	};
}

export function adaptSourceType(def: StructuralSourceTypeDefinition): RealSourceTypeDefinition {
	return {
		name: def.name,
		refSchema: def.schema,
		validateRef: (ref) => adaptToConfigValidation(ref, def.validateReference(ref)),
		// def.acceptsPanel's own contract (chartRendererContract.ts) never
		// treats "no renderer chosen yet" as a wildcard the way the generic
		// placeholder source types do -- a chart panel's defaultRenderer is
		// always 'chart_grid' (never null), so this is never asked to decide
		// for a chart panel with no renderer at all.
		isCompatible: ({ panelKind, renderer }) => def.acceptsPanel(panelKind, renderer ?? ''),
		compatibilityDescription: `Accepted only by "${CHART_PANEL_KIND}" panels whose renderer is "${CHART_RENDERER_NAME}".`,
		// Bug fix (see git history): without this, bind_panel_source validated
		// and stored a chart's source ref onto panel.source correctly, but
		// never touched the chart extension readChartData/ChartPanelBody.svelte
		// actually read (ChartState.config.instrument/timeframe/range) -- a
		// chart panel kept refusing "has no chart on it" even after a fully
		// successful bind. Reuses chart.bind_source's own already-built,
		// already-tested apply logic verbatim (applyBindSource) rather than a
		// second, hand-rolled write.
		applyBinding: (doc, panelId, ref) =>
			applyBindSource(toBindSourceOperationInput(panelId, ref), doc).document
	};
}

export function adaptRendererType(
	def: StructuralRendererTypeDefinition
): RealRendererTypeDefinition {
	return {
		name: def.name,
		configSchema: def.configSchema,
		validateConfig: (input) => adaptToConfigValidation(input, def.validateConfig(input)),
		defaultConfig: def.defaultConfig,
		acceptedSourceTypes: [...def.acceptedSourceTypes]
	};
}

// Only the fields the contract actually reads (clock, catalog, availability)
// -- not a full ChartToolsDeps. This runs from registerPanelTools.ts's
// createPanelShellRuntime, before the chart tool group's own ChartToolsDeps
// (repository, series, ids, ...) exists; building one just to satisfy a
// wider signature would be wasted construction, not a real dependency.
export type ChartContractDeps = Pick<ChartToolsDeps, 'clock' | 'catalog' | 'availability'>;

// The single call site for wiring the chart's real source/renderer contract
// into the live registry (as opposed to registerChartPanelContract in
// tools/index.ts, which targets the old structural PanelContractRegistry
// shape and has no caller in this program's actual composition). Real
// registrations (no `{ placeholder: true }`), so they replace whatever
// placeholder defaultSourceRendererTypes.ts already installed for
// 'instrument'/'chart_grid' -- see sourceRendererRegistry.ts's own
// placeholder/real precedence rule for why registering before or after the
// defaults both work.
export function registerChartSourceRenderer(
	registry: SourceRendererRegistry,
	deps: ChartContractDeps
): RealRendererTypeDefinition {
	const renderer = adaptRendererType(buildChartRendererDefinition({ catalog: deps.catalog }));
	registry.registerSourceType(adaptSourceType(createChartSourceTypeDefinition(sourceDeps(deps))));
	registry.registerRendererType(renderer);
	return renderer;
}

export interface ChartPanelKindDeps extends ChartPanelRuntimeDeps {
	// The renderer definition drives this kind's own defaultConfig/
	// validateConfig too (mirrors resultsTablePanelKind.ts: results_table's
	// defaultRenderer is likewise fixed and non-null, so create_panel's
	// initial config is validated against the renderer's own contract, not
	// a second, separate kind-level schema).
	renderer: RealRendererTypeDefinition;
}

export function createChartPanelKindDefinition(
	deps: ChartPanelKindDeps
): PanelKindDefinition<Record<string, unknown>> {
	// Set synchronously here, at registration time -- before component() is
	// ever called -- mirroring resultsTablePanelKind.ts's and
	// watchlistPanelKind.ts's own registration-time singleton pattern.
	setChartPanelRuntimeDeps({
		useCaseDeps: deps.useCaseDeps,
		series: deps.series,
		catalog: deps.catalog
	});

	return {
		kind: CHART_PANEL_KIND,
		defaultTitle: 'Chart',
		defaultSize: DEFAULT_SIZE,
		minSize: MIN_SIZE,
		defaultConfig: () => deps.renderer.defaultConfig(),
		validateConfig: (input) => deps.renderer.validateConfig(input),
		configSchema: deps.renderer.configSchema,
		linkChannels: LINK_CHANNELS,
		// The real accepted source type name (CHART_SOURCE_TYPE, 'instrument'),
		// replacing the placeholder's generic, inaccurate
		// ['screener_results', 'watchlist', 'symbol_list', 'panel_reference']
		// list -- a chart only ever binds to a resolved instrument.
		bindingTypes: [CHART_SOURCE_TYPE],
		defaultRenderer: CHART_RENDERER_NAME,
		component: async () => (await import('../panel/ChartPanelBody.svelte')).default
	};
}

export function registerChartPanelKind(registry: PanelRegistry, deps: ChartPanelKindDeps): void {
	registry.register(createChartPanelKindDefinition(deps));
}
