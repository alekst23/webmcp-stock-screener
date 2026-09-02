import { describe, expect, it } from 'vitest';
import {
	computeStudy,
	isStudySupported,
	resolveStudyParams,
	StudyInputError,
	StudyParameterError,
	SUPPORTED_STUDY_IDS,
	STUDY_ENGINE_VERSION,
	UnknownStudyError,
	validateStudyParams,
	type OhlcvBar
} from './studyEngine';
import { REFERENCE_BARS, VWAP_BARS } from './studyEngine/testSupport';
import { ENGINE_VERSION } from '../../domain/provenance';
import { resolveStudy } from '../../../catalog/registry';

const BARS = REFERENCE_BARS;

describe('STUDY_ENGINE_VERSION', () => {
	it('is the surface-wide engine version, not a second one to keep in step', () => {
		expect(STUDY_ENGINE_VERSION, 'one declared version string').toBe(ENGINE_VERSION);
	});

	it('is reported on every computation, so a stored value says what produced it', () => {
		expect(computeStudy(BARS, 'study.sma').engineVersion).toBe(STUDY_ENGINE_VERSION);
	});
});

describe('catalog coverage', () => {
	it('implements every study the catalog declares', () => {
		const declared = [
			'study.sma',
			'study.ema',
			'study.atr',
			'study.rsi',
			'study.macd',
			'study.bollinger_bands',
			'study.vwap'
		];
		expect([...SUPPORTED_STUDY_IDS].sort(), 'engine coverage of the catalog').toEqual(
			declared.sort()
		);
	});

	it('names its outputs exactly as the catalog does, for every study', () => {
		for (const id of SUPPORTED_STUDY_IDS) {
			const item = resolveStudy(id);
			expect(item, `${id} must resolve in the catalog`).toBeDefined();
			const declared = (item?.outputs ?? []).map((o) => o.name);
			const produced = Object.keys(computeStudy(BARS, id).outputs);
			expect(produced, `${id} output names`).toEqual(declared);
		}
	});

	it('resolves defaults from the catalog rather than from its own table', () => {
		for (const id of SUPPORTED_STUDY_IDS) {
			const item = resolveStudy(id);
			const declaredDefaults = Object.fromEntries(
				(item?.parameters ?? []).map((p) => [p.name, p.defaultValue])
			);
			expect(computeStudy(BARS, id).params, `${id} defaults`).toEqual(declaredDefaults);
		}
	});

	it('reports the catalog defaults verbatim for a study with a known default', () => {
		expect(computeStudy(BARS, 'study.rsi').params.length, "RSI's catalog default period").toBe(14);
		expect(computeStudy(BARS, 'study.macd').params, "MACD's catalog defaults").toEqual({
			fast: 12,
			slow: 26,
			signal: 9
		});
	});

	it('answers whether a given catalog ID can be computed', () => {
		expect(isStudySupported('study.sma'), 'a study with a calculator').toBe(true);
		expect(isStudySupported('indicator.relative_volume'), 'not a study').toBe(false);
	});
});

describe('index alignment', () => {
	it('returns exactly one entry per input bar for every output of every study', () => {
		for (const id of SUPPORTED_STUDY_IDS) {
			for (const [name, series] of Object.entries(computeStudy(BARS, id).outputs)) {
				expect(series.length, `${id}.${name} must be aligned to the bars`).toBe(BARS.length);
			}
		}
	});

	it('marks warm-up bars absent rather than padding them with a number', () => {
		const result = computeStudy(BARS, 'study.sma', { length: 5 });
		const sma = result.outputs.sma as readonly (number | null)[];
		expect(sma.slice(0, 4), 'four warm-up bars carry no value').toEqual([null, null, null, null]);
		expect(sma[4], 'the fifth bar is the first with a value').not.toBeNull();
		expect(result.warmupBars, 'reported warm-up length').toBe(4);
	});

	it('counts warm-up from the first bar any output becomes defined', () => {
		const result = computeStudy(BARS, 'study.macd', { fast: 3, slow: 6, signal: 4 });
		expect(result.warmupBars, 'the MACD line is defined before the signal is').toBe(5);
	});
});

