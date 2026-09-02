// Tests for the whole-screener validator (T-1009-8). Exercises the public
// entry point, validateScreenerDefinition, against real EPIC-1008 catalog
// items where possible (field.price.close, field.volume, field.market_cap)
// so the tests double as evidence the seeded inventory produces the
// behavior the ticket describes, and a small fixture registry only where
// the built-in inventory has no 'partial' item to exercise AC3's other arm.
import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry, type CatalogRegistry } from '../catalog/registry';
import type { CatalogItem } from '../catalog/types';
import type { Condition } from './conditions';
import type { ConditionNode, FilterNode, GroupNode, ScreenerDefinition } from './definition';
import { emptyUniverse } from './definition';
import type { ScreenerMarketData, SeriesPoint } from './ports';
import {
	DEFAULT_COST_BUDGET_INSTRUMENT_DAYS,
	validateScreenerDefinition,
	type ScreenerValidationOptions
} from './screenerValidation';
import { PROBLEM_CODES } from './validation';

function conditionNode(nodeId: string, condition: Condition, enabled = true): ConditionNode {
	return { nodeId, kind: 'condition', condition, enabled };
}

function group(
	nodeId: string,
	children: FilterNode[],
	op: 'and' | 'or' | 'not' = 'and',
	enabled = true
): GroupNode {
	return { nodeId, kind: 'group', op, children, enabled };
}

function screener(
	filterTree: FilterNode,
	overrides: Partial<ScreenerDefinition> = {}
): ScreenerDefinition {
	return {
		screenerId: 'screener_1',
		workspaceId: 'workspace_1',
		name: 'Test screener',
		revision: 3,
		universe: emptyUniverse(),
		filterTree,
		ranking: null,
		...overrides
	};
}

function scalarGt(fieldId: string, value: number): Condition {
	return { type: 'scalar', fieldId, operator: 'op.greater_than', value, unit: null };
}

function scalarLt(fieldId: string, value: number): Condition {
	return { type: 'scalar', fieldId, operator: 'op.less_than', value, unit: null };
}

function range(fieldId: string, lower: number, upper: number): Condition {
	return { type: 'range', fieldId, lower, upper, lowerInclusive: true, upperInclusive: true };
}

// Overlays a 'partial' field onto the real built-in catalog -- the seeded
// inventory (src/lib/catalog/items.ts) has no 'partial' item, only
// 'available' and 'unavailable', so AC3's advisory arm needs one fixture
// item; every other lookup still resolves through the real registry.
function registryWithPartialField(): CatalogRegistry {
	const partial: CatalogItem = {
		id: 'field.test_partial',
		kind: 'field',
		label: 'Test partial field',
		description: 'A test-only field with partial coverage.',
		aliases: [],
		tags: [],
		valueType: 'number',
		range: { min: 0 },
		nullable: true,
		availability: {
			status: 'partial',
			reason: 'Only covered for a subset of exchanges.',
			requiresReferenceData: false,
			intervalIds: ['interval.1d']
		}
	};
	const byId = new Map(builtinCatalogRegistry.listCatalogItems().map((item) => [item.id, item]));
	byId.set(partial.id, partial);
	const items = Array.from(byId.values());
	return {
		...builtinCatalogRegistry,
		getCatalogItem: (id) => byId.get(id),
		listCatalogItems: (kind) => (kind ? items.filter((item) => item.kind === kind) : items),
		// The built-in isOperatorValidForField reads its own module-private
		// catalog, which knows nothing about `partial` -- reimplement it here
		// against this fixture's own map, same rule as registry.ts's.
		isOperatorValidForField: (operatorId, fieldId) => {
			const operator = byId.get(operatorId);
			const field = byId.get(fieldId);
			if (!operator || operator.kind !== 'operator') {
				return { valid: false, reason: `"${operatorId}" is not a known operator ID.` };
			}
			if (!field || field.kind !== 'field') {
				return { valid: false, reason: `"${fieldId}" is not a known field ID.` };
			}
			if (!operator.operandTypes.includes(field.valueType)) {
				return {
					valid: false,
					reason:
						`Operator "${operator.id}" accepts operands of type ` +
						`${operator.operandTypes.join(', ')}, but field "${field.id}" is of type ` +
						`"${field.valueType}".`
				};
			}
			return { valid: true };
		}
	};
}

function fakeMarketData(resolvedIds: string[]): ScreenerMarketData {
	return {
		resolveUniverse: async () => resolvedIds,
		getFieldValue: async () => null,
		getSeries: async (): Promise<SeriesPoint[]> => [],
		detectPattern: async () => null,
		getStudyOutput: async () => null,
		getProvenance: async () => {
			throw new Error('not used by these tests');
		}
	};
}

