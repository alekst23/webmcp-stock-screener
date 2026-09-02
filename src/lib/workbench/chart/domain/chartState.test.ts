import { describe, expect, it } from 'vitest';
import { createIdSequencer } from '../../domain/ids';
import { emptyWorkspace, normalizeWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import { createAnnotation } from './annotations';
import type { ChartConfig, ChartConfigTransition, ChartState } from './chartState';
import {
	CHART_EXTENSION_KEY,
	CHART_PRICE_ADJUSTMENTS,
	DEFAULT_CHART_PRICE_ADJUSTMENT,
	addComparison,
	applyChartConfigPatch,
	chartStateIdSeed,
	createChartState,
	hasChartState,
	invalidatesChartData,
	readAllChartStates,
	readChartState,
	readChartStateOrNull,
	removeChartState,
	removeComparison,
	toProvenancePriceAdjustment,
	updateComparison,
	validateChartRange,
	writeChartState
} from './chartState';
import type { ComparisonRef, InstrumentRef } from './instrument';
import { DEFAULT_NORMALIZATION } from './instrument';

const apple: InstrumentRef = {
	instrumentId: 'inst:XNAS:AAPL',
	symbol: 'AAPL',
	exchange: 'XNAS',
	assetType: 'equity'
};

const spy: ComparisonRef = {
	instrument: { instrumentId: 'inst:ARCX:SPY', symbol: 'SPY', exchange: 'ARCX', assetType: 'etf' },
	normalization: DEFAULT_NORMALIZATION
};

function configured(): ChartConfig {
	const state = createChartState('panel_1');
	const result = applyChartConfigPatch(state.config, {
		instrument: apple,
		timeframe: '1d',
		range: { kind: 'explicit', start: '2026-01-01T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z' },
		candleType: 'candlestick',
		comparisons: [spy]
	});
	if (!result.ok) {
		throw new Error(`fixture failed to configure: ${result.issues.join('; ')}`);
	}
	return result.config;
}

function expectOk(transition: ChartConfigTransition): ChartConfig {
	if (!transition.ok) {
		throw new Error(`expected a successful transition, got: ${transition.issues.join('; ')}`);
	}
	return transition.config;
}

function expectFailed(transition: ChartConfigTransition): string[] {
	if (transition.ok) {
		throw new Error('expected the transition to be rejected');
	}
	return transition.issues;
}

function workspaceWith(state: ChartState): WorkspaceDocument {
	return writeChartState(emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'), state);
}

describe('a chart configuration', () => {
	it('records every property the spec names', () => {
		const config = configured();
		expect(Object.keys(config).sort()).toEqual([
			'candleType',
			'comparisons',
			'instrument',
			'panelId',
			'priceAdjustment',
			'range',
			'scale',
			'session',
			'timeframe'
		]);
	});

	it('records the price-adjustment default rather than leaving it implied', () => {
		expect(createChartState('panel_1').config.priceAdjustment).toBe(DEFAULT_CHART_PRICE_ADJUSTMENT);
		expect(DEFAULT_CHART_PRICE_ADJUSTMENT).toBe('adjusted');
	});

	it('distinguishes fully adjusted, split-only adjusted and unadjusted', () => {
		expect(Object.keys(CHART_PRICE_ADJUSTMENTS).sort()).toEqual([
			'adjusted',
			'split_adjusted',
			'unadjusted'
		]);
	});

	it('starts with no instrument, because a panel exists before it knows what it shows', () => {
		expect(createChartState('panel_1').config.instrument).toBeNull();
	});
});

describe('toProvenancePriceAdjustment', () => {
	it('maps the chart policy onto provenance’s narrower enum', () => {
		expect(toProvenancePriceAdjustment('adjusted')).toBe('adjusted');
		expect(toProvenancePriceAdjustment('unadjusted')).toBe('unadjusted');
	});

	it('collapses split_adjusted to adjusted, which is why the chart policy is echoed too', () => {
		expect(toProvenancePriceAdjustment('split_adjusted')).toBe('adjusted');
	});
});

describe('applyChartConfigPatch', () => {
	it('changes only the field the patch names', () => {
		const before = configured();
		const after = expectOk(applyChartConfigPatch(before, { candleType: 'heikin_ashi' }));
		expect(after.candleType).toBe('heikin_ashi');
		expect({ ...after, candleType: before.candleType }).toEqual(before);
	});

	it('reports what actually changed, with the prior and new value', () => {
		const result = applyChartConfigPatch(configured(), { scale: 'logarithmic' });
		expect(result.ok && result.changes).toEqual([
			{ field: 'scale', from: 'linear', to: 'logarithmic' }
		]);
	});

	it('reports no change when a field is re-set to the value it already has', () => {
		const result = applyChartConfigPatch(configured(), { candleType: 'candlestick' });
		expect(result.ok && result.changes).toEqual([]);
	});

	it('does not mutate the configuration it was given', () => {
		const before = configured();
		const snapshot = JSON.stringify(before);
		expectOk(applyChartConfigPatch(before, { scale: 'logarithmic', timeframe: '1h' }));
		expect(JSON.stringify(before)).toBe(snapshot);
	});

	it('rejects a bare ticker where an instrument belongs and leaves the prior state unchanged', () => {
		const before = configured();
		const issues = expectFailed(
			applyChartConfigPatch(before, { instrument: { ...apple, instrumentId: 'AAPL' } })
		);
		expect(issues[0]).toContain('instrument.instrumentId');
		expect(before.instrument).toEqual(apple);
	});

	it('rejects an inverted date range naming the offending field', () => {
		const issues = expectFailed(
			applyChartConfigPatch(configured(), {
				range: {
					kind: 'explicit',
					start: '2026-06-30T00:00:00.000Z',
					end: '2026-01-01T00:00:00.000Z'
				}
			})
		);
		expect(issues).toEqual(['range.end: must be after range.start.']);
	});

	it.each([
		['timeframe', { timeframe: '3s' }],
		['candleType', { candleType: 'renko' }],
		['scale', { scale: 'log10' }],
		['session', { session: 'overnight' }],
		['priceAdjustment', { priceAdjustment: 'inflation_adjusted' }]
	])('rejects an unknown %s naming that field', (field, patch) => {
		const issues = expectFailed(
			applyChartConfigPatch(configured(), patch as Parameters<typeof applyChartConfigPatch>[1])
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.startsWith(`${field}:`)).toBe(true);
	});

	it('accepts an explicit null instrument, which is not the same as omitting it', () => {
		const after = expectOk(applyChartConfigPatch(configured(), { instrument: null }));
		expect(after.instrument).toBeNull();
	});
});

describe('validateChartRange', () => {
	it('accepts an explicit window and a relative token', () => {
		expect(
			validateChartRange(
				{ kind: 'explicit', start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' },
				'range'
			)
		).toEqual([]);
		expect(validateChartRange({ kind: 'relative', token: 'ytd' }, 'range')).toEqual([]);
	});

	it('rejects an unknown relative token naming the permitted values', () => {
		const issues = validateChartRange({ kind: 'relative', token: 'forever' }, 'range');
		expect(issues[0]).toContain('range.token');
		expect(issues[0]).toContain('ytd');
	});

	it('rejects a non-ISO bound', () => {
		const issues = validateChartRange({ kind: 'explicit', start: 'jan', end: 'feb' }, 'range');
		expect(issues).toHaveLength(2);
	});
});

describe('invalidatesChartData', () => {
	it('is true for a change that makes the underlying series a different series', () => {
		const timeframe = applyChartConfigPatch(configured(), { timeframe: '1h' });
		const adjustment = applyChartConfigPatch(configured(), { priceAdjustment: 'unadjusted' });
		expect(timeframe.ok && invalidatesChartData(timeframe.changes)).toBe(true);
		expect(adjustment.ok && invalidatesChartData(adjustment.changes)).toBe(true);
	});

	it('is false for a purely cosmetic change', () => {
		const cosmetic = applyChartConfigPatch(configured(), {
			candleType: 'line',
			scale: 'logarithmic'
		});
		expect(cosmetic.ok && invalidatesChartData(cosmetic.changes)).toBe(false);
	});
});

describe('comparison slots', () => {
	const qqq: ComparisonRef = {
		instrument: {
			instrumentId: 'inst:XNAS:QQQ',
			symbol: 'QQQ',
			exchange: 'XNAS',
			assetType: 'etf'
		},
		normalization: { mode: 'percent_change', anchor: 'window_start' }
	};

	it('adds a comparison with its normalization mode', () => {
		const after = expectOk(addComparison(configured(), qqq));
		expect(after.comparisons.map((c) => c.instrument.symbol)).toEqual(['SPY', 'QQQ']);
		expect(after.comparisons[1]?.normalization.mode).toBe('percent_change');
	});

	it('rejects the same comparison instrument twice', () => {
		const issues = expectFailed(addComparison(configured(), spy));
		expect(issues[0]).toContain('is already a comparison');
	});

	it('rejects updating an unknown comparison slot, naming the instrument ID', () => {
		const before = configured();
		const issues = expectFailed(updateComparison(before, 'inst:XNAS:QQQ', DEFAULT_NORMALIZATION));
		expect(issues).toEqual([
			'comparison_instrument_id: "inst:XNAS:QQQ" is not a comparison on this chart.'
		]);
		expect(before.comparisons).toHaveLength(1);
	});

	it('rejects removing an unknown comparison slot and leaves the list unchanged', () => {
		const before = configured();
		expectFailed(removeComparison(before, 'inst:XNAS:QQQ'));
		expect(before.comparisons).toHaveLength(1);
	});

	it('updates only the named slot’s normalization', () => {
		const after = expectOk(
			updateComparison(expectOk(addComparison(configured(), qqq)), 'inst:ARCX:SPY', {
				mode: 'indexed_100',
				anchor: 'anchor_bar'
			})
		);
		expect(after.comparisons[0]?.normalization).toEqual({
			mode: 'indexed_100',
			anchor: 'anchor_bar'
		});
		expect(after.comparisons[1]?.normalization.mode).toBe('percent_change');
	});

	it('removes the named slot only', () => {
		const after = expectOk(
			removeComparison(expectOk(addComparison(configured(), qqq)), 'inst:ARCX:SPY')
		);
		expect(after.comparisons.map((c) => c.instrument.symbol)).toEqual(['QQQ']);
	});
});

describe('reading and writing extensions.chart', () => {
	it('stores chart state under the chart extension key, keyed by panel ID', () => {
		const doc = workspaceWith(createChartState('panel_1'));
		const extension = doc.extensions[CHART_EXTENSION_KEY] as Record<string, unknown>;
		expect(Object.keys(extension)).toEqual(['panel_1']);
	});

	it('returns a new document rather than mutating the one it was given', () => {
		const before = emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z');
		const after = writeChartState(before, createChartState('panel_1'));
		expect(before.extensions).toEqual({});
		expect(after).not.toBe(before);
	});

	it('leaves another epic’s extension key untouched', () => {
		const before = {
			...emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'),
			extensions: { screener: { keep: 'me' } }
		};
		const after = writeChartState(before, createChartState('panel_1'));
		expect(after.extensions.screener).toEqual({ keep: 'me' });
	});

	it('distinguishes never-configured from configured-back-to-defaults', () => {
		const doc = workspaceWith(createChartState('panel_1'));
		expect(readChartStateOrNull(doc, 'panel_2')).toBeNull();
		expect(readChartStateOrNull(doc, 'panel_1')).not.toBeNull();
		expect(hasChartState(doc, 'panel_2')).toBe(false);
	});

	it('readChartState falls back to a fresh default state for an unknown panel', () => {
		const doc = emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z');
		expect(readChartState(doc, 'panel_9')).toEqual(createChartState('panel_9'));
	});

	it('round-trips a fully configured chart through the workspace document', () => {
		const state: ChartState = { config: configured(), studies: [], annotations: [] };
		const doc = workspaceWith(state);
		expect(readChartState(doc, 'panel_1')).toEqual(state);
	});

	it('survives the workspace document’s own normalization untouched', () => {
		const state: ChartState = { config: configured(), studies: [], annotations: [] };
		const reloaded = normalizeWorkspace(JSON.parse(JSON.stringify(workspaceWith(state))));
		expect(readChartState(reloaded, 'panel_1')).toEqual(state);
	});

	it('reads every chart panel at once', () => {
		const doc = writeChartState(
			workspaceWith(createChartState('panel_1')),
			createChartState('panel_2')
		);
		expect(Object.keys(readAllChartStates(doc)).sort()).toEqual(['panel_1', 'panel_2']);
	});

	it('removes one panel’s state without touching the others', () => {
		const doc = writeChartState(
			workspaceWith(createChartState('panel_1')),
			createChartState('panel_2')
		);
		const after = removeChartState(doc, 'panel_1');
		expect(hasChartState(after, 'panel_1')).toBe(false);
		expect(hasChartState(after, 'panel_2')).toBe(true);
	});

	it('never throws on a foreign or malformed extension payload', () => {
		const doc = {
			...emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'),
			extensions: { chart: { panel_1: 'garbage', panel_2: { config: { timeframe: 'eternal' } } } }
		};
		expect(() => readAllChartStates(doc)).not.toThrow();
		expect(readChartState(doc, 'panel_2').config.timeframe).toBe('1d');
	});

	it('writes a copy, so editing the state afterwards does not change the document', () => {
		const state = createChartState('panel_1');
		const doc = workspaceWith(state);
		state.config.candleType = 'line';
		expect(readChartState(doc, 'panel_1').config.candleType).toBe('candlestick');
	});
});

describe('chartStateIdSeed', () => {
	it('seeds the sequencer past the highest live study and annotation IDs', () => {
		const annotation = createAnnotation({
			id: 'annotation_7',
			kind: 'price_level',
			anchors: { kind: 'price_level', price: 100 },
			priceAdjustment: 'adjusted'
		});
		if (!annotation.ok) {
			throw new Error('fixture annotation failed to build');
		}
		const state: ChartState = {
			config: configured(),
			studies: [
				{
					id: 'study_4',
					catalogItemId: 'study.sma',
					params: { period: 50 },
					pane: 'price_overlay',
					order: 0,
					enabled: true
				}
			],
			annotations: [annotation.annotation]
		};
		const seed = chartStateIdSeed(workspaceWith(state));
		const ids = createIdSequencer(seed);
		expect(ids.next('study')).toBe('study_5');
		expect(ids.next('annotation')).toBe('annotation_8');
	});

	it('is empty for a workspace with no chart state', () => {
		expect(
			chartStateIdSeed(emptyWorkspace('workspace_1', 'W', '2026-01-01T00:00:00.000Z'))
		).toEqual({});
	});
});
