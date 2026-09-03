// The chart surface assembled: three directly-registered tools, five
// operations, and one renderer/source contract.
//
// Only three of this epic's five capabilities are tools. `configure_chart` and
// `edit_chart_studies` were retired as standalone tools by the spec
// reconciliation: binding a source, configuring the view and editing studies
// are panel-configuration changes that belong to the panel source/renderer
// contract, so they ship as `OperationDefinition`s plus a renderer definition
// rather than as a second way to do what the panel registry already does.
//
// Everything here is constructed exactly once per call, and the composition
// root calls it exactly once. The tool factories each carry an `ensure*` call
// for their own operation so they remain usable standalone; registering all
// five operations first means those calls find their operation already present
// and register nothing, which is what keeps "constructed once" true rather
// than merely intended.
import type { ToolSpec } from '../../../webmcp/types';
import type { CatalogRegistry } from '../../../catalog/registry';
import type { IdSequencer } from '../../domain/ids';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ChangeHistory } from '../../application/changeHistory';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import type { ChartSeriesPort } from '../domain/seriesPort';
import {
	CHART_ADD_ANNOTATION_KIND,
	ensureAddChartAnnotationOperation
} from '../application/chartAnnotations';
import {
	CHART_CAPTURE_SETUP_KIND,
	ensureCaptureChartSetupOperation
} from '../application/captureSetup';
import {
	CHART_BIND_SOURCE_KIND,
	createChartBindSourceOperation,
	type ChartSourceDeps,
	type InstrumentAvailability
} from '../application/chartSource';
import {
	CHART_EDIT_STUDIES_KIND,
	createEditChartStudiesOperation
} from '../application/chartStudies';
import {
	CHART_CONFIGURE_VIEW_KIND,
	createChartConfigureViewOperation
} from '../application/chartView';
import { buildAddChartAnnotationTool } from './addChartAnnotation';
import { buildCaptureChartSetupTool } from './captureChartSetup';
import { buildGetChartDataTool } from './getChartData';
import {
	CHART_RENDERER_NAME,
	CHART_SOURCE_TYPE,
	createChartSourceTypeDefinition,
	chartRendererTypeDefinition,
	type PanelContractRegistry,
	type RendererTypeDefinition
} from './chartRendererContract';
import { CHART_STUDIES_CONFIG_KEY, composeRendererWithStudies } from './chartStudiesContract';

export { CHART_RENDERER_NAME, CHART_SOURCE_TYPE };

export interface ChartToolsDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
	series: ChartSeriesPort;
	// Absent means the built-in study catalog, which is what the app runs on;
	// tests pass their own.
	catalog?: CatalogRegistry;
	// Absent means the "is this a real instrument, and does it have data there?"
	// checks are skipped rather than answered by a guess -- nothing in this
	// program can answer them yet.
	availability?: InstrumentAvailability;
}

// The five kinds every chart mutation goes through. Named as a list so a
// caller can assert the surface is complete without knowing where each one is
// defined.
export const CHART_OPERATION_KINDS: readonly string[] = [
	CHART_BIND_SOURCE_KIND,
	CHART_CONFIGURE_VIEW_KIND,
	CHART_EDIT_STUDIES_KIND,
	CHART_ADD_ANNOTATION_KIND,
	CHART_CAPTURE_SETUP_KIND
];

// Exported (and narrowed to just `clock`/`availability`, the same way
// buildChartRendererDefinition below is narrowed to `catalog`) so
// chart/registry/chartPanelKind.ts's registerChartSourceRenderer -- the
// real, non-placeholder panel-registry wiring, called before a full
// ChartToolsDeps exists -- can build the same ChartSourceDeps this module's
// own registerChartPanelContract does, without duplicating the
// availability-omission logic.
export function sourceDeps(deps: Pick<ChartToolsDeps, 'clock' | 'availability'>): ChartSourceDeps {
	return {
		clock: deps.clock,
		...(deps.availability !== undefined ? { availability: deps.availability } : {})
	};
}

