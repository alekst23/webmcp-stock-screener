import { describe, expect, it } from 'vitest';
import { group, leaf, SCALAR_CONDITION } from './explanationTestFixtures';
import { boundFilterTree, boundRankingExplanation } from './explanationBound';
import type { RankingExplanation, RankingFieldContribution } from './explanationRanking';

describe('boundFilterTree', () => {
	it('a tree within the node budget is returned with no truncation marker at all', () => {
		const tree = group('and', [leaf(SCALAR_CONDITION, { nodeId: 'l1' })]);
		const bounded = boundFilterTree(tree, 500);
		if (bounded.kind !== 'group') throw new Error('expected a group node');
		expect(bounded.children.length, 'nothing should be cut when well within budget').toBe(1);
		expect(
			'truncatedChildCount' in bounded,
			'a non-truncated group must not carry the marker field at all, not zero'
		).toBe(false);
	});

	it('a tree exceeding the node budget is cut with an explicit count of what was omitted', () => {
		const children = [0, 1, 2, 3, 4].map((i) => leaf(SCALAR_CONDITION, { nodeId: `l${i}` }));
		const tree = group('and', children, { nodeId: 'root' });
		// budget 3 = root (1) + 2 children retained; the remaining 3 are cut.
		const bounded = boundFilterTree(tree, 3);
		if (bounded.kind !== 'group') throw new Error('expected a group node');
		expect(bounded.children.length, 'only the affordable prefix of children is kept').toBe(2);
		expect(bounded.truncatedChildCount, 'the marker must name exactly how many were omitted').toBe(
			3
		);
	});

	it('a nested tree exceeding budget truncates at the first group that runs out, deeper nodes implied-omitted', () => {
		const inner = group(
			'or',
			[
				leaf(SCALAR_CONDITION, { nodeId: 'inner_1' }),
				leaf(SCALAR_CONDITION, { nodeId: 'inner_2' })
			],
			{
				nodeId: 'inner_group'
			}
		);
		const tree = group('and', [leaf(SCALAR_CONDITION, { nodeId: 'l0' }), inner], {
			nodeId: 'root'
		});
		// budget 2 = root (1) + only l0 (1) fits; inner_group itself is cut.
		const bounded = boundFilterTree(tree, 2);
		if (bounded.kind !== 'group') throw new Error('expected a group node');
		expect(bounded.children.length).toBe(1);
		expect(bounded.truncatedChildCount).toBe(1);
	});
});

describe('boundRankingExplanation', () => {
	function field(fieldId: string): RankingFieldContribution {
		return {
			fieldId,
			rawValue: 1,
			normalizedValue: 1,
			weight: 1,
			direction: 'desc',
			contribution: 1
		};
	}

	it('a ranking within the field budget is returned unchanged, no marker', () => {
		const ranking: RankingExplanation = {
			fields: [field('a'), field('b')],
			normalization: 'percentile_rank',
			compositeScore: 2
		};
		const bounded = boundRankingExplanation(ranking, 50);
		expect(
			'truncatedFieldCount' in bounded,
			'a non-truncated ranking must not carry the marker'
		).toBe(false);
	});

	it('a ranking exceeding the field budget is capped while keeping the true composite score', () => {
		const ranking: RankingExplanation = {
			fields: [field('a'), field('b'), field('c')],
			normalization: 'percentile_rank',
			compositeScore: 3
		};
		const bounded = boundRankingExplanation(ranking, 2);
		expect(bounded.fields.length, 'the itemized list must be capped').toBe(2);
		expect(bounded.truncatedFieldCount, 'the marker must name how many fields were omitted').toBe(
			1
		);
		expect(bounded.compositeScore, 'the total score must stay the true, untruncated value').toBe(3);
	});
});
