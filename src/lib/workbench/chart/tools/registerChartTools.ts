// Composition root for the chart surface: wires real infrastructure to
// buildChartTools and registers the three chart tools against
// document.modelContext, alongside the workbench composition root that does
// the same for its seven.
//
// CHART_TOOLS_ENABLED flipped true by T-1015-3: the panel registry that
// creates chart panels (EPIC-1007) is on main now, and T-1015-3's capability
// parity check confirmed this as a surviving capability behind a flag with
// no caller -- workbenchCompositionRoot.ts's registerWorkbenchComposition()
// now calls registerChartTools() unconditionally (this flag decides whether
// that call does anything).
//
// createChartDeps(shared, baseUrl) below (bug fix, see git history): this
// composition root used to build its own, separate WorkspaceRepository
// (createLocalWorkspaceRepository()) rather than sharing the one instance
// registerPanelTools.ts's createWorkbenchSharedInfra() builds -- even though
// both point at the same persisted localStorage key, they were two
// independent in-memory objects, so a write through one (e.g.
// bind_panel_source, which sets panel.source through the *panel* tool
// group) was never visible through the other (this group's own reads)
// without a full reload. `ids` deliberately stays its OWN, chart-seeded
// sequencer rather than reusing `shared.ids` directly: `shared.ids` is only
// ever seeded for the resource kinds the panel/workbench-core/screener
// groups mint ('panel', 'change', 'undo', ...) -- reusing it here unseeded
// for 'study'/'annotation'/'setup' would reintroduce this same class of bug
// for chart's own resources. The two sequencers mint disjoint keys
// (createIdSequencer's contract), so this is correct, not just convenient:
// it also avoids registerPanelTools.ts importing this module to merge
// seeds, which would cycle back into it.
import { ensureModelContext } from '../../../webmcp/bridge';
import { createIdSequencer } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { operationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import type { WorkbenchSharedInfra } from '../../../panels/shell/registerPanelTools';
import { DEV_API_BASE_URL } from '../../../workspace/apiConfig';
import { isInstrumentId } from '../../../surface/ids';
import { capturedSetupIdSeed } from '../domain/capturedSetup';
import { chartStateIdSeed } from '../domain/chartState';
import { createHttpChartSeries } from '../infra/httpChartSeries';
import type { ChartSeriesPort } from '../domain/seriesPort';
import { buildChartTools, type ChartToolsDeps } from './index';

export const CHART_TOOLS_ENABLED = true;

// Two seeds, one sequencer. Studies and annotations live in the chart
// extension and captured setups live in their own, so a sequencer seeded from
// only one of them would happily re-mint a `setup_1` that already exists after
// a reload. Merged by taking the higher mark per key, which is what the
// sequencer's own contract needs: sequence numbers only ever increment.
export function chartIdSeed(doc: WorkspaceDocument | null): Record<string, number> {
	if (!doc) {
		return {};
	}
	const merged: Record<string, number> = {};
	for (const seed of [chartStateIdSeed(doc), capturedSetupIdSeed(doc)]) {
		for (const [key, value] of Object.entries(seed)) {
			merged[key] = Math.max(merged[key] ?? 0, value);
		}
	}
	return merged;
}

export function createChartIdSequencer(doc: WorkspaceDocument | null): IdSequencer {
	return createIdSequencer(chartIdSeed(doc));
}

// The surface's own default instrument-ID construction is `inst:<MIC>:
// <SYMBOL>` (surface/ids.ts's makeInstrumentId) -- but per that module's own
// header, this is the *default* construction only, and callers must treat an
// instrument ID as opaque in general. No real InstrumentDirectory exists
// anywhere in this program yet (see webmcp/screener/registerScreenerTools.ts's
// createUnavailableInstrumentDirectory()), so there is nothing to resolve a
// differently-minted ID through. Recognizing the surface's own default shape
// and extracting its symbol segment is the honest, non-guessing thing this
// composition root can do until a real directory exists; any other ID
// legitimately fails to resolve here (ChartSeriesError 'unknown_instrument'),
// which is what the port already refuses.
function resolveSymbolFromInstrumentId(instrumentId: string): string | null {
	if (!isInstrumentId(instrumentId)) {
		return null;
	}
	return instrumentId.split(':')[2] ?? null;
}

// The real HTTP-backed port over api/chart/bars (backend fix, see git
// history) -- T-1015-4 deleted the old POST /api/research/instance-windows
// route this used to call. Values below mirror exactly what the backend's
// own PanelPriceSeriesPort.provenance() states (backend/infra/
// panel_market_data.py): 'adjusted' prices, UTC, historical liveness -- this
// client-side config has to restate them because the bars response itself
// carries no provenance, only rows.
function defaultSeriesPort(clock: Clock, baseUrl: string): ChartSeriesPort {
	return createHttpChartSeries({
		baseUrl,
		resolveSymbol: resolveSymbolFromInstrumentId,
		clock,
		sourceId: 'src.panel.stored',
		sourceLabel: 'Stored price panel',
		timezone: 'UTC',
		currency: 'USD',
		sourceAdjustment: 'adjusted',
		liveness: 'historical',
		// The stored panel is daily-only (backend/infra/panel_frame.py).
		supportedTimeframes: ['1d']
	});
}

// T-1015-3-and-beyond composition-root sharing fix: built directly against a
// given shared infra bag -- repository, revisions, history and clock are the
// exact same instances every other /workbench tool group's deps object is
// built against -- rather than this module constructing its own independent
// repository. Mirrors registerWorkbenchTools.ts's createWorkbenchDeps(shared)
// and registerFilterDraftTools.ts's own precedent for this exact seeding
// concern. `ids` is deliberately NOT `shared.ids` -- see this file's header
// comment for why a chart-local, chart-seeded sequencer is the correct
// choice, not an oversight.
export function createChartDeps(
	shared: WorkbenchSharedInfra,
	baseUrl: string = DEV_API_BASE_URL
): ChartToolsDeps {
	const { repository, clock, revisions, history } = shared;
	const activeId = repository.getActiveId();
	const ids = createChartIdSequencer(activeId ? repository.get(activeId) : null);
	return {
		repository,
		revisions,
		history,
		registry: operationRegistry,
		clock,
		ids,
		series: defaultSeriesPort(clock, baseUrl)
	};
}

// Fresh instances every call -- never a module-global default -- so a second
// mount (or a test) never sees another instance's registrations. Kept for
// this module's own unit tests and any standalone caller; the real
// composition root (workbenchCompositionRoot.ts) calls createChartDeps
// directly with its shared bag instead, so this group never builds an
// independent repository there. Builds its own repository/clock/history/
// revisions directly (not via createWorkbenchSharedInfra()) -- this path is
// for isolated use, and WorkbenchSharedInfra carries panel-registry fields
// (kinds, sourceRenderer, runs, ...) this group has no use for.
export function createDefaultChartDeps(baseUrl: string = DEV_API_BASE_URL): ChartToolsDeps {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const activeId = repository.getActiveId();
	const ids = createChartIdSequencer(activeId ? repository.get(activeId) : null);
	return {
		repository,
		revisions: createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		registry: operationRegistry,
		clock,
		ids,
		series: defaultSeriesPort(clock, baseUrl)
	};
}

export async function registerChartTools(
	deps: ChartToolsDeps = createDefaultChartDeps()
): Promise<void> {
	if (!CHART_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	for (const spec of buildChartTools(deps)) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}
