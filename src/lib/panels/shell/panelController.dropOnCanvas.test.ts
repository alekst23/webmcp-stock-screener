// T-0027-2: tests for panelController.ts's own drag-a-result-onto-the-
// canvas use-case wrappers (createChartFromDrop, bindPanelSourceFromDrop).
// Builds a harness with the REAL chart panel kind and REAL 'instrument'
// source type registered (mirrors chart/registry/chartPanelKind.test.ts's
// own harness) rather than application/testSupport.ts's
// createPanelTestHarness(), whose placeholder 'chart' kind doesn't accept
// an 'instrument' source at all -- these tests need the real acceptance
// rules to prove AC2/AC3 for real.
import { afterEach, describe, expect, it } from 'vitest';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import { createLayoutTemplateRegistry } from '../domain/layoutTemplates';
import { createPanelRegistry } from '../registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../registry/sourceRendererRegistry';
import {
	createPanel,
	PanelOperationError,
	readPanelState,
	type PanelUseCaseDeps
} from '../application';
import type { PanelSourceRef } from '../domain/panel';
import { createInMemoryChartSeries } from '../../workbench/chart/infra/inMemoryChartSeries';
import {
	CHART_PANEL_KIND,
	CHART_SOURCE_TYPE
} from '../../workbench/chart/tools/chartRendererContract';
import {
	registerChartPanelKind,
	registerChartSourceRenderer
} from '../../workbench/chart/registry/chartPanelKind';
import { resetChartPanelRuntimeDeps } from '../../workbench/chart/registry/chartPanelContext';
import { bindPanelSourceFromDrop, createChartFromDrop, readSnapshot } from './panelController';

const CLOCK = { now: () => '2026-01-01T00:00:00.000Z' };

const INSTRUMENT_SOURCE: PanelSourceRef = {
	type: CHART_SOURCE_TYPE,
	ref: {
		instrument: {
			instrument_id: 'inst:XNAS:AAPL',
			symbol: 'AAPL',
			exchange: 'XUNK',
			asset_type: 'equity'
		}
	}
};

