import { describe, expect, it, vi } from 'vitest';
import { emptyWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import { writeCapturedSetup } from '../domain/capturedSetup';
import type { CapturedChartSetup } from '../domain/capturedSetup';
import { createChartState, writeChartState } from '../domain/chartState';
import { chartIdSeed, createChartIdSequencer } from './registerChartTools';

const NOW = '2026-09-02T20:00:00.000Z';
const PANEL_ID = 'panel_chart_1';

function seededDocument(): WorkspaceDocument {
	const state = createChartState(PANEL_ID);
	state.studies = [
		{
			id: 'study_4',
			catalogItemId: 'study.sma',
			params: { length: 20 },
			pane: 'price_overlay',
			order: 0,
			enabled: true
		}
	];
	state.annotations = [
		{
			id: 'annotation_7',
			kind: 'price_level',
			anchors: { kind: 'price_level', price: 100 },
			priceAdjustment: 'adjusted'
		}
	];
	const withChart = writeChartState(emptyWorkspace('workspace_1', 'Research', NOW), state);
	return writeCapturedSetup(withChart, { setupId: 'setup_3' } as CapturedChartSetup);
}

describe('registerChartTools', () => {
	// T-1015-3: flipped true -- the main route's composition root now wires
	// this group's tools in (see workbenchCompositionRoot.ts). This is a
	// genuine global constant (not per-route config), so this test asserts
	// the new behavior directly, matching registerWorkbenchTools.test.ts's
	// own T-0020-1 precedent.
	it('CHART_TOOLS_ENABLED is true now that the composition root wires this group in (T-1015-3)', async () => {
		const { CHART_TOOLS_ENABLED } = await import('./registerChartTools');
		expect(CHART_TOOLS_ENABLED).toBe(true);
	});

	it('registers tools against document.modelContext now that the flag is on', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		const { registerChartTools, createDefaultChartDeps } = await import('./registerChartTools');
		await registerChartTools(createDefaultChartDeps());
		expect(registerTool).toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('builds a complete default dependency set with nothing registered yet', async () => {
		const { createDefaultChartDeps } = await import('./registerChartTools');
		const deps = createDefaultChartDeps();
		expect(deps.repository.list()).toEqual([]);
		expect(deps.series).toBeTruthy();
		expect(deps.clock.now().length).toBeGreaterThan(0);
	});

	it('answers honestly rather than with fixtures when no market-data feed is wired', async () => {
		const { createDefaultChartDeps } = await import('./registerChartTools');
		const deps = createDefaultChartDeps();
		await expect(
			deps.series.fetchSeries({
				instrumentId: 'inst:XNAS:NVDA',
				timeframe: '1d',
				window: { start: '2026-01-01', end: '2026-02-01' },
				priceAdjustment: 'adjusted',
				session: 'regular'
			})
		).rejects.toThrow(/No series is loaded/);
	});
});

describe('chartIdSeed', () => {
	it('is empty when there is no workspace to seed from', () => {
		expect(chartIdSeed(null)).toEqual({});
	});

	// Studies and annotations live in the chart extension; captured setups live
	// in their own. Seeding from only one of them re-mints a live ID after a
	// reload, which is the failure this exists to prevent.
	it('takes its high-water marks from both extensions', () => {
		expect(chartIdSeed(seededDocument())).toEqual({ study: 4, annotation: 7, setup: 3 });
	});

	it('never re-mints an ID that a reloaded workspace already holds', () => {
		const ids = createChartIdSequencer(seededDocument());
		expect(ids.next('study')).toBe('study_5');
		expect(ids.next('annotation')).toBe('annotation_8');
		expect(ids.next('setup')).toBe('setup_4');
	});

	it('starts a fresh workspace at one', () => {
		const ids = createChartIdSequencer(emptyWorkspace('workspace_2', 'Fresh', NOW));
		expect(ids.next('study')).toBe('study_1');
		expect(ids.next('setup')).toBe('setup_1');
	});
});
