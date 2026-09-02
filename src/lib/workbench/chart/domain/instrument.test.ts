import { describe, expect, it } from 'vitest';
import type { ComparisonRef, InstrumentRef } from './instrument';
import {
	DEFAULT_NORMALIZATION,
	copyComparison,
	copyInstrumentRef,
	normalizeComparisons,
	normalizeInstrumentRef,
	normalizeNormalization,
	validateComparisons,
	validateInstrumentRef,
	validateNormalization
} from './instrument';

const apple: InstrumentRef = {
	instrumentId: 'inst:XNAS:AAPL',
	symbol: 'AAPL',
	exchange: 'XNAS',
	assetType: 'equity'
};

const spy: InstrumentRef = {
	instrumentId: 'inst:ARCX:SPY',
	symbol: 'SPY',
	exchange: 'ARCX',
	assetType: 'etf'
};

describe('validateInstrumentRef', () => {
	it('accepts a well-formed instrument reference', () => {
		expect(validateInstrumentRef(apple, 'instrument')).toEqual([]);
	});

	it('rejects a bare ticker where an instrument ID belongs, and says to resolve it', () => {
		const issues = validateInstrumentRef({ ...apple, instrumentId: 'AAPL' }, 'instrument');
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain('instrument.instrumentId');
		expect(issues[0]).toContain('Resolve the ticker through instrument search first');
	});

	it('names each offending field rather than reporting one generic failure', () => {
		const issues = validateInstrumentRef(
			{ instrumentId: 'AAPL', symbol: '', exchange: '', assetType: 'stonk' },
			'comparisons[0].instrument'
		);
		const fields = issues.map((i) => i.split(':')[0]);
		expect(fields).toEqual([
			'comparisons[0].instrument.instrumentId',
			'comparisons[0].instrument.symbol',
			'comparisons[0].instrument.exchange',
			'comparisons[0].instrument.assetType'
		]);
	});

	it('rejects a non-object', () => {
		expect(validateInstrumentRef(null, 'instrument')).toEqual([
			'instrument: expected an instrument reference object.'
		]);
	});
});

describe('validateNormalization', () => {
	it('accepts the recorded default', () => {
		expect(validateNormalization(DEFAULT_NORMALIZATION, 'normalization')).toEqual([]);
	});

	it('rejects an unknown mode naming the permitted values', () => {
		const issues = validateNormalization({ mode: 'log', anchor: 'window_start' }, 'normalization');
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain('normalization.mode');
		expect(issues[0]).toContain('percent_change');
	});

	it('rejects an unknown anchor', () => {
		const issues = validateNormalization({ mode: 'none', anchor: 'left_edge' }, 'normalization');
		expect(issues[0]).toContain('normalization.anchor');
	});
});

describe('validateComparisons', () => {
	const comparison: ComparisonRef = { instrument: spy, normalization: DEFAULT_NORMALIZATION };

	it('accepts a list of distinct comparison instruments', () => {
		expect(validateComparisons([comparison], 'comparisons')).toEqual([]);
	});

	it('rejects the same instrument added twice', () => {
		const issues = validateComparisons([comparison, comparison], 'comparisons');
		expect(issues).toEqual([
			'comparisons[1].instrument.instrumentId: "inst:ARCX:SPY" is already a comparison.'
		]);
	});

	it('indexes the offending entry so the caller knows which one failed', () => {
		const issues = validateComparisons(
			[
				comparison,
				{ instrument: { ...spy, instrumentId: 'SPY' }, normalization: DEFAULT_NORMALIZATION }
			],
			'comparisons'
		);
		expect(issues[0]).toContain('comparisons[1].instrument.instrumentId');
	});

	it('rejects a non-array', () => {
		expect(validateComparisons('SPY', 'comparisons')).toEqual([
			'comparisons: expected an array of comparison instruments.'
		]);
	});
});

describe('copying', () => {
	it('copyInstrumentRef shares no structure with its source', () => {
		const copy = copyInstrumentRef(apple);
		expect(copy).toEqual(apple);
		expect(copy).not.toBe(apple);
	});

	it('copyComparison deep-copies the nested instrument and normalization', () => {
		const source: ComparisonRef = {
			instrument: spy,
			normalization: { mode: 'z_score', anchor: 'anchor_bar' }
		};
		const copy = copyComparison(source);
		expect(copy).toEqual(source);
		expect(copy.instrument).not.toBe(source.instrument);
		expect(copy.normalization).not.toBe(source.normalization);
	});
});

describe('normalize-on-read', () => {
	it('never throws on foreign or primitive input', () => {
		expect(() => normalizeInstrumentRef(undefined)).not.toThrow();
		expect(() => normalizeComparisons('nonsense')).not.toThrow();
		expect(() => normalizeNormalization(42)).not.toThrow();
	});

	it('drops a malformed instrument rather than half-restoring it', () => {
		expect(normalizeInstrumentRef({ instrumentId: 'AAPL', symbol: 'AAPL' })).toBeNull();
	});

	it('falls back to the recorded default for a malformed normalization', () => {
		expect(normalizeNormalization({ mode: 'log' })).toEqual(DEFAULT_NORMALIZATION);
	});

	it('drops malformed and duplicate comparison entries, keeping the rest', () => {
		const kept = normalizeComparisons([
			{ instrument: spy, normalization: { mode: 'indexed_100', anchor: 'window_start' } },
			{ instrument: { ...spy }, normalization: DEFAULT_NORMALIZATION },
			{ instrument: { instrumentId: 'QQQ' }, normalization: DEFAULT_NORMALIZATION },
			'garbage'
		]);
		expect(kept).toHaveLength(1);
		expect(kept[0]?.normalization.mode).toBe('indexed_100');
	});
});
