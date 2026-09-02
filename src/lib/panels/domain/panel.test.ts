import { describe, expect, it } from 'vitest';
import { makePanel } from './panel';
import type { GridRect } from './grid';

const rect: GridRect = { col: 0, row: 0, colSpan: 2, rowSpan: 2 };

describe('makePanel', () => {
	it('fills in optional fields with their spec-mandated defaults', () => {
		const panel = makePanel({
			id: 'panel_chart_1',
			kind: 'chart',
			title: 'Chart',
			config: {},
			rect
		});

		expect(panel.hidden, `expected new panel to default hidden=false, got ${panel.hidden}`).toBe(
			false
		);
		expect(
			panel.collapsed,
			`expected new panel to default collapsed=false, got ${panel.collapsed}`
		).toBe(false);
		expect(panel.source, `expected new panel to default source=null, got ${panel.source}`).toBe(
			null
		);
		expect(
			panel.renderer,
			`expected new panel to default renderer=null, got ${panel.renderer}`
		).toBe(null);
	});

	it('carries every required field through unchanged', () => {
		const config = { foo: 'bar' };
		const panel = makePanel({
			id: 'panel_chart_1',
			kind: 'chart',
			title: 'Chart',
			config,
			rect
		});

		expect(panel.id, 'expected id to be carried through').toBe('panel_chart_1');
		expect(panel.kind, 'expected kind to be carried through').toBe('chart');
		expect(panel.title, 'expected title to be carried through').toBe('Chart');
		expect(panel.config, 'expected config to be carried through by reference').toBe(config);
		expect(panel.rect, 'expected rect to be carried through').toEqual(rect);
	});

	it('accepts explicit hidden, collapsed, source, and renderer overrides', () => {
		const panel = makePanel({
			id: 'panel_chart_1',
			kind: 'chart',
			title: 'Chart',
			config: {},
			rect,
			hidden: true,
			collapsed: true,
			source: { type: 'screener_results', ref: { run_id: 'run_1' } },
			renderer: 'chart_grid'
		});

		expect(panel.hidden, 'expected explicit hidden=true to be honored').toBe(true);
		expect(panel.collapsed, 'expected explicit collapsed=true to be honored').toBe(true);
		expect(panel.source, 'expected explicit source to be honored').toEqual({
			type: 'screener_results',
			ref: { run_id: 'run_1' }
		});
		expect(panel.renderer, 'expected explicit renderer to be honored').toBe('chart_grid');
	});

	it('accepts an explicit null source and renderer', () => {
		const panel = makePanel({
			id: 'panel_chart_1',
			kind: 'chart',
			title: 'Chart',
			config: {},
			rect,
			source: null,
			renderer: null
		});

		expect(panel.source, 'expected explicit null source to stay null').toBe(null);
		expect(panel.renderer, 'expected explicit null renderer to stay null').toBe(null);
	});
});
