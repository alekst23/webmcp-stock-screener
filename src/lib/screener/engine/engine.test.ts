import { describe, expect, it } from 'vitest';
import { makeProvenance } from '../../workbench/domain/provenance';
import {
	emptyUniverse,
	type ConditionNode,
	type GroupNode,
	type RankingSpec,
	type ScreenerDefinition
} from '../definition';
import type { ScreenerMarketData } from '../ports';
import { PROBLEM_CODES } from '../validation';
import { createScreenerEngine } from './engine';

interface Fixture {
	closeByInstrument: Record<string, number | null>;
	volumeByInstrument: Record<string, number>;
}

function makeMarketData(fixture: Fixture, universeIds: readonly string[]): ScreenerMarketData {
	return {
		async resolveUniverse() {
			return [...universeIds];
		},
		async getFieldValue(instrumentId, fieldId) {
			if (fieldId === 'field.price.close') return fixture.closeByInstrument[instrumentId] ?? null;
			if (fieldId === 'field.volume') return fixture.volumeByInstrument[instrumentId] ?? null;
			return null;
		},
		async getSeries() {
			return [];
		},
		async detectPattern() {
			return null;
		},
		async getStudyOutput() {
			return null;
		},
		async getProvenance() {
			return makeProvenance({
				asOf: '2024-06-01T00:00:00Z',
				sourceId: 'src.test.fixture',
				sourceLabel: 'Test fixture',
				liveness: 'end_of_day',
				timezone: 'UTC'
			});
		}
	};
}

// root AND [ L1: close > 50, L2 (disabled): market_cap > huge, G1 OR [ L3: volume > 1e6, L4: close < 10 ] ]
function buildFilterTree(l1FieldId = 'field.price.close'): GroupNode {
	const l1: ConditionNode = {
		nodeId: 'filter_l1',
		kind: 'condition',
		enabled: true,
		condition: {
			type: 'scalar',
			fieldId: l1FieldId,
			operator: 'op.greater_than',
			value: 50,
			unit: 'usd'
		}
	};
	const l2: ConditionNode = {
		nodeId: 'filter_l2',
		kind: 'condition',
		enabled: false,
		condition: {
			type: 'scalar',
			fieldId: 'field.market_cap',
			operator: 'op.greater_than',
			value: 999_999_999_999,
			unit: null
		}
	};
	const l3: ConditionNode = {
		nodeId: 'filter_l3',
		kind: 'condition',
		enabled: true,
		condition: {
			type: 'scalar',
			fieldId: 'field.volume',
			operator: 'op.greater_than',
			value: 1_000_000,
			unit: null
		}
	};
	const l4: ConditionNode = {
		nodeId: 'filter_l4',
		kind: 'condition',
		enabled: true,
		condition: {
			type: 'scalar',
			fieldId: 'field.price.close',
			operator: 'op.less_than',
			value: 10,
			unit: null
		}
	};
	const g1: GroupNode = {
		nodeId: 'filter_g1',
		kind: 'group',
		op: 'or',
		enabled: true,
		children: [l3, l4]
	};
	return { nodeId: 'filter_root', kind: 'group', op: 'and', enabled: true, children: [l1, l2, g1] };
}

function buildDefinition(
	ranking: RankingSpec | null = null,
	l1FieldId = 'field.price.close'
): ScreenerDefinition {
	return {
		screenerId: 'screener_1',
		workspaceId: 'workspace_1',
		name: null,
		revision: 1,
		universe: emptyUniverse(),
		filterTree: buildFilterTree(l1FieldId),
		ranking
	};
}

const universeIds = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6'];
const fixture: Fixture = {
	closeByInstrument: { I1: 100, I2: 80, I3: 60, I4: 40, I5: null, I6: 90 },
	volumeByInstrument: {
		I1: 2_000_000,
		I2: 500,
		I3: 3_000_000,
		I4: 5_000_000,
		I5: 1_500_000,
		I6: 4_000_000
	}
};
const fixedNow = () => new Date('2024-06-01T00:00:00Z');