function harness(): PanelUseCaseDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const ids = createIdSequencer();
	const kinds = createPanelRegistry();
	const sourceRenderer = createSourceRendererRegistry();
	const deps: PanelUseCaseDeps = {
		workspaceId: 'workspace_1',
		repository,
		revisions: createRevisionService({
			repository,
			clock: CLOCK,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		clock: CLOCK,
		ids,
		kinds,
		sourceRenderer,
		templates: createLayoutTemplateRegistry()
	};
	const renderer = registerChartSourceRenderer(sourceRenderer, { clock: CLOCK });
	registerChartPanelKind(kinds, {
		useCaseDeps: deps,
		series: createInMemoryChartSeries({ clock: CLOCK, series: [] }),
		renderer
	});
	// A second, non-chart kind that never accepts an instrument source, to
	// exercise AC3.
	kinds.register({
		kind: 'watchlist',
		defaultTitle: 'Watchlist',
		defaultSize: { colSpan: 2, rowSpan: 2 },
		minSize: { colSpan: 1, rowSpan: 1 },
		defaultConfig: () => ({}),
		validateConfig: () => ({ ok: true, value: {} }),
		configSchema: { type: 'object', properties: {} },
		linkChannels: [],
		bindingTypes: ['watchlist'],
		defaultRenderer: null,
		component: async () => ({ placeholderKind: 'watchlist' })
	});
	return deps;
}

afterEach(() => {
	resetChartPanelRuntimeDeps();
});

describe('createChartFromDrop (AC1)', () => {
	it('creates a chart panel anchored at the exact dropped-on cell, bound to the source', () => {
		const deps = harness();
		const anchor = { col: 2, row: 1 };
		const envelope = createChartFromDrop(deps, INSTRUMENT_SOURCE, anchor, []);
		const panelId = envelope.affectedIds[0]!;
		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const panel = state.panels.find((p) => p.id === panelId)!;
		expect(panel.kind).toBe(CHART_PANEL_KIND);
		// The chart kind's own defaultSize (3x2), anchored at the dropped-on
		// cell -- not a bare 1x1, which would fail chart's 2x2 minSize.
		expect(panel.rect).toEqual({ col: 2, row: 1, colSpan: 3, rowSpan: 2 });
		expect(panel.source?.type).toBe(CHART_SOURCE_TYPE);
	});

	it('tags the mutation actor as human, not agent', () => {
		const deps = harness();
		createChartFromDrop(deps, INSTRUMENT_SOURCE, { col: 0, row: 0 }, []);
		const record = deps.history.list(deps.workspaceId, { limit: 1 })[0];
		expect(record, 'expected a change record to have been written').toBeDefined();
		expect(record?.actor).toBe('human');
	});
});

describe('createChartFromDrop (AC4: grid is full)', () => {
	it('reuses the exact grid_full rejection auto-placement produces, instead of an overlap at the dropped cell', () => {
		const deps = harness();
		// Actually fill the real 6x4 grid with 24 real 1x1 watchlist panels --
		// createChartFromDrop's own auto-placement fallback reads the
		// document's real occupancy (support.ts's visibleOccupied), not the
		// `occupied` array passed in here, so that array has to reflect
		// genuinely-occupied cells for this to exercise the real grid_full
		// path end to end rather than only the `occupied`-driven branch
		// decision.
		for (let row = 0; row < 4; row++) {
			for (let col = 0; col < 6; col++) {
				createPanel(deps, {
					context: { actor: 'agent' },
					kind: 'watchlist',
					rect: { col, row, colSpan: 1, rowSpan: 1 }
				});
			}
		}
		const occupied = readSnapshot(deps, null).rects;
		expect(occupied.length, 'expected the fixture to have filled all 24 cells').toBe(24);

		let thrown: unknown;
		try {
			createChartFromDrop(deps, INSTRUMENT_SOURCE, { col: 2, row: 1 }, occupied);
		} catch (err) {
			thrown = err;
		}
		expect(thrown, 'expected createChartFromDrop to throw when the grid is full').toBeInstanceOf(
			PanelOperationError
		);
		expect((thrown as PanelOperationError).code).toBe('grid_full');
	});
});

describe('bindPanelSourceFromDrop (AC2, AC5)', () => {
	it('rebinds an existing chart panel to the dropped instrument instead of creating a new one', () => {
		const deps = harness();
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: CHART_PANEL_KIND,
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		const panelId = created.affectedIds[0]!;
		const before = readSnapshot(deps, null).rects.length;

		bindPanelSourceFromDrop(deps, panelId, INSTRUMENT_SOURCE);

		const after = readSnapshot(deps, null);
		expect(after.rects.length, 'rebinding must not create a second panel').toBe(before);
		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
			(p) => p.id === panelId
		)!;
		expect(panel.source?.type).toBe(CHART_SOURCE_TYPE);
	});

	it('tags the mutation actor as human, not agent', () => {
		const deps = harness();
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: CHART_PANEL_KIND,
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		bindPanelSourceFromDrop(deps, created.affectedIds[0]!, INSTRUMENT_SOURCE);
		const record = deps.history.list(deps.workspaceId, { limit: 1 })[0];
		expect(record?.actor).toBe('human');
	});
});

describe('bindPanelSourceFromDrop (AC3: incompatible target)', () => {
	it('rejects a drop onto a panel whose kind never accepts an instrument source', () => {
		const deps = harness();
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'watchlist',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 2 }
		});
		const panelId = created.affectedIds[0]!;

		let thrown: unknown;
		try {
			bindPanelSourceFromDrop(deps, panelId, INSTRUMENT_SOURCE);
		} catch (err) {
			thrown = err;
		}
		expect(
			thrown,
			'expected the rejection to be the same PanelOperationError bind_panel_source raises'
		).toBeInstanceOf(PanelOperationError);
		expect((thrown as PanelOperationError).code).toBe('invalid_source');

		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
			(p) => p.id === panelId
		)!;
		expect(panel.source, 'a rejected drop must change nothing').toBeNull();
	});
});
