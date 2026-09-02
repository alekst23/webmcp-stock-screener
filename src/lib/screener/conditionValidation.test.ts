// Tests for the four structurally simpler condition variants (scalar,
// range, series_comparison, temporal), the dispatch entry point, and the
// AC11 "no raw expression field" guarantee. The four catalog-heavy variants
// (event_relative, pattern, relative, study_output) are covered in
// conditionValidation.catalog.test.ts.
import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../catalog/registry';
import { PROBLEM_CODES } from './validation';
import { validateCondition } from './conditionValidation';
import type {
	Condition,
	RangeCondition,
	ScalarCondition,
	SeriesComparisonCondition,
	TemporalCondition
} from './conditions';

// Real seeded catalog IDs (src/lib/catalog/items.ts): field.price.close is a
// numeric field with range { min: 0 }, op.greater_than accepts numbers.
function scalar(
	fieldId: string,
	value: ScalarCondition['value'],
	operator = 'op.greater_than'
): ScalarCondition {
	return { type: 'scalar', fieldId, operator, value, unit: null };
}

function range(fieldId: string, lower: number, upper: number): RangeCondition {
	return { type: 'range', fieldId, lower, upper, lowerInclusive: true, upperInclusive: true };
}

describe('validateCondition: scalar (AC1)', () => {
	it('accepts_priceGreaterThanTen_withNoProblems', () => {
		const problems = validateCondition(scalar('field.price.close', 10));
		expect(problems, 'a well-formed scalar condition against a real field is valid').toEqual([]);
	});

	it('rejects_unknownField_namingIt', () => {
		const problems = validateCondition(scalar('field.does_not_exist', 10));
		expect(problems.length, 'an unknown field is rejected').toBeGreaterThan(0);
		expect(problems[0]?.code, 'code is unknown_catalog_item').toBe(
			PROBLEM_CODES.unknownCatalogItem
		);
		expect(problems[0]?.message, 'message names the unknown field').toContain(
			'field.does_not_exist'
		);
	});

	it('rejects_valueBelowFieldsDeclaredRange_namingTheRange', () => {
		// field.price.close declares range { min: 0 }.
		const problems = validateCondition(scalar('field.price.close', -5));
		expect(problems.length, 'a negative price is outside the declared range').toBeGreaterThan(0);
		expect(problems[0]?.code).toBe(PROBLEM_CODES.invalidParameter);
		expect(problems[0]?.message, 'message names the permitted range').toContain('range');
	});

	it('rejects_valueOfWrongType_namingTheDeclaredType', () => {
		const problems = validateCondition(scalar('field.volume', 'a lot' as unknown as number));
		expect(problems.length, 'a string value against a numeric field is rejected').toBeGreaterThan(
			0
		);
		expect(problems[0]?.code).toBe(PROBLEM_CODES.invalidParameter);
	});

	it('rejects_operatorNotValidForField_reusingRegistrysReason', () => {
		// op.matches_pattern only accepts 'enum' operands; field.volume is numeric.
		const problems = validateCondition(scalar('field.volume', 10, 'op.matches_pattern'));
		expect(problems.length, 'operator/field type mismatch is rejected').toBeGreaterThan(0);
		expect(
			problems.some((p) => p.code === PROBLEM_CODES.invalidParameter),
			'reports invalid_parameter'
		).toBe(true);
	});
});

describe('validateCondition: range (AC2)', () => {
	it('accepts_rsiBetweenFortyAndSeventy_withNoProblems', () => {
		const problems = validateCondition(range('field.price.close', 10, 50));
		expect(problems, 'a well-formed range with lower <= upper is valid').toEqual([]);
	});

	it('rejects_lowerBoundExceedingUpper_namingBoth', () => {
		const problems = validateCondition(range('field.price.close', 50, 10));
		expect(problems.length, 'lower > upper is rejected').toBeGreaterThan(0);
		expect(problems[0]?.code).toBe(PROBLEM_CODES.invalidParameter);
		expect(problems[0]?.message).toContain('50');
		expect(problems[0]?.message).toContain('10');
	});

	it('rejects_nonNumericField_requiringNumericType', () => {
		const problems = validateCondition(range('field.symbol', 1, 2));
		expect(problems.length, 'a range over a string field is rejected').toBeGreaterThan(0);
		expect(problems.some((p) => p.code === PROBLEM_CODES.invalidParameter)).toBe(true);
	});

	it('rejects_unknownField_namingIt', () => {
		const problems = validateCondition(range('field.does_not_exist', 1, 2));
		expect(problems[0]?.code).toBe(PROBLEM_CODES.unknownCatalogItem);
	});
});

