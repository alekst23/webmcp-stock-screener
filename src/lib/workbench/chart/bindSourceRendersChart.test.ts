// Bug fix (see git history): bind_panel_source used to validate and store a
// chart's source ref onto panel.source correctly (once the real source/
// renderer contract was registered), but never wrote the chart's own
// ChartState extension -- the thing readChartData/ChartPanelBody.svelte
// actually read. A chart panel kept refusing "has no chart on it" even
// after a fully successful bind_panel_source call.
//
// This proves the closed loop through the REAL composition root and the
// REAL panels/application bindPanelSource use case (no hand-written
// ChartState poking, unlike ChartPanelBody.test.ts's other cases): create
// the default workspace, bind its seeded chart panel to a resolved
// instrument the same way an agent would (bind_panel_source), and mount the
// real ChartPanelBody.svelte -- it must render real bars, not the "no
// instrument bound" refusal.
import { describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { bindPanelSource, readPanelState } from '../../panels/application';
import { createPanelShellRuntime, createWorkbenchSharedInfra } from '../../panels/shell/registerPanelTools';
import { CHART_SOURCE_TYPE } from './tools/chartRendererContract';
import { createInMemoryChartSeries } from './infra/inMemoryChartSeries';
import type { ChartPanelRuntimeDeps } from './registry/chartPanelContext';
import ChartPanelBody from './panel/ChartPanelBody.svelte';

const ctx = () => ({ actor: 'agent' as const });

function mountTarget(): HTMLDivElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	return target;
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

describe('bind_panel_source -> ChartPanelBody, end to end', () => {
	it('a chart panel renders real bars after a real bind_panel_source call, no manual ChartState writes', async () => {
		const shared = createWorkbenchSharedInfra();
		const runtime = createPanelShellRuntime(shared);
		const deps = runtime.deps;

		const seededDoc = deps.repository.get(deps.workspaceId)!;
		const seededChart = readPanelState(seededDoc).panels.find((p) => p.kind === 'chart')!;
		const panelId = seededChart.id;

		const envelope = bindPanelSource(deps, {
			context: ctx(),
			panelId,
			source: {
				type: CHART_SOURCE_TYPE,
				ref: {
					instrument: {
						instrument_id: 'inst:XNAS:NVDA',
						symbol: 'NVDA',
						exchange: 'XNAS',
						asset_type: 'equity'
					},
					range: { kind: 'explicit', start: '2026-01-02', end: '2026-01-03' }
				}
			}
		});
		expect(envelope.newRevision, 'expected bind_panel_source to actually commit').toBeGreaterThan(0);

		// A test-local in-memory series port stands in for the real HTTP one
		// (no live backend in this test run) -- everything else (the
		// workspace, the panel, the bound source, the chart state it wrote)
		// is the real thing bind_panel_source produced above.
		const chartRuntimeDeps: ChartPanelRuntimeDeps = {
			useCaseDeps: deps,
			series: createInMemoryChartSeries({
				clock: deps.clock,
				series: [
					{
						instrumentId: 'inst:XNAS:NVDA',
						timeframe: '1d',
						sourceAdjustment: 'adjusted',
						liveness: 'historical',
						bars: [
							{ time: '2026-01-02', open: 100, high: 102, low: 99, close: 101, volume: 1_000_000 },
							{ time: '2026-01-03', open: 101, high: 103, low: 100, close: 102, volume: 1_200_000 }
						]
					}
				]
			})
		};

		const target = mountTarget();
		const panel = readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
			(p) => p.id === panelId
		)!;
		const instance = mount(ChartPanelBody, {
			target,
			props: { panel, deps: chartRuntimeDeps, onBroadcast: () => false }
		});
		await settle();

		expect(
			target.querySelector('[data-testid="chart-panel"]'),
			`expected the real ChartPanel to render bars, got: ${target.innerHTML}`
		).not.toBeNull();
		expect(target.querySelector('[data-testid="chart-instrument"]')?.textContent).toBe('NVDA');
		expect(
			target.querySelector('[data-testid="chart-empty"]'),
			`expected no empty-state message once bars are rendered, got: ${target.innerHTML}`
		).toBeNull();

		unmount(instance);
	});
});
