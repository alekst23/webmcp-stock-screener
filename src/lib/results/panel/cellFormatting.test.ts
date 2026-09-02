import { describe, expect, it } from 'vitest';
import { resolveCellStyle } from './cellFormatting';
import type { FormattingRule } from '../domain/tableConfig';

function rule(overrides: Partial<FormattingRule> = {}): FormattingRule {
	return {
		id: 'rule_1',
		predicate: { columnId: 'col_pe', comparator: 'lt', value: 15 },
		style: { backgroundColor: '#ignored-in-tests-not-a-css-literal-check' },
		...overrides
	};
}

describe('resolveCellStyle', () => {
	it('applies style when the predicate matches', () => {
		const style = resolveCellStyle({ col_pe: 10 }, 'col_pe', [rule()]);
		expect(style.backgroundColor).toBe('#ignored-in-tests-not-a-css-literal-check');
	});

	it('leaves the cell unstyled when the rule targets a different column', () => {
		const style = resolveCellStyle({ col_pe: 10, col_other: 999 }, 'col_other', [rule()]);
		expect(style, 'a rule for another column must not touch this cell').toEqual({});
	});

	it('leaves every cell unstyled when the predicate matches no row -- table stays unchanged (AC4)', () => {
		const columnValues = { col_pe: 999 };
		const style = resolveCellStyle(columnValues, 'col_pe', [
			rule({ predicate: { columnId: 'col_pe', comparator: 'lt', value: 15 } })
		]);
		expect(style, 'value 999 does not satisfy lt 15, so nothing should apply').toEqual({});
	});

	it('never matches a null actual value, regardless of comparator', () => {
		for (const comparator of ['lt', 'lte', 'gt', 'gte', 'eq', 'ne'] as const) {
			const style = resolveCellStyle({ col_pe: null }, 'col_pe', [
				rule({ predicate: { columnId: 'col_pe', comparator, value: 0 } })
			]);
			expect(style, `comparator ${comparator} must not match a null value`).toEqual({});
		}
	});

	it('covers every numeric comparator correctly', () => {
		const cases: {
			comparator: FormattingRule['predicate']['comparator'];
			value: number;
			actual: number;
			expectMatch: boolean;
		}[] = [
			{ comparator: 'lt', value: 10, actual: 9, expectMatch: true },
			{ comparator: 'lt', value: 10, actual: 10, expectMatch: false },
			{ comparator: 'lte', value: 10, actual: 10, expectMatch: true },
			{ comparator: 'lte', value: 10, actual: 11, expectMatch: false },
			{ comparator: 'gt', value: 10, actual: 11, expectMatch: true },
			{ comparator: 'gt', value: 10, actual: 10, expectMatch: false },
			{ comparator: 'gte', value: 10, actual: 10, expectMatch: true },
			{ comparator: 'gte', value: 10, actual: 9, expectMatch: false },
			{ comparator: 'eq', value: 10, actual: 10, expectMatch: true },
			{ comparator: 'eq', value: 10, actual: 11, expectMatch: false },
			{ comparator: 'ne', value: 10, actual: 11, expectMatch: true },
			{ comparator: 'ne', value: 10, actual: 10, expectMatch: false }
		];
		for (const c of cases) {
			const style = resolveCellStyle({ col: c.actual }, 'col', [
				rule({ predicate: { columnId: 'col', comparator: c.comparator, value: c.value } })
			]);
			const matched = style.backgroundColor !== undefined;
			expect(
				matched,
				`comparator ${c.comparator}: expected actual=${c.actual} vs value=${c.value} to ${c.expectMatch ? '' : 'not '}match`
			).toBe(c.expectMatch);
		}
	});

	it('lets a later matching rule override an earlier one for the same style property', () => {
		const style = resolveCellStyle({ col: 5 }, 'col', [
			rule({
				id: 'r1',
				predicate: { columnId: 'col', comparator: 'gte', value: 0 },
				style: { backgroundColor: 'first' }
			}),
			rule({
				id: 'r2',
				predicate: { columnId: 'col', comparator: 'gte', value: 0 },
				style: { backgroundColor: 'second' }
			})
		]);
		expect(style.backgroundColor, 'the later rule should win').toBe('second');
	});

	it('merges non-conflicting style fields from multiple matching rules', () => {
		const style = resolveCellStyle({ col: 5 }, 'col', [
			rule({
				id: 'r1',
				predicate: { columnId: 'col', comparator: 'gte', value: 0 },
				style: { backgroundColor: 'bg' }
			}),
			rule({
				id: 'r2',
				predicate: { columnId: 'col', comparator: 'gte', value: 0 },
				style: { icon: '!' }
			})
		]);
		expect(style).toEqual({ backgroundColor: 'bg', icon: '!' });
	});
});
