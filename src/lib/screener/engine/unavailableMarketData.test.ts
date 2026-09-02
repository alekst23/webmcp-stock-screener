import { describe, expect, it } from 'vitest';
import {
	createUnavailableMarketData,
	UNCONFIGURED_MARKET_DATA_SOURCE_ID
} from './unavailableMarketData';

describe('createUnavailableMarketData', () => {
	it('test_resolveUniverse_anyInput_returnsEmptyList', async () => {
		const marketData = createUnavailableMarketData();
		const result = await marketData.resolveUniverse({
			assetClass: 'equity',
			exchanges: ['exch.nyse'],
			countries: [],
			sectors: [],
			industries: [],
			indexes: [],
			watchlists: [],
			liquidity: { minPrice: null, minAverageVolume: null, minMarketCap: null },
			exclusions: { instrumentIds: [], sectorIds: [], industryIds: [] }
		});
		expect(
			result,
			`Expected an unconfigured universe to resolve empty, got ${JSON.stringify(result)}`
		).toEqual([]);
	});

	it('test_getFieldValue_anyField_returnsNull', async () => {
		const marketData = createUnavailableMarketData();
		const result = await marketData.getFieldValue('AAPL', 'field.volume');
		expect(
			result,
			'Expected an unconfigured field read to be null, not an invented value'
		).toBeNull();
	});

	it('test_getSeries_anyRequest_returnsEmptyArray', async () => {
		const marketData = createUnavailableMarketData();
		const result = await marketData.getSeries('AAPL', 'study.sma', { length: 20 });
		expect(
			result,
			`Expected an unconfigured series read to be empty, got ${JSON.stringify(result)}`
		).toEqual([]);
	});

	it('test_detectPattern_anyPattern_returnsNull', async () => {
		const marketData = createUnavailableMarketData();
		const result = await marketData.detectPattern('AAPL', 'pattern.bull_flag', 'interval.1d');
		expect(
			result,
			'Expected an unconfigured pattern read to be null, not a fabricated hit'
		).toBeNull();
	});

	it('test_getStudyOutput_anyOutput_returnsNull', async () => {
		const marketData = createUnavailableMarketData();
		const result = await marketData.getStudyOutput('AAPL', 'study.macd', {}, 'histogram');
		expect(result, 'Expected an unconfigured study output read to be null').toBeNull();
	});

	it('test_getProvenance_noSourceConfigured_reportsStaticLivenessNeverDelayed', async () => {
		const marketData = createUnavailableMarketData();
		const provenance = await marketData.getProvenance();
		expect(
			provenance.liveness,
			'An honest default must never claim "delayed" without a real magnitude to report'
		).toBe('static');
		expect(provenance.sourceId, 'Expected the unconfigured source id to be stated').toBe(
			UNCONFIGURED_MARKET_DATA_SOURCE_ID
		);
		expect(
			provenance.engineVersion,
			'Expected engineVersion to be stamped via makeProvenance'
		).toBeTruthy();
	});
});
