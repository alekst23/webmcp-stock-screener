import { describe, expect, it } from 'vitest';
import type { Condition } from '../../screener/conditions';
import { describeConditionOperator, restateCondition } from './explanationRestatement';

const SCALAR_CONDITION: Condition = {
	type: 'scalar',
	fieldId: 'price',
	operator: 'op.greater_than',
	value: 10,
	unit: 'usd'
};

describe('restateCondition and describeConditionOperator', () => {
	it('restates a scalar condition with its operator, value and unit', () => {
		const text = restateCondition(SCALAR_CONDITION);
		expect(text, `expected scalar restatement to name the field, got "${text}"`).toContain('price');
		expect(text).toContain('is greater than');
		expect(text).toContain('10');
		expect(text).toContain('usd');
		expect(describeConditionOperator(SCALAR_CONDITION)).toBe('op.greater_than');
	});

	it('restates a range condition with both bounds and inclusivity brackets', () => {
		const condition: Condition = {
			type: 'range',
			fieldId: 'rsi',
			lower: 40,
			upper: 70,
			lowerInclusive: true,
			upperInclusive: false
		};
		const text = restateCondition(condition);
		expect(text).toContain('rsi');
		expect(text).toContain('[40, 70)');
		expect(describeConditionOperator(condition), 'range has no distinct operator concept').toBe(
			null
		);
	});

	it('restates a series comparison condition naming both series', () => {
		const condition: Condition = {
			type: 'series_comparison',
			left: { catalogId: 'ma50', params: {} },
			right: { catalogId: 'ma200', params: {} },
			operator: 'op.crosses_above'
		};
		const text = restateCondition(condition);
		expect(text).toContain('ma50');
		expect(text).toContain('crosses above');
		expect(text).toContain('ma200');
		expect(describeConditionOperator(condition)).toBe('op.crosses_above');
	});

	it('restates a temporal condition recursing into its inner condition', () => {
		const condition: Condition = {
			type: 'temporal',
			condition: SCALAR_CONDITION,
			event: 'crossed_above',
			withinBars: 5,
			intervalId: 'daily'
		};
		const text = restateCondition(condition);
		expect(text).toContain(restateCondition(SCALAR_CONDITION));
		expect(text).toContain('crossed above');
		expect(text).toContain('5');
		expect(text).toContain('daily');
		expect(describeConditionOperator(condition)).toBe('crossed_above');
	});

	it('restates an event-relative condition with its window and direction', () => {
		const condition: Condition = {
			type: 'event_relative',
			eventTypeId: 'earnings',
			direction: 'past',
			windowDays: 30
		};
		const text = restateCondition(condition);
		expect(text).toContain('earnings');
		expect(text).toContain('30');
		expect(text).toContain('past');
		expect(describeConditionOperator(condition)).toBe('past');
	});

	it('restates a pattern condition with its confidence threshold', () => {
		const condition: Condition = {
			type: 'pattern',
			patternId: 'head_and_shoulders',
			minConfidence: 0.8,
			intervalId: 'daily'
		};
		const text = restateCondition(condition);
		expect(text).toContain('head_and_shoulders');
		expect(text).toContain('0.8');
		expect(describeConditionOperator(condition), 'pattern has no distinct operator concept').toBe(
			null
		);
	});

	it('restates a relative condition with its baseline and multiple', () => {
		const condition: Condition = {
			type: 'relative',
			fieldId: 'volume',
			baseline: { kind: 'own_moving_average', windowBars: 20 },
			multiple: 1.5,
			operator: 'op.greater_than'
		};
		const text = restateCondition(condition);
		expect(text).toContain('volume');
		expect(text).toContain('1.5');
		expect(text).toContain('20-bar moving average');
		expect(describeConditionOperator(condition)).toBe('op.greater_than');
	});

	it('restates a study output condition with its predicate', () => {
		const condition: Condition = {
			type: 'study_output',
			studyId: 'macd',
			params: {},
			outputName: 'histogram',
			predicate: 'positive_and_rising'
		};
		const text = restateCondition(condition);
		expect(text).toContain('macd.histogram');
		expect(text).toContain('positive_and_rising');
		expect(describeConditionOperator(condition)).toBe('positive_and_rising');
	});
});
