import { describe, expect, it } from 'vitest';
import type { ConditionNode, GroupNode, RankingSpec } from '../../screener/definition';
import type { FilterNodeEvaluation, ScreenerRun } from '../../screener/run';
import { testRun } from '../testSupport';
import { assembleFilterTree, assembleRanking } from './explanationAssembly';

function scalarLeaf(nodeId: string, enabled = true): ConditionNode {
	return {
		nodeId,
		kind: 'condition',
		enabled,
		condition: {
			type: 'scalar',
			fieldId: 'field.price',
			operator: 'op.greater_than',
			value: 10,
			unit: 'usd'
		}
	};
}

describe('assembleFilterTree', () => {
	it('a disabled leaf carries no actualValue or outcome', () => {
		const explanation = assembleFilterTree(scalarLeaf('l1', false), {});
		expect(explanation.enabled, 'a disabled leaf must be marked disabled').toBe(false);
		if (explanation.kind !== 'condition') throw new Error('expected a condition node');
		expect(explanation.actualValue, 'a disabled leaf must not carry a value').toBeNull();
		expect(explanation.outcome, 'a disabled leaf must not carry an outcome').toBeNull();
	});

	it('a leaf nested inside a disabled group is effectively disabled despite its own enabled flag', () => {
		const leaf = scalarLeaf('l1', true);
		const group: GroupNode = {
			nodeId: 'g1',
			kind: 'group',
			op: 'and',
			enabled: false,
			children: [leaf]
		};
		const evaluations: Record<string, FilterNodeEvaluation> = {
			l1: { nodeId: 'l1', passed: true, value: 20, unit: 'usd' }
		};
		const explanation = assembleFilterTree(group, evaluations);
		if (explanation.kind !== 'group') throw new Error('expected a group node');
		expect(explanation.enabled, 'a disabled group must be marked disabled').toBe(false);
		expect(
			explanation.children[0]?.enabled,
			"a disabled group's child must be effectively disabled too, even though its own FilterNode.enabled is true"
		).toBe(false);
		expect(
			explanation.children[0]?.outcome,
			"the child's outcome must not be fabricated"
		).toBeNull();
	});

	it('an AND group fails when one child genuinely fails, even if another is indeterminate', () => {
		const l1 = scalarLeaf('l1');
		const l2 = scalarLeaf('l2');
		const group: GroupNode = {
			nodeId: 'g1',
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [l1, l2]
		};
		const evaluations: Record<string, FilterNodeEvaluation> = {
			l1: {
				nodeId: 'l1',
				passed: false,
				value: null,
				dataUnavailable: true,
				detail: 'missing input'
			},
			l2: { nodeId: 'l2', passed: false, value: 5, unit: 'usd' }
		};
		const explanation = assembleFilterTree(group, evaluations);
		expect(
			explanation.outcome,
			'AND fails on any genuine fail, regardless of other indeterminates'
		).toEqual({
			status: 'fail'
		});
	});

	it("an OR group with an indeterminate child and no pass resolves to indeterminate, not the engine's boolean fail", () => {
		const l1 = scalarLeaf('l1');
		const l2 = scalarLeaf('l2');
		const group: GroupNode = {
			nodeId: 'g1',
			kind: 'group',
			op: 'or',
			enabled: true,
			children: [l1, l2]
		};
		const evaluations: Record<string, FilterNodeEvaluation> = {
			l1: {
				nodeId: 'l1',
				passed: false,
				value: null,
				dataUnavailable: true,
				detail: 'missing input'
			},
			l2: { nodeId: 'l2', passed: false, value: 5, unit: 'usd' }
		};
		const explanation = assembleFilterTree(group, evaluations);
		expect(
			explanation.outcome,
			"the group must recompute via resolveGroupOutcome, not trust tree.ts's boolean combine()"
		).toEqual({ status: 'indeterminate', reason: 'missing input' });
	});

	it('a data-unavailable leaf reports indeterminate with its detail as the reason, distinct from a fail', () => {
		const evaluations: Record<string, FilterNodeEvaluation> = {
			l1: {
				nodeId: 'l1',
				passed: false,
				value: null,
				dataUnavailable: true,
				detail: 'price feed down'
			}
		};
		const explanation = assembleFilterTree(scalarLeaf('l1'), evaluations);
		expect(explanation.outcome).toEqual({ status: 'indeterminate', reason: 'price feed down' });
	});

	it('a leaf missing its evaluation entirely reports indeterminate rather than fabricating pass/fail', () => {
		const explanation = assembleFilterTree(scalarLeaf('l1'), {});
		expect(
			explanation.outcome?.status,
			'a missing evaluation must never be silently treated as pass'
		).toBe('indeterminate');
	});
});

describe('assembleRanking', () => {
	function withRun(
		overrides: Partial<Omit<ScreenerRun, 'matches'>>,
		matches: ScreenerRun['matches']
	) {
		return { ...testRun('run_x', 0, overrides), matches };
	}

	it('reconstructs the full matched-set peer distribution, including truncated-but-matched candidates', () => {
		const rankingSpec: RankingSpec = {
			fields: [{ fieldId: 'f', direction: 'desc', weight: 1 }],
			tieBreak: null,
			limit: 2,
			normalization: 'percentile_rank'
		};
		const run = withRun(
			{
				rankingSpec,
				rejectedEvaluations: {
					inst_3: { instrumentId: 'inst_3', nodeEvaluations: {}, rankingValues: { f: 0 } }
				}
			},
			[
				{
					instrumentId: 'inst_1',
					rank: 1,
					compositeScore: null,
					rankingValues: { f: 100 },
					nodeEvaluations: {}
				},
				{
					instrumentId: 'inst_2',
					rank: 2,
					compositeScore: null,
					rankingValues: { f: 50 },
					nodeEvaluations: {}
				}
			]
		);
		const ranking = assembleRanking(run, { f: 100 });
		expect(ranking, 'a ranking-configured run must produce a RankingExplanation').not.toBeNull();
		// peer set is [100, 50, 0] (the returned matches plus the truncated
		// rejected candidate) -- if the rejected candidate's value were
		// dropped, the peer set would only be [100, 50] and this percentile
		// would come out different.
		const expectedNormalized = (2 + 0.5) / 3;
		expect(ranking?.fields[0]?.normalizedValue).toBeCloseTo(expectedNormalized, 10);
	});

	it('omits an unavailable raw value from both the contribution and the peer set', () => {
		const rankingSpec: RankingSpec = {
			fields: [{ fieldId: 'f', direction: 'desc', weight: 1 }],
			tieBreak: null,
			limit: 10,
			normalization: 'percentile_rank'
		};
		const run = withRun({ rankingSpec }, [
			{
				instrumentId: 'inst_1',
				rank: 1,
				compositeScore: null,
				rankingValues: { f: null },
				nodeEvaluations: {}
			}
		]);
		const ranking = assembleRanking(run, { f: null });
		expect(
			ranking?.fields[0]?.rawValue,
			'an unavailable raw value must stay null, not fabricated'
		).toBeNull();
		expect(ranking?.fields[0]?.contribution, 'an unavailable field contributes nothing').toBeNull();
	});

	it('returns null when the run had no ranking configured', () => {
		const run = withRun({ rankingSpec: null }, []);
		expect(assembleRanking(run, {})).toBeNull();
	});
});