describe('validateScreenerDefinition', () => {
	it('test_wellFormedScreener_reportsValid_statingRevision_withNoBlockingProblems', async () => {
		const tree = group('filter_1', [conditionNode('node_1', scalarGt('field.price.close', 100))]);
		const report = await validateScreenerDefinition(screener(tree));
		expect(report.valid, `expected valid, got problems: ${JSON.stringify(report.problems)}`).toBe(
			true
		);
		expect(report.screenerId, 'the screener id must be reported').toBe('screener_1');
		expect(report.screenerRevision, 'the validated revision must be stated').toBe(3);
		expect(
			report.problems.some((p) => p.severity === 'blocking'),
			'a well-formed screener must carry no blocking problems'
		).toBe(false);
		expect(report.detectionExhaustive, 'contradiction detection is never claimed exhaustive').toBe(
			false
		);
		expect(
			report.costEstimate,
			'a cost estimate is always reported, even when not exceeded'
		).not.toBeNull();
	});

	it('test_conditionParameterOutOfRange_delegatesToConditionValidation_asBlocking', async () => {
		// field.volume's declared range is { min: 0 } (items.ts) -- a negative
		// bound is outside it.
		const tree = group('filter_1', [conditionNode('node_1', scalarLt('field.volume', -5))]);
		const report = await validateScreenerDefinition(screener(tree));
		expect(report.valid, 'an out-of-range parameter must block validity').toBe(false);
		const problem = report.problems.find((p) => p.code === PROBLEM_CODES.invalidParameter);
		expect(problem, 'a blocking invalid_parameter problem must be present').toBeDefined();
		expect(problem?.nodeIds, 'the offending node must be named').toEqual(['node_1']);
	});

	it('test_unavailableField_producesBlockingProblem_namingFieldAndUniverse', async () => {
		// field.market_cap is seeded unavailable (no reference-data source).
		const tree = group('filter_1', [conditionNode('node_1', scalarGt('field.market_cap', 1e9))]);
		const s = screener(tree, { universe: { ...emptyUniverse(), assetClass: 'us_equity' } });
		const report = await validateScreenerDefinition(s);
		expect(report.valid, 'an unavailable field must block validity').toBe(false);
		const problem = report.problems.find((p) => p.code === PROBLEM_CODES.unavailableData);
		expect(problem, 'a blocking unavailable_data problem must be present').toBeDefined();
		expect(problem?.severity, 'unavailable data blocks execution').toBe('blocking');
		expect(problem?.message, 'the field must be named').toContain('field.market_cap');
		expect(problem?.universeCriteria, 'the affected part of the universe must be named').toContain(
			'asset_class=us_equity'
		);
	});

	it('test_partiallyAvailableField_producesAdvisoryProblem_notBlocking', async () => {
		const registry = registryWithPartialField();
		const tree = group('filter_1', [conditionNode('node_1', scalarGt('field.test_partial', 1))]);
		const report = await validateScreenerDefinition(screener(tree), { registry });
		const problem = report.problems.find((p) => p.code === PROBLEM_CODES.unavailableData);
		expect(problem, 'a partial-availability problem must be present').toBeDefined();
		expect(problem?.severity, 'partial availability is advisory, not blocking').toBe('advisory');
		expect(problem?.message, 'the message must say coverage is degraded').toMatch(/degrade/i);
		expect(
			report.problems.some((p) => p.severity === 'blocking'),
			'a partial field alone must not block validity'
		).toBe(false);
	});

	it('test_disjointRanges_onSameFieldUnderAnd_producesContradiction_namingBothNodes', async () => {
		const tree = group('filter_1', [
			conditionNode('node_a', range('field.volume', 100, 200)),
			conditionNode('node_b', range('field.volume', 300, 400))
		]);
		const report = await validateScreenerDefinition(screener(tree));
		expect(report.valid, 'a contradiction must block validity').toBe(false);
		const problem = report.problems.find((p) => p.code === PROBLEM_CODES.contradiction);
		expect(problem, 'a contradiction problem must be present').toBeDefined();
		expect(problem?.nodeIds.sort(), 'both conflicting nodes must be named').toEqual([
			'node_a',
			'node_b'
		]);
		expect(problem?.message, 'the explanation must say nothing can satisfy both').toMatch(
			/no value can satisfy both/i
		);
	});

	it('test_mutuallyExclusiveScalarBounds_onSameFieldUnderAnd_producesContradiction', async () => {
		const tree = group('filter_1', [
			conditionNode('node_a', scalarGt('field.volume', 1000)),
			conditionNode('node_b', scalarLt('field.volume', 500))
		]);
		const report = await validateScreenerDefinition(screener(tree));
		const problem = report.problems.find((p) => p.code === PROBLEM_CODES.contradiction);
		expect(
			problem,
			`expected a contradiction problem, got: ${JSON.stringify(report.problems)}`
		).toBeDefined();
	});

	it('test_expensiveScreener_producesNonBlockingAdvisoryWarning_reportingEstimateAndDriver', async () => {
		const tree = group('filter_1', [conditionNode('node_1', scalarGt('field.price.close', 1))]);
		const options: ScreenerValidationOptions = { costBudget: 10 };
		const report = await validateScreenerDefinition(screener(tree), options);
		const problem = report.problems.find((p) => p.code === PROBLEM_CODES.expensiveQuery);
		expect(
			problem,
			'an over-budget estimate must produce an expensive_query problem'
		).toBeDefined();
		expect(problem?.severity, 'cost is never blocking').toBe('advisory');
		expect(
			report.valid,
			'a non-blocking cost warning alone must not make the screener invalid'
		).toBe(true);
		expect(report.costEstimate?.budget, 'the configured budget must be echoed back').toBe(10);
		expect(report.costEstimate?.driver, 'the driver must be named').not.toBe('');
	});

	it('test_defaultBudget_isDocumented_andNotExceededByAModestScreener', async () => {
		const tree = group('filter_1', [conditionNode('node_1', scalarGt('field.price.close', 1))]);
		const report = await validateScreenerDefinition(screener(tree));
		expect(report.costEstimate?.budget, 'the documented default budget is used when unset').toBe(
			DEFAULT_COST_BUDGET_INSTRUMENT_DAYS
		);
		expect(
			report.problems.some((p) => p.code === PROBLEM_CODES.expensiveQuery),
			'the default budget must not flag a modest screener as expensive'
		).toBe(false);
	});

	it('test_universeResolvingToZero_withMarketDataInjected_producesBlockingEmptyUniverse', async () => {
		const tree = group('filter_1', [conditionNode('node_1', scalarGt('field.price.close', 1))]);
		const s = screener(tree, { universe: { ...emptyUniverse(), assetClass: 'us_equity' } });
		const report = await validateScreenerDefinition(s, { marketData: fakeMarketData([]) });
		expect(report.valid, 'an empty universe must block validity').toBe(false);
		const problem = report.problems.find((p) => p.code === PROBLEM_CODES.emptyUniverse);
		expect(problem, 'a blocking empty_universe problem must be present').toBeDefined();
		expect(problem?.universeCriteria, 'the eliminating criteria must be named').toContain(
			'asset_class=us_equity'
		);
	});

	it('test_unresolvableUniverse_withoutMarketData_neverClaimsZero', async () => {
		const tree = group('filter_1', [conditionNode('node_1', scalarGt('field.price.close', 1))]);
		const report = await validateScreenerDefinition(screener(tree));
		expect(
			report.problems.some((p) => p.code === PROBLEM_CODES.emptyUniverse),
			'an unresolvable universe must never be reported as empty'
		).toBe(false);
	});

	it('test_disabledConditionNode_producesNoProblems_andIsSkipped', async () => {
		const tree = group('filter_1', [
			// Unknown field, would otherwise be a blocking problem -- disabled.
			conditionNode('node_bad', scalarGt('field.does_not_exist', 1), false),
			conditionNode('node_good', scalarGt('field.price.close', 1))
		]);
		const report = await validateScreenerDefinition(screener(tree));
		expect(
			report.problems.some((p) => p.nodeIds.includes('node_bad')),
			'a disabled node must produce no problems'
		).toBe(false);
		expect(report.skippedNodeIds, 'the disabled node must be reported as skipped').toContain(
			'node_bad'
		);
	});

	it('test_disabledGroup_skipsItsWholeSubtree', async () => {
		const disabledSubtree = group(
			'group_disabled',
			[
				conditionNode('node_x', scalarGt('field.does_not_exist', 1)),
				conditionNode('node_y', scalarLt('field.volume', -5))
			],
			'and',
			false
		);
		const tree = group('filter_1', [disabledSubtree]);
		const report = await validateScreenerDefinition(screener(tree));
		expect(report.problems, 'nothing inside a disabled group produces a problem').toEqual([]);
		expect(report.skippedNodeIds.sort(), 'the group and every descendant must be skipped').toEqual(
			['group_disabled', 'node_x', 'node_y'].sort()
		);
	});

	it('test_multipleSimultaneousProblems_areAllReported_notJustTheFirst', async () => {
		const tree = group('filter_1', [
			conditionNode('node_bad_param', scalarLt('field.volume', -5)),
			conditionNode('node_unavailable', scalarGt('field.market_cap', 1e9))
		]);
		const s = screener(tree, { universe: { ...emptyUniverse(), assetClass: 'us_equity' } });
		const report = await validateScreenerDefinition(s, { marketData: fakeMarketData([]) });
		const codes = new Set(report.problems.map((p) => p.code));
		expect(
			codes.has(PROBLEM_CODES.invalidParameter),
			'the bad-parameter problem must be present'
		).toBe(true);
		expect(
			codes.has(PROBLEM_CODES.unavailableData),
			'the unavailable-data problem must be present'
		).toBe(true);
		expect(
			codes.has(PROBLEM_CODES.emptyUniverse),
			'the empty-universe problem must be present'
		).toBe(true);
		expect(
			report.problems.length,
			'all independent problems must be reported together'
		).toBeGreaterThanOrEqual(3);
	});

	it('test_validation_mutatesNothing_screenerIsUnchanged', async () => {
		const tree = group('filter_1', [conditionNode('node_1', scalarGt('field.price.close', 1))]);
		const s = screener(tree);
		const before = JSON.parse(JSON.stringify(s));
		await validateScreenerDefinition(s);
		expect(s, 'the screener object passed in must be left byte-for-byte unchanged').toEqual(before);
	});
});
