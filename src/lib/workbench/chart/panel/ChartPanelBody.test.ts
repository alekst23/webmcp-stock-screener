// Bug fix (see git history): the chart panel kind had no real component, so
// PlaceholderPanelBody's generic "no screener run yet" text applied to a
// chart panel too, and there was nothing to actually fetch/render bars.
// This proves ChartPanelBody.svelte: an unbound chart shows the real
// engine's own honest refusal text (not the misleading placeholder
// message), and a bound chart with real bars renders the real ChartPanel,
// not a placeholder.
import { describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createRevisionService } from '../../application/revisionService';
import { createIdSequencer } from '../../domain/ids';
import { emptyWorkspace } from '../../domain/workspace';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { createLayoutTemplateRegistry } from '../../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../../panels/registry/sourceRendererRegistry';
import type { PanelUseCaseDeps } from '../../../panels/application';
import { makePanel } from '../../../panels/domain/panel';
import { createChartState, writeChartState } from '../domain/chartState';
import { createInMemoryChartSeries } from '../infra/inMemoryChartSeries';
import type { ChartPanelRuntimeDeps } from '../registry/chartPanelContext';
import ChartPanelBody from './ChartPanelBody.svelte';

const CLOCK = { now: () => '2026-01-10T00:00:00.000Z' };
const WORKSPACE_ID = 'workspace_1';
const PANEL_ID = 'panel_chart_1';

const INSTRUMENT = {
	instrumentId: 'inst:XNAS:AAPL',
	symbol: 'AAPL',
	exchange: 'XNAS',
	assetType: 'equity' as const
};

function mountTarget(): HTMLDivElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	return target;
}

function harness(): PanelUseCaseDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	repository.put(emptyWorkspace(WORKSPACE_ID, 'Test', CLOCK.now()));
	const ids = createIdSequencer();
	return {
		workspaceId: WORKSPACE_ID,
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
		kinds: createPanelRegistry(),
		sourceRenderer: createSourceRendererRegistry(),
		templates: createLayoutTemplateRegistry()
	};
}

function chartPanel() {
	return makePanel({
		id: PANEL_ID,
		kind: 'chart',
		title: 'Chart',
		config: {},
		rect: { col: 0, row: 0, colSpan: 3, rowSpan: 2 }
	});
}

async function settle(): Promise<void> {
	// Drains the readChartData() microtask chain the same way
	// PanelFrame.test.ts does for its own async component-load path.
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

describe('ChartPanelBody', () => {
	it("shows the real engine's own honest refusal when no instrument is bound", async () => {
		const useCaseDeps = harness();
		const deps: ChartPanelRuntimeDeps = {
			useCaseDeps,
			series: createInMemoryChartSeries({ clock: CLOCK, series: [] })
		};
		const target = mountTarget();
		const instance = mount(ChartPanelBody, {
			target,
			props: { panel: chartPanel(), deps, onBroadcast: () => false }
		});
		await settle();

		// No chart state has been written for this panel at all yet (the exact
		// state of a freshly-seeded chart panel before any bind_panel_source
		// call), so the real engine's refusal is chart_panel_not_found, not
		// chart_not_configured -- either way, the real, honest message, never
		// a generic "no screener run yet".
		expect(
			target.querySelector('[data-state="chart_panel_not_found"]')?.textContent,
			`expected the real engine's honest refusal text, got: ${target.innerHTML}`
		).toMatch(/has no chart/);
		expect(
			target.querySelector('[data-testid="chart-panel"]'),
			'the real ChartPanel must not render before an instrument is bound'
		).toBeNull();

		unmount(instance);
	});

	it('shows the real engine\'s "no instrument" refusal for a chart panel with state but no bound instrument', async () => {
		const useCaseDeps = harness();
		const doc = useCaseDeps.repository.get(WORKSPACE_ID)!;
		useCaseDeps.repository.put(writeChartState(doc, createChartState(PANEL_ID)));

		const deps: ChartPanelRuntimeDeps = {
			useCaseDeps,
			series: createInMemoryChartSeries({ clock: CLOCK, series: [] })
		};
		const target = mountTarget();
		const instance = mount(ChartPanelBody, {
			target,
			props: { panel: chartPanel(), deps, onBroadcast: () => false }
		});
		await settle();

		expect(
			target.querySelector('[data-state="chart_not_configured"]')?.textContent,
			`expected the real chart_not_configured refusal text, got: ${target.innerHTML}`
		).toMatch(/has no instrument/);
		expect(target.querySelector('[data-testid="chart-panel"]')).toBeNull();

		unmount(instance);
	});

	it('renders the real ChartPanel with real bars once an instrument is bound', async () => {
		const useCaseDeps = harness();
		const doc = useCaseDeps.repository.get(WORKSPACE_ID)!;
		const state = createChartState(PANEL_ID);
		state.config.instrument = INSTRUMENT;
		state.config.timeframe = '1d';
		state.config.range = {
			kind: 'explicit',
			start: '2026-01-02T00:00:00.000Z',
			end: '2026-01-03T00:00:00.000Z'
		};
		useCaseDeps.repository.put(writeChartState(doc, state));

		const deps: ChartPanelRuntimeDeps = {
			useCaseDeps,
			series: createInMemoryChartSeries({
				clock: CLOCK,
				series: [
					{
						instrumentId: INSTRUMENT.instrumentId,
						timeframe: '1d',
						sourceAdjustment: 'adjusted',
						liveness: 'historical',
						bars: [
							{ time: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
							{ time: '2026-01-03', open: 1.5, high: 2.5, low: 1, close: 2, volume: 200 }
						]
					}
				]
			})
		};
		const target = mountTarget();
		const instance = mount(ChartPanelBody, {
			target,
			props: { panel: chartPanel(), deps, onBroadcast: () => false }
		});
		await settle();

		const chartPanelEl = target.querySelector('[data-testid="chart-panel"]');
		expect(
			chartPanelEl,
			`expected the real ChartPanel to render, got: ${target.innerHTML}`
		).not.toBeNull();
		expect(target.querySelector('[data-testid="chart-instrument"]')?.textContent).toBe('AAPL');
		expect(target.querySelector('[data-testid="chart-empty"]')).toBeNull();

		unmount(instance);
	});
});
