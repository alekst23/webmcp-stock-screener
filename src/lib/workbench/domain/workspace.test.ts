import { describe, expect, it } from 'vitest';
import { emptyWorkspace, normalizeWorkspace } from './workspace';

describe('emptyWorkspace', () => {
	it('constructs an empty workspace at revision 1', () => {
		const ws = emptyWorkspace('workspace_1', 'My Workspace', '2026-01-01T00:00:00.000Z');
		expect(ws).toEqual({
			id: 'workspace_1',
			name: 'My Workspace',
			revision: 1,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			panels: [],
			layout: [],
			links: [],
			activeSymbol: null,
			activePanelId: null,
			screenerId: null,
			extensions: {}
		});
	});
});

describe('normalizeWorkspace', () => {
	it('never throws on undefined, null or primitive input', () => {
		expect(() => normalizeWorkspace(undefined)).not.toThrow();
		expect(() => normalizeWorkspace(null)).not.toThrow();
		expect(() => normalizeWorkspace('garbage')).not.toThrow();
		expect(() => normalizeWorkspace(42)).not.toThrow();
	});

	it('returns a valid, fully-defaulted document for totally foreign data', () => {
		const result = normalizeWorkspace({ someOtherApp: true });
		expect(result.panels).toEqual([]);
		expect(result.layout).toEqual([]);
		expect(result.links).toEqual([]);
		expect(result.revision).toBe(1);
		expect(result.extensions).toEqual({});
	});

	it('round-trips a well-formed document unchanged', () => {
		const doc = {
			id: 'workspace_1',
			name: 'Test',
			revision: 3,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-02T00:00:00.000Z',
			panels: [
				{
					id: 'panel_chart_1',
					kind: 'chart',
					title: 'Chart',
					collapsed: false,
					visible: true,
					boundResourceId: null,
					config: { symbol: 'AAPL' }
				}
			],
			layout: [{ panelId: 'panel_chart_1', col: 0, row: 0, width: 4, height: 2 }],
			links: [],
			activeSymbol: 'AAPL',
			activePanelId: 'panel_chart_1',
			screenerId: null,
			extensions: { 'chart.custom': { zoom: 2 } }
		};
		expect(normalizeWorkspace(doc)).toEqual(doc);
	});

	it('drops a malformed panel entry instead of throwing or corrupting the rest', () => {
		const result = normalizeWorkspace({
			panels: [
				{ id: 'panel_chart_1', kind: 'not_a_real_kind' },
				{ id: 'panel_grid_1', kind: 'results_table' }
			]
		});
		expect(result.panels).toHaveLength(1);
		expect(result.panels[0]?.id).toBe('panel_grid_1');
	});

	it('drops a malformed link entry (bad channel) instead of throwing', () => {
		const result = normalizeWorkspace({
			links: [{ id: 'link_1', sourcePanelId: 'p1', targetPanelId: 'p2', channel: 'telepathy' }]
		});
		expect(result.links).toEqual([]);
	});

	it('preserves unknown extension keys untouched', () => {
		const result = normalizeWorkspace({ extensions: { 'screener.filters': { tree: 'x' } } });
		expect(result.extensions).toEqual({ 'screener.filters': { tree: 'x' } });
	});

	it('defaults a non-positive or missing revision to 1', () => {
		expect(normalizeWorkspace({ revision: 0 }).revision).toBe(1);
		expect(normalizeWorkspace({ revision: -3 }).revision).toBe(1);
		expect(normalizeWorkspace({}).revision).toBe(1);
	});
});
