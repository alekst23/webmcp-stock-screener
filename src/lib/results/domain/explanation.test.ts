import { describe, expect, it } from 'vitest';
import type { GroupOp } from '../../screener/definition';
import {
	failOutcome,
	indeterminateOutcome,
	makeResultExplanation,
	passOutcome,
	rejectedStanding,
	resolveGroupOutcome,
	type ConditionOutcome
} from './explanation';
import type { RankingExplanation } from './explanationRanking';
import { SCALAR_CONDITION, baseExplanation, group, leaf } from './explanationTestFixtures';

const PASS = passOutcome();
const FAIL = failOutcome();
const INDETERMINATE = indeterminateOutcome('missing input datum');

describe('resolveGroupOutcome', () => {
	it.each<[GroupOp, ConditionOutcome[], ConditionOutcome]>([
		['and', [PASS, PASS], PASS],
		['and', [PASS, FAIL], FAIL],
		['and', [PASS, INDETERMINATE], INDETERMINATE],
		['and', [FAIL, INDETERMINATE], FAIL],
		['or', [FAIL, FAIL], FAIL],
		['or', [FAIL, PASS], PASS],
		['or', [FAIL, INDETERMINATE], INDETERMINATE],
		['or', [PASS, INDETERMINATE], PASS],
		['not', [PASS], FAIL],
		['not', [FAIL], PASS],
		['not', [INDETERMINATE], INDETERMINATE]
	])('%s over %j resolves to %j', (op, children, expected) => {
		const result = resolveGroupOutcome(op, children);
		expect(
			result.status,
			`expected ${op}(${JSON.stringify(children)}) to be ${expected.status}`
		).toBe(expected.status);
	});

	it('is vacuously pass for zero enabled children, matching every op', () => {
		for (const op of ['and', 'or', 'not'] as GroupOp[]) {
			const result = resolveGroupOutcome(op, []);
			expect(result.status, `expected empty ${op} group to vacuously pass`).toBe('pass');
		}
	});

	it('agrees with plain boolean logic when no child is indeterminate', () => {
		expect(resolveGroupOutcome('and', [PASS, PASS, PASS]).status).toBe('pass');
		expect(resolveGroupOutcome('and', [PASS, FAIL, PASS]).status).toBe('fail');
		expect(resolveGroupOutcome('or', [FAIL, FAIL, PASS]).status).toBe('pass');
		expect(resolveGroupOutcome('or', [FAIL, FAIL, FAIL]).status).toBe('fail');
	});

	it('joins multiple indeterminate reasons rather than dropping any', () => {
		const outcome = resolveGroupOutcome('and', [
			indeterminateOutcome('reason A'),
			indeterminateOutcome('reason B')
		]);
		expect(outcome.status, 'expected group of two indeterminates to stay indeterminate').toBe(
			'indeterminate'
		);
		if (outcome.status === 'indeterminate') {
			expect(outcome.reason, `expected both reasons to survive, got "${outcome.reason}"`).toContain(
				'reason A'
			);
			expect(outcome.reason).toContain('reason B');
		}
	});
});

describe('makeResultExplanation', () => {
	it('accepts a well-formed explanation unchanged', () => {
		const explanation = baseExplanation();
		expect(makeResultExplanation(explanation)).toBe(explanation);
	});

	it('accepts a disabled leaf marked as not contributing (AC6)', () => {
		const disabledLeaf = leaf(SCALAR_CONDITION, {
			enabled: false,
			outcome: null,
			actualValue: null
		});
		expect(() =>
			makeResultExplanation(baseExplanation({ filterTree: disabledLeaf }))
		).not.toThrow();
	});

	it('throws when a disabled leaf carries an outcome anyway', () => {
		const disabledLeaf = leaf(SCALAR_CONDITION, { enabled: false, actualValue: null });
		// outcome left as PASS from leaf()'s default -- the mutation this
		// guard exists to catch.
		expect(() => makeResultExplanation(baseExplanation({ filterTree: disabledLeaf }))).toThrow(
			/disabled node/
		);
	});

	it('throws when a disabled leaf carries an actual value anyway', () => {
		const disabledLeaf = leaf(SCALAR_CONDITION, { enabled: false, outcome: null });
		expect(() => makeResultExplanation(baseExplanation({ filterTree: disabledLeaf }))).toThrow(
			/actual value/
		);
	});

	it('throws when an enabled leaf carries no outcome', () => {
		const badLeaf = leaf(SCALAR_CONDITION, { outcome: null });
		expect(() => makeResultExplanation(baseExplanation({ filterTree: badLeaf }))).toThrow(
			/must carry an outcome/
		);
	});

	it('recurses the invariant into nested groups (AC3)', () => {
		const badLeaf = leaf(SCALAR_CONDITION, { nodeId: 'filter_2', enabled: false, outcome: FAIL });
		const nested = group('and', [leaf(SCALAR_CONDITION)]);
		const outer = group('or', [nested, badLeaf]);
		expect(() => makeResultExplanation(baseExplanation({ filterTree: outer }))).toThrow(
			/disabled node/
		);
	});

	it('throws when a rejected instrument carries a ranking', () => {
		const ranking: RankingExplanation = {
			fields: [],
			normalization: 'percentile_rank',
			compositeScore: 0
		};
		expect(() =>
			makeResultExplanation(baseExplanation({ standing: rejectedStanding(), ranking }))
		).toThrow(/never ranked/);
	});

	it('throws when compositeScore is inconsistent with its contributions', () => {
		const ranking: RankingExplanation = {
			fields: [
				{
					fieldId: 'momentum',
					rawValue: 10,
					normalizedValue: 1,
					weight: 2,
					direction: 'desc',
					contribution: 2
				}
			],
			normalization: 'percentile_rank',
			compositeScore: 999 // deliberately wrong -- should be 2
		};
		expect(() => makeResultExplanation(baseExplanation({ ranking }))).toThrow(
			/ranking contributions sum to/
		);
	});

	it('accepts a self-consistent ranking', () => {
		const ranking: RankingExplanation = {
			fields: [
				{
					fieldId: 'momentum',
					rawValue: 10,
					normalizedValue: 1,
					weight: 2,
					direction: 'desc',
					contribution: 2
				},
				{
					fieldId: 'volatility',
					rawValue: null,
					normalizedValue: null,
					weight: 1,
					direction: 'asc',
					contribution: null
				}
			],
			normalization: 'percentile_rank',
			compositeScore: 2
		};
		expect(() => makeResultExplanation(baseExplanation({ ranking }))).not.toThrow();
	});

	it('throws when a result standing carries a non-integer rank', () => {
		expect(() =>
			makeResultExplanation(baseExplanation({ standing: { status: 'result', rank: 1.5 } }))
		).toThrow(/positive integer/);
	});
});