describe('parameter rejection', () => {
	function rejection(fn: () => unknown): StudyParameterError {
		try {
			fn();
		} catch (error) {
			if (error instanceof StudyParameterError) {
				return error;
			}
			throw error;
		}
		throw new Error('expected a StudyParameterError, but the call succeeded');
	}

	it('names the parameter, the value and the permitted range for a non-positive period', () => {
		const error = rejection(() => computeStudy(BARS, 'study.sma', { length: 0 }));
		expect(error.parameter).toBe('length');
		expect(error.value).toBe(0);
		expect(error.permitted, 'the catalog range, restated for the caller').toBe(
			'a whole number of bars from 1 to 500'
		);
		expect(error.message).toContain('length');
		expect(error.message).toContain('0');
	});

	it('rejects a period above the catalog maximum', () => {
		const error = rejection(() => computeStudy(BARS, 'study.sma', { length: 501 }));
		expect(error.value, 'the offending value is carried, not clamped').toBe(501);
	});

	it('rejects a fractional period, which no bar count can mean', () => {
		expect(rejection(() => computeStudy(BARS, 'study.sma', { length: 5.5 })).value).toBe(5.5);
	});

	it('rejects a non-numeric period', () => {
		const error = rejection(() =>
			computeStudy(BARS, 'study.sma', { length: '20' as unknown as number })
		);
		expect(error.value, 'a numeric string is not a number').toBe('20');
	});

	it('rejects an enum value the catalog does not declare', () => {
		const error = rejection(() => computeStudy(VWAP_BARS, 'study.vwap', { anchor: 'decade' }));
		expect(error.parameter).toBe('anchor');
		expect(error.permitted, 'the catalog enum members').toContain('session');
	});

	it('rejects a parameter name the study does not declare', () => {
		const error = rejection(() => computeStudy(BARS, 'study.sma', { period: 20 }));
		expect(error.parameter, 'the misspelled name is named back').toBe('period');
		expect(error.message, 'the declared names are offered').toContain('length');
	});

	it('rejects a MACD whose slow period does not exceed its fast period', () => {
		const error = rejection(() =>
			computeStudy(BARS, 'study.macd', { fast: 26, slow: 12, signal: 9 })
		);
		expect(error.parameter).toBe('slow');
		expect(error.message, 'the constraint is stated').toContain('fast');
	});

	it('produces no partial result when a parameter is rejected', () => {
		expect(() => computeStudy(BARS, 'study.bollinger_bands', { stdDev: 0 })).toThrow(
			StudyParameterError
		);
	});

	it('serializes to a wire error carrying the structured fields', () => {
		const wire = rejection(() => computeStudy(BARS, 'study.sma', { length: 0 })).toWireError();
		expect(wire.error).toBe('study_parameter_out_of_range');
		expect(wire.parameter).toBe('length');
		expect(wire.value).toBe(0);
		expect(wire.permitted).toBe('a whole number of bars from 1 to 500');
	});
});

describe('unknown studies', () => {
	it('rejects an ID the catalog does not know and suggests alternatives', () => {
		try {
			computeStudy(BARS, 'study.smma');
			throw new Error('expected an UnknownStudyError');
		} catch (error) {
			expect(error, 'a typed rejection').toBeInstanceOf(UnknownStudyError);
			const unknown = error as UnknownStudyError;
			expect(unknown.catalogItemId).toBe('study.smma');
			expect(unknown.toWireError().error).toBe('unknown_study');
		}
	});

	it('rejects a catalog ID that exists but is not a study', () => {
		expect(() => computeStudy(BARS, 'field.close')).toThrow(UnknownStudyError);
	});
});

describe('validateStudyParams', () => {
	it('reports no issues for parameters the catalog accepts', () => {
		expect(validateStudyParams('study.rsi', { length: 21 }), 'a valid period').toEqual([]);
	});

	it('reports one message naming the parameter for an invalid value', () => {
		const issues = validateStudyParams('study.rsi', { length: 1 });
		expect(issues.length, 'exactly one issue').toBe(1);
		expect(issues[0], 'the message names the parameter').toContain('length');
	});

	it('reports an unknown study as an issue rather than throwing', () => {
		expect(validateStudyParams('study.nope').length, 'unknown study reported as an issue').toBe(1);
	});
});

describe('resolveStudyParams', () => {
	it('fills every declared parameter, merging the supplied ones over the defaults', () => {
		expect(resolveStudyParams('study.bollinger_bands', { length: 10 })).toEqual({
			length: 10,
			stdDev: 2
		});
	});
});

