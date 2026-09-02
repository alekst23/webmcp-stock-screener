import { describe, expect, it } from 'vitest';
import { createIdSequencer } from '../workbench/domain/ids';
import {
	createScreener,
	emptyFilterTree,
	isNotArityValid,
	normalizeScreener,
	type ConditionNode,
	type FilterNode,
	type GroupNode,
	type GroupOp,
	type ScreenerDefinition
} from './definition';

function group(nodeId: string, op: GroupOp, children: FilterNode[]): GroupNode {
	return { nodeId, kind: 'group', op, children, enabled: true };
}

describe('createScreener', () => {
	it('test_createScreener_mints_stable_screener_and_root_node_ids', () => {
		const ids = createIdSequencer();
		const screener = createScreener(ids, 'workspace_1', 'My Screener');
		expect(screener.screenerId, 'screener ID must follow the ids.ts screener kind').toBe(
			'screener_1'
		);
		const root = screener.filterTree as GroupNode;
		expect(root.nodeId, 'root node ID must follow the ids.ts filter kind').toBe('filter_1');
	});

	it('test_createScreener_starts_at_revision_1_with_empty_tree_and_default_universe', () => {
		const screener = createScreener(createIdSequencer(), 'workspace_1', null);
		expect(screener.revision, 'a new screener starts at revision 1').toBe(1);
		expect(screener.name, 'no name supplied means null, not empty string').toBeNull();
		expect(screener.ranking, 'a new screener has no ranking').toBeNull();
		const root = screener.filterTree as GroupNode;
		expect(root.kind, 'root must be a group').toBe('group');
		expect(root.children, 'a fresh screener has an empty filter tree').toEqual([]);
		expect(screener.universe.assetClass, 'a fresh universe has no asset class set').toBe('');
	});

	it('test_createScreener_ids_never_collide_across_repeated_calls_on_one_sequencer', () => {
		const ids = createIdSequencer();
		const screeners = Array.from({ length: 5 }, () => createScreener(ids, 'workspace_1', null));
		const screenerIds = screeners.map((s) => s.screenerId);
		const rootNodeIds = screeners.map((s) => (s.filterTree as GroupNode).nodeId);
		expect(
			new Set(screenerIds).size,
			`screener IDs must all be unique: ${JSON.stringify(screenerIds)}`
		).toBe(screenerIds.length);
		expect(
			new Set(rootNodeIds).size,
			`root node IDs must all be unique: ${JSON.stringify(rootNodeIds)}`
		).toBe(rootNodeIds.length);
	});

	it('test_createScreener_never_reuses_a_retired_id_even_after_more_minting', () => {
		// Simulates AC6: a node ID retired by removal is never handed to a
		// later resource, because the sequencer's counter only ever advances.
		const ids = createIdSequencer();
		const first = createScreener(ids, 'workspace_1', null);
		const retiredNodeId = (first.filterTree as GroupNode).nodeId;
		const laterIds = Array.from({ length: 10 }, () => ids.next('filter'));
		expect(
			laterIds,
			'no later-minted filter node ID may equal a previously retired one'
		).not.toContain(retiredNodeId);
	});
});

describe('isNotArityValid', () => {
	const child: ConditionNode = {
		nodeId: 'filter_2',
		kind: 'condition',
		condition: { type: 'scalar', fieldId: 'field.price', operator: 'op.gt', value: 1, unit: null },
		enabled: true
	};

	it('test_isNotArityValid_true_for_non_not_groups_regardless_of_child_count', () => {
		expect(
			isNotArityValid(group('filter_1', 'and', [])),
			'and groups have no arity restriction'
		).toBe(true);
	});

	it('test_isNotArityValid_true_only_for_not_with_exactly_one_child', () => {
		expect(isNotArityValid(group('filter_1', 'not', [])), 'not with zero children is invalid').toBe(
			false
		);
		expect(
			isNotArityValid(group('filter_1', 'not', [child])),
			'not with exactly one child is valid'
		).toBe(true);
		expect(
			isNotArityValid(group('filter_1', 'not', [child, child])),
			'not with two children is invalid'
		).toBe(false);
	});
});