describe('validateCondition: series_comparison (AC3)', () => {
	function seriesComparison(
		leftId: string,
		leftLength: number,
		rightId: string,
		rightLength: number,
		operator = 'op.crosses_above'
	): SeriesComparisonCondition {
		return {
			type: 'series_comparison',
			left: { catalogId: leftId, params: { length: leftLength } },
			right: { catalogId: rightId, params: { length: rightLength } },
			operator
		};
	}

	it('accepts_ma50AboveMa200_withNoProblems', () => {
		const problems = validateCondition(seriesComparison('study.sma', 50, 'study.sma', 200));
		expect(problems, 'two comparable SMA series with valid params are valid').toEqual([]);
	});

	it('rejects_seriesNotComparable_differentValueTypes', () => {
		const condition: SeriesComparisonCondition = {
			type: 'series_comparison',
			left: { catalogId: 'study.sma', params: { length: 50 } },
			right: { catalogId: 'field.symbol', params: {} },
			operator: 'op.crosses_above'
		};
		const problems = validateCondition(condition);
		expect(problems.length, 'a numeric series vs a string field is not comparable').toBeGreaterThan(
			0
		);
		expect(problems.some((p) => p.message.includes('not comparable'))).toBe(true);
	});

	it('rejects_unknownCatalogIdOnEitherSide_namingIt', () => {
		const problems = validateCondition(
			seriesComparison('study.bogus_average', 50, 'study.sma', 200)
		);
		expect(problems.some((p) => p.code === PROBLEM_CODES.unknownCatalogItem)).toBe(true);
		expect(problems.some((p) => p.message.includes('study.bogus_average'))).toBe(true);
	});

	it('rejects_paramOutsideStudysDeclaredRange_namingIt', () => {
		// study.sma's length parameter declares range { min: 1, max: 500 }.
		const problems = validateCondition(seriesComparison('study.sma', 5000, 'study.sma', 200));
		expect(
			problems.some(
				(p) => p.code === PROBLEM_CODES.invalidParameter && p.message.includes('length')
			)
		).toBe(true);
	});
});

describe('validateCondition: temporal (AC4)', () => {
	function temporal(inner: Condition, intervalId: string, withinBars: number): TemporalCondition {
		return { type: 'temporal', condition: inner, event: 'crossed_above', withinBars, intervalId };
	}

	it('accepts_crossedAboveWithinFiveBars_withNoProblems', () => {
		const problems = validateCondition(temporal(scalar('field.price.close', 10), 'interval.1d', 5));
		expect(problems, 'a valid inner condition on a real interval is valid').toEqual([]);
	});

	it('rejects_intervalAbsentFromCatalog_namingIt', () => {
		const problems = validateCondition(
			temporal(scalar('field.price.close', 10), 'interval.bogus', 5)
		);
		expect(problems.some((p) => p.code === PROBLEM_CODES.unknownCatalogItem)).toBe(true);
		expect(problems.some((p) => p.message.includes('interval.bogus'))).toBe(true);
	});

	it('rejects_nonPositiveWithinBars', () => {
		const problems = validateCondition(temporal(scalar('field.price.close', 10), 'interval.1d', 0));
		expect(
			problems.some(
				(p) => p.code === PROBLEM_CODES.invalidParameter && p.message.includes('within_bars')
			)
		).toBe(true);
	});

	it('recursesIntoInnerCondition_bubblingItsProblems', () => {
		// The inner scalar condition names an unknown field -- the wrapper
		// itself is otherwise well-formed, so this problem can only come from
		// walking into `condition.condition` per technical.md.
		const problems = validateCondition(
			temporal(scalar('field.does_not_exist', 10), 'interval.1d', 5)
		);
		expect(problems.some((p) => p.code === PROBLEM_CODES.unknownCatalogItem)).toBe(true);
	});
});

describe('validateCondition: dispatch and injected registry', () => {
	it('defaultsToTheBuiltinRegistry_whenNoneIsInjected', () => {
		const problems = validateCondition(scalar('field.price.close', 10), {});
		expect(problems, 'an empty context still resolves against the built-in catalog').toEqual([]);
	});

	it('usesAnInjectedRegistry_insteadOfTheBuiltin', () => {
		const problems = validateCondition(scalar('field.price.close', 10), {
			registry: builtinCatalogRegistry
		});
		expect(problems).toEqual([]);
	});
});

describe('validateCondition: AC11 no raw expression field', () => {
	it('rejects_conditionCarryingAnExpressionKey_namingIt', () => {
		const withExpression = {
			...scalar('field.price.close', 10),
			expression: 'DROP TABLE instruments; --'
		} as unknown as Condition;
		const problems = validateCondition(withExpression);
		expect(
			problems.length,
			'a stray expression field is rejected, not silently dropped'
		).toBeGreaterThan(0);
		expect(problems[0]?.code).toBe(PROBLEM_CODES.invalidParameter);
		expect(problems[0]?.message).toContain('expression');
	});

	it('rejects_conditionCarryingASqlKey_namingIt', () => {
		const withSql = {
			...scalar('field.price.close', 10),
			sql: 'SELECT * FROM users'
		} as unknown as Condition;
		const problems = validateCondition(withSql);
		expect(problems.some((p) => p.message.includes('sql'))).toBe(true);
	});
});