describe('too few bars', () => {
	it('warns and returns all-absent outputs instead of failing', () => {
		const result = computeStudy(BARS.slice(0, 5), 'study.sma', { length: 20 });
		const sma = result.outputs.sma as readonly (number | null)[];
		expect(sma, 'one absence per supplied bar').toEqual([null, null, null, null, null]);
		expect(result.warmupBars, 'nothing is defined in five bars').toBe(5);
		expect(result.warnings.length, 'the caller is told why the study will plot nothing').toBe(1);
		expect(result.warnings[0]).toContain('20');
		expect(result.warnings[0]).toContain('5');
	});

	it('names the outputs that are absent when only some of them are', () => {
		// 33 bars define the MACD line from bar 25 but leave the 9-period signal
		// one bar short of its seed.
		const result = computeStudy(BARS, 'study.macd');
		const macdLine = result.outputs.macd as readonly (number | null)[];
		expect(
			macdLine.some((v) => v !== null),
			'the line itself has values'
		).toBe(true);
		expect((result.outputs.signal as readonly (number | null)[]).every((v) => v === null)).toBe(
			true
		);
		expect(result.warnings[0], 'the partially absent outputs are named').toContain('signal');
		expect(result.warnings[0], 'the partially absent outputs are named').toContain('histogram');
	});

	it('warns on an empty window rather than treating it as an error', () => {
		const result = computeStudy([], 'study.rsi');
		expect(result.outputs.rsi, 'an empty series, not a missing one').toEqual([]);
		expect(result.warmupBars).toBe(0);
		expect(result.warnings.length, 'the empty window is reported').toBe(1);
	});

	it('produces no warning when the window comfortably covers the warm-up', () => {
		expect(
			computeStudy(BARS, 'study.sma', { length: 5 }).warnings,
			'nothing to warn about'
		).toEqual([]);
	});
});

describe('bar validation', () => {
	function withBar(index: number, patch: Partial<OhlcvBar>): OhlcvBar[] {
		return BARS.map((bar, i) => (i === index ? { ...bar, ...patch } : { ...bar }));
	}

	it('rejects a bar whose value the study reads is not a finite number', () => {
		try {
			computeStudy(withBar(3, { close: Number.NaN }), 'study.sma', { length: 5 });
			throw new Error('expected a StudyInputError');
		} catch (error) {
			expect(error).toBeInstanceOf(StudyInputError);
			const input = error as StudyInputError;
			expect(input.barIndex, 'the offending bar is named').toBe(3);
			expect(input.field, 'the offending field is named').toBe('close');
		}
	});

	it('ignores fields the selected study does not read', () => {
		const result = computeStudy(withBar(3, { volume: Number.NaN }), 'study.sma', { length: 5 });
		expect(
			result.outputs.sma?.[4],
			'a moving average of closes does not read volume'
		).not.toBeNull();
	});

	it('rejects an unparseable timestamp for a study that anchors on time', () => {
		const bars = VWAP_BARS.map((bar, i) => (i === 2 ? { ...bar, time: 'yesterday' } : { ...bar }));
		try {
			computeStudy(bars, 'study.vwap');
			throw new Error('expected a StudyInputError');
		} catch (error) {
			expect(error).toBeInstanceOf(StudyInputError);
			expect((error as StudyInputError).field).toBe('time');
		}
	});
});

describe('determinism', () => {
	it('returns identical values for the same bars and parameters', () => {
		for (const id of SUPPORTED_STUDY_IDS) {
			const first = computeStudy(BARS, id);
			const second = computeStudy(BARS, id);
			expect(second, `${id} must be reproducible`).toEqual(first);
		}
	});

	it('does not depend on the identity of the bar objects', () => {
		const copied = BARS.map((bar) => ({ ...bar }));
		expect(computeStudy(copied, 'study.atr')).toEqual(computeStudy(BARS, 'study.atr'));
	});
});

describe('study values through the engine', () => {
	it('matches the calculator output for a study computed by catalog ID', () => {
		const rsi = computeStudy(BARS, 'study.rsi', { length: 14 }).outputs.rsi ?? [];
		expect(rsi[14] as number, 'first Wilder RSI over the reference series').toBeCloseTo(
			70.46413502109705,
			8
		);
	});

	it('resets VWAP on the session boundary the anchor parameter names', () => {
		const session = computeStudy(VWAP_BARS, 'study.vwap', { anchor: 'session' }).outputs.vwap ?? [];
		const month = computeStudy(VWAP_BARS, 'study.vwap', { anchor: 'month' }).outputs.vwap ?? [];
		expect(session, 'each day starts over').toEqual([10, 11, 20, 27.5]);
		expect(month, 'the month accumulates across both days').toEqual([10, 11, 14, 22]);
	});
});