describe('normalizeScreener', () => {
	function condition(fieldId: string): ConditionNode {
		return {
			nodeId: `filter_${fieldId}`,
			kind: 'condition',
			condition: { type: 'scalar', fieldId, operator: 'op.gt', value: 1, unit: null },
			enabled: true
		};
	}

	it('test_normalizeScreener_arbitrary_nesting_survives_four_levels_deep', () => {
		const deep: ScreenerDefinition = {
			screenerId: 'screener_1',
			workspaceId: 'workspace_1',
			name: null,
			revision: 1,
			universe: normalizeScreener({}).universe,
			filterTree: {
				nodeId: 'filter_1',
				kind: 'group',
				op: 'and',
				enabled: true,
				children: [
					{
						nodeId: 'filter_2',
						kind: 'group',
						op: 'or',
						enabled: true,
						children: [
							{
								nodeId: 'filter_3',
								kind: 'group',
								op: 'not',
								enabled: true,
								children: [
									{
										nodeId: 'filter_4',
										kind: 'group',
										op: 'and',
										enabled: true,
										children: [condition('a'), condition('b')]
									}
								]
							}
						]
					}
				]
			},
			ranking: null
		};
		const normalized = normalizeScreener(JSON.parse(JSON.stringify(deep)));
		expect(normalized, 'a valid four-level-deep nested tree must survive unchanged').toEqual(deep);
	});

	it('test_normalizeScreener_not_group_with_two_children_keeps_only_the_first', () => {
		const raw = {
			screenerId: 'screener_1',
			workspaceId: 'workspace_1',
			name: null,
			revision: 1,
			universe: {},
			filterTree: {
				nodeId: 'filter_1',
				kind: 'group',
				op: 'not',
				enabled: true,
				children: [condition('a'), condition('b')]
			},
			ranking: null
		};
		const normalized = normalizeScreener(raw);
		const root = normalized.filterTree as GroupNode;
		expect(root.op, 'not arity repair must keep the op when a child remains').toBe('not');
		expect(root.children.length, 'a not group must be repaired down to exactly one child').toBe(1);
		expect(
			(root.children[0] as ConditionNode).nodeId,
			'the surviving child must be the first one, in original order'
		).toBe('filter_a');
	});

	it('test_normalizeScreener_not_group_with_zero_children_repairs_op_instead_of_dropping_node', () => {
		const raw = {
			screenerId: 'screener_1',
			workspaceId: 'workspace_1',
			name: null,
			revision: 1,
			universe: {},
			filterTree: { nodeId: 'filter_1', kind: 'group', op: 'not', enabled: true, children: [] },
			ranking: null
		};
		const normalized = normalizeScreener(raw);
		const root = normalized.filterTree as GroupNode;
		expect(root.nodeId, 'the node ID must be preserved even when the op is repaired').toBe(
			'filter_1'
		);
		expect(root.op, 'a childless not group has no valid arity, so it repairs to and').toBe('and');
		expect(root.children, 'still zero children after repair').toEqual([]);
	});

	it.each([undefined, null, 42, 'a string', [1, 2, 3], true, {}])(
		'test_normalizeScreener_never_throws_on_corrupt_input_%#',
		(input) => {
			expect(
				() => normalizeScreener(input),
				`input ${JSON.stringify(input)} must not throw`
			).not.toThrow();
			const normalized = normalizeScreener(input);
			expect(normalized.screenerId, 'corrupt input still produces a well-typed screener').toEqual(
				expect.any(String)
			);
			expect(
				(normalized.filterTree as GroupNode).kind,
				'corrupt input falls back to a group root'
			).toBe('group');
		}
	);

	it('test_normalizeScreener_drops_malformed_children_but_keeps_valid_siblings', () => {
		const raw = {
			screenerId: 'screener_1',
			workspaceId: 'workspace_1',
			name: null,
			revision: 1,
			universe: {},
			filterTree: {
				nodeId: 'filter_1',
				kind: 'group',
				op: 'and',
				enabled: true,
				children: [
					condition('a'),
					{ kind: 'condition', condition: { type: 'scalar' } }, // missing nodeId
					{ nodeId: 'filter_bad', kind: 'condition', condition: { type: 'not_a_family' } },
					'not even an object',
					condition('b')
				]
			},
			ranking: null
		};
		const normalized = normalizeScreener(raw);
		const root = normalized.filterTree as GroupNode;
		const survivingIds = root.children.map((c) => c.nodeId);
		expect(survivingIds, 'only the two structurally valid conditions survive').toEqual([
			'filter_a',
			'filter_b'
		]);
	});

	it('test_normalizeScreener_unknown_group_op_coerces_to_and', () => {
		const raw = {
			filterTree: { nodeId: 'filter_1', kind: 'group', op: 'xor', enabled: true, children: [] }
		};
		const normalized = normalizeScreener(raw);
		expect(
			(normalized.filterTree as GroupNode).op,
			'an unrecognized group operator must coerce to the safe default "and"'
		).toBe('and');
	});

	it('test_normalizeScreener_preserves_enabled_flags_and_order', () => {
		const raw = {
			screenerId: 'screener_1',
			workspaceId: 'workspace_1',
			name: null,
			revision: 1,
			universe: {},
			filterTree: {
				nodeId: 'filter_1',
				kind: 'group',
				op: 'and',
				enabled: true,
				children: [
					{ ...condition('a'), enabled: false },
					{ ...condition('b'), enabled: true },
					{ ...condition('c'), enabled: false }
				]
			},
			ranking: null
		};
		const normalized = normalizeScreener(raw);
		const root = normalized.filterTree as GroupNode;
		expect(
			root.children.map((c) => [c.nodeId, c.enabled]),
			'enabled flags and child order must be preserved exactly'
		).toEqual([
			['filter_a', false],
			['filter_b', true],
			['filter_c', false]
		]);
	});

	it('test_normalizeScreener_round_trips_a_representative_screener_through_json', () => {
		const original: ScreenerDefinition = {
			screenerId: 'screener_1',
			workspaceId: 'workspace_1',
			name: 'RSI oversold reversal',
			revision: 3,
			universe: {
				assetClass: 'equity',
				exchanges: ['exchange.nasdaq'],
				countries: ['country.us'],
				sectors: ['sector.tech'],
				industries: ['industry.software'],
				indexes: ['index.sp500'],
				watchlists: ['watchlist_1'],
				liquidity: { minPrice: 5, minAverageVolume: 1000000, minMarketCap: 1e9 },
				exclusions: { instrumentIds: ['inst_1'], sectorIds: ['sector.energy'], industryIds: [] }
			},
			filterTree: {
				nodeId: 'filter_1',
				kind: 'group',
				op: 'and',
				enabled: true,
				children: [
					{
						nodeId: 'filter_2',
						kind: 'condition',
						enabled: true,
						condition: {
							type: 'range',
							fieldId: 'field.rsi',
							lower: 20,
							upper: 30,
							lowerInclusive: true,
							upperInclusive: false
						}
					},
					{
						nodeId: 'filter_3',
						kind: 'group',
						op: 'or',
						enabled: true,
						children: [
							{
								nodeId: 'filter_4',
								kind: 'condition',
								enabled: false,
								condition: {
									type: 'pattern',
									patternId: 'pattern.bull_flag',
									minConfidence: 0.6,
									intervalId: 'interval.1d'
								}
							},
							{
								nodeId: 'filter_5',
								kind: 'group',
								op: 'not',
								enabled: true,
								children: [
									{
										nodeId: 'filter_6',
										kind: 'condition',
										enabled: true,
										condition: {
											type: 'event_relative',
											eventTypeId: 'event.earnings',
											direction: 'future',
											windowDays: 14
										}
									}
								]
							}
						]
					}
				]
			},
			ranking: {
				fields: [{ fieldId: 'field.rsi', direction: 'asc', weight: 1 }],
				tieBreak: { fieldId: 'field.volume', direction: 'desc' },
				limit: 50,
				normalization: 'percentile_rank'
			}
		};
		const roundTripped = normalizeScreener(JSON.parse(JSON.stringify(original)));
		expect(
			roundTripped,
			'a representative screener must round-trip through JSON unchanged'
		).toEqual(original);
	});
});

describe('emptyFilterTree', () => {
	it('test_emptyFilterTree_returns_an_and_group_with_the_given_node_id', () => {
		const root = emptyFilterTree('filter_7');
		expect(root.nodeId, 'the supplied node ID must be used as-is').toBe('filter_7');
		expect(root.op, 'an empty root defaults to and').toBe('and');
		expect(root.children, 'an empty root has no children').toEqual([]);
	});
});
