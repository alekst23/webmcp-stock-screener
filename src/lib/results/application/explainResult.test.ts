import { describe, expect, it } from 'vitest';
import type { ConditionNode } from '../../screener/definition';
import type { RunNotAvailable } from '../../screener/ports';
import {
	createSpyPinnedRunStore,
	testMatch,
	testPinnedRunStore,
	testRejectedCandidate,
	testRun
} from '../testSupport';
import { explainResult, type InstrumentNotEvaluated } from './explainResult';

function leafNode(nodeId: string): ConditionNode {
	return {
		nodeId,
		kind: 'condition',
		enabled: true,
		condition: {
			type: 'scalar',
			fieldId: 'field.price',
			operator: 'op.greater_than',
			value: 10,
			unit: 'usd'
		}
	};
}

function isNotAvailable(value: unknown): value is RunNotAvailable | InstrumentNotEvaluated {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { available?: unknown }).available === false
	);
}

describe('explainResult', () => {
	it('AC1/AC2/AC3/AC9: a passing (returned) instrument gets a full explanation with rank, provenance and ranking', () => {
		const filterTree = leafNode('l1');
		const match = testMatch(1, {
			instrumentId: 'inst_pass',
			rankingValues: { f: 100 },
			nodeEvaluations: { l1: { nodeId: 'l1', passed: true, value: 20, unit: 'usd' } }
		});
		const run = {
			...testRun('run_1', 0, {
				filterTree,
				rankingSpec: {
					fields: [{ fieldId: 'f', direction: 'desc' as const, weight: 1 }],
					tieBreak: null,
					limit: 10,
					normalization: 'percentile_rank' as const
				}
			}),
			matches: [match]
		};
		const outcome = explainResult(testPinnedRunStore(run), 'run_1', 'inst_pass');
		if (isNotAvailable(outcome))
			throw new Error(`expected a full explanation, got: ${JSON.stringify(outcome)}`);
		expect(outcome.runId, 'the explanation must name the pinned run_id').toBe('run_1');
		expect(outcome.screenerRevision, 'the explanation must name the screener revision').toBe(1);
		expect(outcome.standing).toEqual({ status: 'result', rank: 1 });
		expect(outcome.provenance, "the explanation must carry the run's own provenance").toEqual(
			run.provenance
		);
		if (outcome.filterTree.kind !== 'condition') throw new Error('expected a leaf');
		expect(outcome.filterTree.outcome).toEqual({ status: 'pass' });
		expect(outcome.filterTree.actualValue).toEqual({ value: 20, unit: 'usd' });
		expect(outcome.ranking?.fields[0]?.rawValue, 'AC3: raw value').toBe(100);
		expect(outcome.ranking?.fields[0]?.weight, 'AC3: weight').toBe(1);
		expect(typeof outcome.ranking?.compositeScore, 'AC3: contribution to the final score').toBe(
			'number'
		);
	});

	it('AC4: a rejected instrument gets a full explanation, its failing conditions identified, and no ranking', () => {
		const filterTree = leafNode('l1');
		const rejected = testRejectedCandidate('inst_reject', {
			nodeEvaluations: { l1: { nodeId: 'l1', passed: false, value: 5, unit: 'usd' } }
		});
		const run = {
			...testRun('run_1', 0, { filterTree }),
			rejectedEvaluations: { inst_reject: rejected }
		};
		const outcome = explainResult(testPinnedRunStore(run), 'run_1', 'inst_reject');
		if (isNotAvailable(outcome))
			throw new Error(`expected a full explanation, got: ${JSON.stringify(outcome)}`);
		expect(outcome.standing, "a rejected instrument is not among the run's results").toEqual({
			status: 'rejected',
			rank: null
		});
		expect(outcome.ranking, 'a rejected instrument was never ranked').toBeNull();
		if (outcome.filterTree.kind !== 'condition') throw new Error('expected a leaf');
		expect(outcome.filterTree.outcome, 'the failing condition must be identified').toEqual({
			status: 'fail'
		});
	});

	it('AC6: a condition whose input datum was unavailable is indeterminate, distinct from a fail', () => {
		const filterTree = leafNode('l1');
		const rejected = testRejectedCandidate('inst_unavail', {
			nodeEvaluations: {
				l1: { nodeId: 'l1', passed: false, value: null, dataUnavailable: true, detail: 'feed down' }
			}
		});
		const run = {
			...testRun('run_1', 0, { filterTree }),
			rejectedEvaluations: { inst_unavail: rejected }
		};
		const outcome = explainResult(testPinnedRunStore(run), 'run_1', 'inst_unavail');
		if (isNotAvailable(outcome)) throw new Error('expected a full explanation');
		if (outcome.filterTree.kind !== 'condition') throw new Error('expected a leaf');
		expect(outcome.filterTree.outcome).toEqual({ status: 'indeterminate', reason: 'feed down' });
	});

	it('AC5: an instrument outside the universe produces an explicit, non-fabricated error', () => {
		const run = testRun('run_1', 1);
		const outcome = explainResult(
			testPinnedRunStore(run),
			'run_1',
			'inst_outside'
		) as InstrumentNotEvaluated;
		expect(outcome.available).toBe(false);
		expect(outcome.reason).toBe('not_in_universe');
		expect(outcome.message).toContain('inst_outside');
		expect(outcome.message).toContain('run_1');
	});

	it('AC8: an unknown run_id names the run_id and states the screener must be run again', () => {
		const outcome = explainResult(testPinnedRunStore(), 'run_missing', 'inst_1') as RunNotAvailable;
		expect(outcome.available).toBe(false);
		expect(outcome.message).toContain('run_missing');
		expect(outcome.message.toLowerCase()).toContain('run the screener again');
	});

	it('AC7: reading an explanation never writes to the run store, for a passing, rejected, and expired run', () => {
		const filterTree = leafNode('l1');
		const match = testMatch(1, {
			instrumentId: 'inst_pass',
			nodeEvaluations: { l1: { nodeId: 'l1', passed: true, value: 1, unit: 'usd' } }
		});
		const rejected = testRejectedCandidate('inst_reject', {
			nodeEvaluations: { l1: { nodeId: 'l1', passed: false, value: 1, unit: 'usd' } }
		});
		const run = {
			...testRun('run_1', 0, { filterTree }),
			matches: [match],
			rejectedEvaluations: { inst_reject: rejected }
		};
		const spy = createSpyPinnedRunStore(testPinnedRunStore(run));

		explainResult(spy, 'run_1', 'inst_pass');
		explainResult(spy, 'run_1', 'inst_reject');
		explainResult(spy, 'run_expired', 'inst_pass');

		expect(spy.putRunCalls, 'explaining a result must never write a run back to the store').toBe(0);
	});
});
