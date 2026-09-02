import { describe, expect, it } from 'vitest';
import { emptyUniverse } from '../definition';
import type { ScreenerMarketData } from '../ports';
import { PROBLEM_CODES } from '../validation';
import { resolveEngineUniverse } from './universe';

function makeMarketData(resolved: string[]): ScreenerMarketData {
	return {
		async resolveUniverse() {
			return resolved;
		},
		async getFieldValue() {
			return null;
		},
		async getSeries() {
			return [];
		},
		async detectPattern() {
			return null;
		},
		async getStudyOutput() {
			return null;
		},
		async getProvenance() {
			throw new Error('getProvenance is not exercised by universe tests');
		}
	};
}

describe('resolveEngineUniverse', () => {
	it('test_nonEmptyResolution_reportsInstrumentsAndNoWarning', async () => {
		const result = await resolveEngineUniverse(emptyUniverse(), makeMarketData(['AAPL', 'MSFT']));
		expect(
			result.instrumentIds,
			'Expected the resolved instrument list to pass through unchanged'
		).toEqual(['AAPL', 'MSFT']);
		expect(result.warnings, 'A non-empty universe carries no warning').toEqual([]);
	});

	it('test_emptyResolution_reportsEmptyUniverseWarning', async () => {
		const result = await resolveEngineUniverse(emptyUniverse(), makeMarketData([]));
		expect(result.instrumentIds, 'Expected an empty instrument list').toEqual([]);
		expect(result.warnings, 'Expected exactly one warning for an empty universe').toHaveLength(1);
		expect(
			result.warnings[0]?.code,
			'Expected the empty-universe PROBLEM_CODES code, not an invented string'
		).toBe(PROBLEM_CODES.emptyUniverse);
	});
});