// Guarded on `get` rather than blind: the registry rejects a duplicate kind
// outright, so a second call would throw instead of being a no-op. This makes
// registering the chart surface twice -- a remount, a test rebuilding deps
// against a shared registry -- safe.
export function registerChartOperations(deps: ChartToolsDeps): void {
	const registry = deps.registry;
	if (!registry.get(CHART_BIND_SOURCE_KIND)) {
		registry.register(createChartBindSourceOperation(sourceDeps(deps)));
	}
	if (!registry.get(CHART_CONFIGURE_VIEW_KIND)) {
		registry.register(createChartConfigureViewOperation());
	}
	if (!registry.get(CHART_EDIT_STUDIES_KIND)) {
		registry.register(createEditChartStudiesOperation({ registry: deps.catalog }));
	}
	ensureAddChartAnnotationOperation(registry, { clock: deps.clock });
	ensureCaptureChartSetupOperation(registry, { clock: deps.clock });
}

// The view half rejects any key it does not own, which is correct for a config
// that is only the view and wrong for the composed one: `studies` belongs to
// its sibling half, and left as-is the composed renderer rejects its own
// defaults. Composing is where that is knowable, so each half is shown only
// the keys it owns rather than either half being taught about the other.
function withoutStudies(config: unknown): unknown {
	if (typeof config !== 'object' || config === null || Array.isArray(config)) {
		return config;
	}
	const { [CHART_STUDIES_CONFIG_KEY]: _studies, ...rest } = config as Record<string, unknown>;
	return rest;
}

// The renderer the panel registry will hold for `chart` panels: the view half
// (candle type, scale, session, adjustment policy) folded together with the
// study-editing half into one definition, so there is one `chart_grid` rather
// than two partial ones.
//
// Narrowed to only the one field this actually reads (`catalog`) rather than
// the full ChartToolsDeps -- registerPanelTools.ts's real chart-panel-kind
// wiring (chart/registry/chartPanelKind.ts's registerChartSourceRenderer)
// calls this before a full ChartToolsDeps (repository, series, ...) exists
// at panel-kind-registration time, and building one just to satisfy this
// signature would be wasted construction, not a real dependency.
export function buildChartRendererDefinition(
	deps: Pick<ChartToolsDeps, 'catalog'>
): RendererTypeDefinition {
	const viewHalf: RendererTypeDefinition = {
		...chartRendererTypeDefinition,
		validateConfig: (config) => chartRendererTypeDefinition.validateConfig(withoutStudies(config))
	};
	return composeRendererWithStudies(viewHalf, { registry: deps.catalog });
}

// The single call site for wiring the chart into the panel source/renderer
// registry, whose shape is declared structurally in `chartRendererContract`.
// Nothing is imported from the epic that owns that registry.
export function registerChartPanelContract(
	registry: PanelContractRegistry,
	deps: ChartToolsDeps
): RendererTypeDefinition {
	const renderer = buildChartRendererDefinition(deps);
	registry.registerSourceType(createChartSourceTypeDefinition(sourceDeps(deps)));
	registry.registerRendererType(renderer);
	return renderer;
}

export function buildChartTools(deps: ChartToolsDeps): ToolSpec[] {
	registerChartOperations(deps);
	return [
		buildGetChartDataTool({
			repository: deps.repository,
			series: deps.series,
			clock: deps.clock,
			...(deps.catalog !== undefined ? { registry: deps.catalog } : {})
		}),
		buildAddChartAnnotationTool({
			repository: deps.repository,
			revisions: deps.revisions,
			history: deps.history,
			registry: deps.registry,
			clock: deps.clock,
			ids: deps.ids
		}),
		buildCaptureChartSetupTool({
			repository: deps.repository,
			revisions: deps.revisions,
			history: deps.history,
			registry: deps.registry,
			clock: deps.clock,
			ids: deps.ids,
			series: deps.series
		})
	];
}