function makeEngine() {
	return createScreenerEngine({ marketData: makeMarketData(fixture, universeIds), now: fixedNow });
}

const descendingCloseRanking: RankingSpec = {
	fields: [{ fieldId: 'field.price.close', direction: 'desc', weight: 1 }],
	tieBreak: null,
	limit: 2,
	normalization: 'percentile_rank'
};

describe('createScreenerEngine execute end-to-end', () => {
	it('test_execute_multiNodeTreeWithRankingAndLimit_returnsTruncatedRankedMatches', async () => {
		const engine = makeEngine();
		const outcome = await engine.execute({
			definition: buildDefinition(descendingCloseRanking),
			runId: 'run_1'
		});
		if (outcome.status !== 'complete') {
			throw new Error(`Expected a complete run, got a refusal: ${JSON.stringify(outcome)}`);
		}
		expect(outcome.universeCount, 'Expected all 6 fixture instruments in the universe').toBe(6);
		expect(outcome.matchedCount, 'Expected I1, I3 and I6 to satisfy the filter tree').toBe(3);
		expect(outcome.returnedCount, 'Expected the limit of 2 to bound the returned matches').toBe(2);
		expect(outcome.truncated, 'returnedCount (2) < matchedCount (3) must report truncated').toBe(
			true
		);
		expect(
			outcome.matches.map((m) => m.instrumentId),
			'Expected descending order by close price, limited to 2'
		).toEqual(['I1', 'I6']);
		expect(outcome.matches[0]?.rank, 'Expected 1-based contiguous ranks').toBe(1);
		expect(outcome.matches[1]?.rank).toBe(2);
	});

	it('test_execute_derivesFullInstrumentRef_fromInstAndUnknownIdsAlike_T0026_3', async () => {
		// This fixture's bare ids ('I1'..'I6') don't parse as this app's own
		// `inst:<MIC>:<SYMBOL>` grammar, so the fallback path is exercised
		// here; a second engine below proves the real-parse path.
		const engine = makeEngine();
		const outcome = await engine.execute({
			definition: buildDefinition(descendingCloseRanking),
			runId: 'run_ref_fallback'
		});
		if (outcome.status !== 'complete') throw new Error('Expected a complete run');
		const match = outcome.matches.find((m) => m.instrumentId === 'I1');
		expect(match, 'Expected I1 among the returned matches').toBeDefined();
		expect(match?.symbol, 'expected symbol to fall back to the bare instrumentId').toBe('I1');
		expect(match?.exchange, 'expected the provisional-unknown-exchange marker').toBe('XUNK');
		expect(match?.assetType, "expected assetType to be assumed 'equity'").toBe('equity');
		expect(match?.name, 'expected name to fall back to symbol').toBe('I1');

		const instEngine = createScreenerEngine({
			marketData: makeMarketData(
				{
					closeByInstrument: { 'inst:XNAS:AAPL': 100 },
					volumeByInstrument: { 'inst:XNAS:AAPL': 2_000_000 }
				},
				['inst:XNAS:AAPL']
			),
			now: fixedNow
		});
		const instOutcome = await instEngine.execute({
			definition: buildDefinition(null),
			runId: 'run_ref_parsed'
		});
		if (instOutcome.status !== 'complete') throw new Error('Expected a complete run');
		const [instMatch] = instOutcome.matches;
		expect(instMatch?.symbol, 'expected symbol parsed from the instrument id').toBe('AAPL');
		expect(instMatch?.exchange, 'expected the MIC parsed from the instrument id').toBe('XNAS');
		expect(instMatch?.assetType, "expected assetType to be assumed 'equity'").toBe('equity');
		expect(instMatch?.name, 'expected name to fall back to the parsed symbol').toBe('AAPL');
	});

	it('test_execute_everyReturnedMatch_hasNodeEvaluationsForEveryEnabledNode_groupsIncluded', async () => {
		const engine = makeEngine();
		const outcome = await engine.execute({
			definition: buildDefinition(descendingCloseRanking),
			runId: 'run_2'
		});
		if (outcome.status !== 'complete') throw new Error('Expected a complete run');
		const match = outcome.matches.find((m) => m.instrumentId === 'I1');
		expect(match, 'Expected I1 among the returned matches').toBeDefined();
		expect(
			Object.keys(match!.nodeEvaluations).sort(),
			'Expected an evaluation for every enabled node (2 groups + 3 enabled leaves), and none for the disabled leaf'
		).toEqual(['filter_g1', 'filter_l1', 'filter_l3', 'filter_l4', 'filter_root'].sort());
		expect(
			match!.nodeEvaluations['filter_l2'],
			'A disabled node must never appear in nodeEvaluations'
		).toBeUndefined();
		expect(
			match!.nodeEvaluations['filter_g1']?.passed,
			"Expected the OR group's own pass/fail recorded"
		).toBe(true);
	});

	it('test_execute_nonReturnedUniverseInstruments_areCapturedInRejectedEvaluations', async () => {
		const engine = makeEngine();
		const outcome = await engine.execute({
			definition: buildDefinition(descendingCloseRanking),
			runId: 'run_rejected'
		});
		if (outcome.status !== 'complete') throw new Error('Expected a complete run');
		// Universe I1..I6; I1,I3,I6 pass the filter tree (matchedCount 3), the
		// ranking limit of 2 returns only I1,I6 -- so I2,I4,I5 (never passed)
		// and I3 (passed but truncated by the ranking limit) must all be
		// explainable via rejectedEvaluations (T-1010-5's engine.ts extension).
		expect(
			Object.keys(outcome.rejectedEvaluations).sort(),
			'Expected every non-returned universe instrument in rejectedEvaluations'
		).toEqual(['I2', 'I3', 'I4', 'I5']);
		expect(
			outcome.rejectedEvaluations.I4?.nodeEvaluations.filter_l1?.passed,
			'A genuinely-failed instrument must carry its real per-node verdicts (I4 close 40 <= 50)'
		).toBe(false);
		expect(
			outcome.rejectedEvaluations.I4?.rankingValues,
			'A genuinely-failed instrument was never ranked, so it has no rankingValues'
		).toBeUndefined();
		expect(
			outcome.rejectedEvaluations.I3?.rankingValues,
			'A matched-but-truncated instrument must carry its rankingValues for peer normalization'
		).toEqual({ 'field.price.close': 60 });
	});

	it('test_execute_unavailableField_marksTheLeafEvaluationDataUnavailable', async () => {
		const engine = makeEngine();
		const outcome = await engine.execute({
			definition: buildDefinition(null),
			runId: 'run_unavail'
		});
		if (outcome.status !== 'complete') throw new Error('Expected a complete run');
		// I5's close price is null (fixture), so filter_l1 (close > 50) must be
		// reported indeterminate, not a plain fail, for explain_result's AC6.
		const i5 = outcome.rejectedEvaluations.I5;
		expect(i5, 'I5 must be present among the rejected/unreturned instruments').toBeDefined();
		expect(
			i5?.nodeEvaluations.filter_l1?.dataUnavailable,
			'filter_l1 must be marked dataUnavailable for I5, distinct from a genuine fail'
		).toBe(true);
	});

	it('test_execute_pinsTheFilterTreeAndRankingSpecOntoTheRun', async () => {
		const engine = makeEngine();
		const definition = buildDefinition(descendingCloseRanking);
		const outcome = await engine.execute({ definition, runId: 'run_pin' });
		if (outcome.status !== 'complete') throw new Error('Expected a complete run');
		expect(outcome.filterTree, 'The run must pin the exact filter tree it evaluated').toEqual(
			definition.filterTree
		);
		expect(outcome.rankingSpec, 'The run must pin the exact ranking spec it evaluated').toEqual(
			descendingCloseRanking
		);
	});

	it('test_execute_fieldUnavailableForOneInstrument_producesWarningNamingTheNode', async () => {
		const engine = makeEngine();
		const outcome = await engine.execute({ definition: buildDefinition(null), runId: 'run_3' });
		if (outcome.status !== 'complete') throw new Error('Expected a complete run');
		const warning = outcome.warnings.find((w) => w.nodeIds?.includes('filter_l1'));
		expect(
			warning,
			`Expected a warning naming filter_l1 for I5's null close: ${JSON.stringify(outcome.warnings)}`
		).toBeDefined();
		expect(warning?.code, 'Expected the unavailable_data PROBLEM_CODES code').toBe(
			PROBLEM_CODES.unavailableData
		);
		expect(
			outcome.matches.some((m) => m.instrumentId === 'I5'),
			'I5 must not be silently included as a pass'
		).toBe(false);
	});

	it('test_execute_blockingValidationProblem_refusesRunWithNoRunId', async () => {
		const engine = makeEngine();
		const outcome = await engine.execute({
			definition: buildDefinition(null, 'field.does_not_exist'),
			runId: 'run_4'
		});
		expect(outcome.status, 'An unknown catalog field must refuse the run').toBe('refused');
		expect('runId' in outcome, 'A refusal must mint no run_id').toBe(false);
		if (outcome.status === 'refused') {
			expect(
				outcome.problems.length > 0,
				'Expected the refusal to carry the blocking problem'
			).toBe(true);
		}
	});

	it('test_execute_repeatedCalls_sameDefinitionAndData_produceIdenticalMatches', async () => {
		const engine = makeEngine();
		const definition = buildDefinition(descendingCloseRanking);
		const first = await engine.execute({ definition, runId: 'run_5' });
		const second = await engine.execute({ definition, runId: 'run_5' });
		expect(
			first.status === 'complete' && second.status === 'complete',
			'Expected both runs to complete'
		).toBe(true);
		if (first.status !== 'complete' || second.status !== 'complete') return;
		expect(
			second.matches.map((m) => ({
				instrumentId: m.instrumentId,
				rank: m.rank,
				compositeScore: m.compositeScore
			})),
			'Repeating execute() over the same revision and data must yield identical matches in identical order (AC7)'
		).toEqual(
			first.matches.map((m) => ({
				instrumentId: m.instrumentId,
				rank: m.rank,
				compositeScore: m.compositeScore
			}))
		);
	});

	it('test_execute_noInstrumentSatisfiesTree_reportsZeroMatchesAsWarningNotError', async () => {
		const impossibleFixture: Fixture = {
			closeByInstrument: { I1: 1, I2: 1 },
			volumeByInstrument: { I1: 1, I2: 1 }
		};
		const engine = createScreenerEngine({
			marketData: makeMarketData(impossibleFixture, ['I1', 'I2']),
			now: fixedNow
		});
		const outcome = await engine.execute({ definition: buildDefinition(null), runId: 'run_6' });
		if (outcome.status !== 'complete')
			throw new Error('A zero-match run is a normal result, not a refusal');
		expect(outcome.matchedCount, 'Expected zero matches when no instrument clears the AND').toBe(0);
		expect(
			outcome.warnings.some((w) => w.code === 'empty_result'),
			`Expected a zero-match warning: ${JSON.stringify(outcome.warnings)}`
		).toBe(true);
	});
});

describe('createScreenerEngine validate', () => {
	it('test_validate_wellFormedDefinition_reportsValidWithNoBlockingProblems', async () => {
		const engine = makeEngine();
		const report = await engine.validate(buildDefinition(null));
		expect(
			report.valid,
			`Expected a well-formed screener to validate: ${JSON.stringify(report)}`
		).toBe(true);
		expect(report.skippedNodeIds, 'Expected the disabled leaf reported as skipped').toContain(
			'filter_l2'
		);
	});
});
