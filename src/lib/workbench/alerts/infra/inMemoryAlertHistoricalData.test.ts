import { describe, expect, it } from 'vitest';
import { emptyUniverse, emptyFilterTree } from '../../../screener/definition';
import { countWeekdays, createInMemoryAlertHistoricalData } from './inMemoryAlertHistoricalData';

const WINDOW = { start: '2026-06-01', end: '2026-06-07' }; // Mon 6/1 .. Sun 6/7

describe('countWeekdays', () => {
	it('counts only Monday-Friday, inclusive of both ends', () => {
		expect(countWeekdays(WINDOW)).toBe(5);
	});

	it('is zero for an end before start', () => {
		expect(countWeekdays({ start: '2026-06-07', end: '2026-06-01' })).toBe(0);
	});

	it('is zero for a single weekend day', () => {
		expect(countWeekdays({ start: '2026-06-06', end: '2026-06-06' })).toBe(0);
	});
});

describe('createInMemoryAlertHistoricalData (default, no fixture)', () => {
	it('is a real implementation that honestly reports no data rather than fabricating any', async () => {
		const port = createInMemoryAlertHistoricalData();
		expect(await port.resolveUniverse(emptyUniverse())).toEqual([]);
		const result = await port.evaluate({
			instrumentIds: ['inst:A'],
			filterTree: emptyFilterTree('filter_1'),
			window: WINDOW
		});
		expect(result.firings).toEqual([]);
		expect(result.warnings).toContain(
			'No historical market-data source is configured for alert preview.'
		);
		expect(result.evaluatedDays).toBe(5);
	});
});

describe('createInMemoryAlertHistoricalData (with fixture)', () => {
	it('resolves the fixture universe', async () => {
		const port = createInMemoryAlertHistoricalData({ instrumentIds: ['inst:A', 'inst:B'] });
		expect(await port.resolveUniverse(emptyUniverse())).toEqual(['inst:A', 'inst:B']);
	});

	it('fires on every evaluated day when the predicate always says yes (a noisy fixture)', async () => {
		const port = createInMemoryAlertHistoricalData({
			instrumentIds: ['inst:A'],
			fires: () => true
		});
		const result = await port.evaluate({
			instrumentIds: ['inst:A'],
			filterTree: emptyFilterTree('filter_1'),
			window: WINDOW
		});
		expect(result.firings).toHaveLength(5);
		expect(result.warnings).toEqual([]);
	});

	it('never fires when no predicate is supplied', async () => {
		const port = createInMemoryAlertHistoricalData({ instrumentIds: ['inst:A'] });
		const result = await port.evaluate({
			instrumentIds: ['inst:A'],
			filterTree: emptyFilterTree('filter_1'),
			window: WINDOW
		});
		expect(result.firings).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it('fires only on the days and instruments the predicate selects', async () => {
		const port = createInMemoryAlertHistoricalData({
			instrumentIds: ['inst:A', 'inst:B'],
			fires: (instrumentId, date) => instrumentId === 'inst:A' && date === '2026-06-03'
		});
		const result = await port.evaluate({
			instrumentIds: ['inst:A', 'inst:B'],
			filterTree: emptyFilterTree('filter_1'),
			window: WINDOW
		});
		expect(result.firings).toEqual([{ instrumentId: 'inst:A', firedAt: '2026-06-03' }]);
	});
});
