import { describe, expect, it, vi } from 'vitest';

describe('registerAlertTools', () => {
	it('defaults ALERT_TOOLS_ENABLED to off, so the shipping surface is untouched (T-1014-11 wires it on)', async () => {
		const { ALERT_TOOLS_ENABLED } = await import('./registerAlertTools');
		expect(ALERT_TOOLS_ENABLED).toBe(false);
	});

	it('registers nothing against document.modelContext while the flag is off', async () => {
		const registerTool = vi.fn();
		vi.stubGlobal('document', { modelContext: { registerTool } });
		const { registerAlertTools, createDefaultAlertDeps } = await import('./registerAlertTools');
		await registerAlertTools(createDefaultAlertDeps());
		expect(registerTool).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('builds a complete default dependency set with an honest, unwired historical data port', async () => {
		const { createDefaultAlertDeps } = await import('./registerAlertTools');
		const deps = createDefaultAlertDeps();
		expect(deps.repository.list()).toEqual([]);
		expect(
			await deps.historicalData.resolveUniverse({
				assetClass: '',
				exchanges: [],
				countries: [],
				sectors: [],
				industries: [],
				indexes: [],
				watchlists: [],
				liquidity: { minPrice: null, minAverageVolume: null, minMarketCap: null },
				exclusions: { instrumentIds: [], sectorIds: [], industryIds: [] }
			})
		).toEqual([]);
	});
});
