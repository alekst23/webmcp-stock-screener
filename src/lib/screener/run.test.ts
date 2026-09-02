import { describe, expect, it } from 'vitest';
import {
	ENGINE_VERSION,
	makeProvenance,
	type MarketDataProvenance
} from '../workbench/domain/provenance';
import { emptyFilterTree } from './definition';
import {
	makeScreenerRun,
	toWireScreenerMatch,
	toWireScreenerRun,
	type RejectedCandidate,
	type ScreenerMatch,
	type ScreenerRun,
	type ScreenerRunOutcome,
	type ScreenerRunRefusal
} from './run';
import type { ValidationProblem } from './validation';

function provenance(): MarketDataProvenance {
	return makeProvenance({
		asOf: '2026-09-02T14:30:00.000Z',
		sourceId: 'src.screener.engine',
		sourceLabel: 'Screener engine',
		liveness: 'end_of_day',
		timezone: 'America/New_York',
		currency: 'USD',
		priceAdjustment: 'adjusted'
	});
}

function match(instrumentId: string, rank: number): ScreenerMatch {
	return {
		instrumentId,
		rank,
		compositeScore: 1 / rank,
		rankingValues: { 'field.price': 100 },
		nodeEvaluations: {
			filter_2: { nodeId: 'filter_2', passed: true, value: 100, unit: 'usd' }
		}
	};
}

function rejectedCandidate(instrumentId: string): RejectedCandidate {
	return {
		instrumentId,
		nodeEvaluations: { filter_2: { nodeId: 'filter_2', passed: false, value: 40, unit: 'usd' } }
	};
}

function validRunInput(
	matches: ScreenerMatch[],
	rejectedEvaluations: Record<string, RejectedCandidate> = {}
): ScreenerRun {
	return {
		runId: 'run_1',
		screenerId: 'screener_1',
		screenerRevision: 3,
		status: 'complete',
		universeCount: 500,
		matchedCount: matches.length,
		returnedCount: matches.length,
		truncated: false,
		rankingApplied: true,
		normalization: 'percentile_rank',
		warnings: [],
		provenance: provenance(),
		matches,
		rejectedEvaluations,
		filterTree: emptyFilterTree('filter_root'),
		rankingSpec: null,
		createdAt: '2026-09-02T14:30:05.000Z'
	};
}

describe('makeScreenerRun', () => {
	it('test_makeScreenerRun_builds_a_valid_run_from_well_formed_input', () => {
		const input = validRunInput([match('inst:XNAS:AAPL', 1), match('inst:XNAS:MSFT', 2)]);
		const run = makeScreenerRun(input);
		expect(run.status, 'a constructed run is always complete').toBe('complete');
		expect(run.matches.length, 'matches must be preserved').toBe(2);
	});

	it('test_makeScreenerRun_accepts_a_run_with_zero_matches', () => {
		// spec.md "Zero matches": a run with nothing matched is a normal result,
		// not an error -- makeScreenerRun must not reject it.
		const input = validRunInput([]);
		const run = makeScreenerRun(input);
		expect(run.matchedCount, 'zero matches is a valid run').toBe(0);
		expect(run.truncated, 'zero matches cannot be truncated').toBe(false);
	});

	it('test_makeScreenerRun_throws_when_returnedCount_does_not_match_matches_length', () => {
		const input = { ...validRunInput([match('inst:XNAS:AAPL', 1)]), returnedCount: 2 };
		expect(
			() => makeScreenerRun(input),
			'returnedCount must equal matches.length or construction must fail'
		).toThrow(/returnedCount/);
	});

	it('test_makeScreenerRun_throws_when_truncated_flag_disagrees_with_counts', () => {
		const input = {
			...validRunInput([match('inst:XNAS:AAPL', 1)]),
			matchedCount: 10,
			truncated: false
		};
		expect(
			() => makeScreenerRun(input),
			'truncated must equal returnedCount < matchedCount'
		).toThrow(/truncated/);
	});

	it('test_makeScreenerRun_throws_when_ranks_are_not_contiguous_from_1', () => {
		const input = validRunInput([match('inst:XNAS:AAPL', 1), match('inst:XNAS:MSFT', 3)]);
		expect(() => makeScreenerRun(input), 'ranks must be contiguous starting at 1').toThrow(
			/ranked contiguously/
		);
	});

	it('test_makeScreenerRun_throws_when_ranks_do_not_start_at_1', () => {
		const input = validRunInput([match('inst:XNAS:AAPL', 2)]);
		expect(() => makeScreenerRun(input), 'the first match must be rank 1').toThrow(
			/ranked contiguously/
		);
	});

	it('test_makeScreenerRun_throws_when_provenance_is_absent', () => {
		// Simulates a deserialized object (e.g. from persisted state or a
		// network boundary) that TypeScript trusts as ScreenerRun but which at
		// runtime never carried provenance -- AC5's "cannot be constructed with
		// provenance missing" must hold even when the type system is bypassed.
		const untyped: unknown = { ...validRunInput([]), provenance: undefined };
		expect(
			() => makeScreenerRun(untyped as ScreenerRun),
			'a run with no provenance must be rejected at construction'
		).toThrow(/provenance/);
	});

	it('test_makeScreenerRun_throws_when_provenance_is_a_partial_object', () => {
		const untyped: unknown = { ...validRunInput([]), provenance: { asOf: '2026-09-02T00:00:00Z' } };
		expect(
			() => makeScreenerRun(untyped as ScreenerRun),
			'a partial provenance object missing required fields must be rejected'
		).toThrow(/provenance/);
	});

	it('test_makeScreenerRun_throws_when_provenance_is_null', () => {
		const untyped: unknown = { ...validRunInput([]), provenance: null };
		expect(
			() => makeScreenerRun(untyped as ScreenerRun),
			'a null provenance must be rejected, not treated as an optional field'
		).toThrow(/provenance/);
	});

	it('test_makeScreenerRun_accepts_rejectedEvaluations_disjoint_from_matches', () => {
		const input = validRunInput([match('inst:XNAS:AAPL', 1)], {
			'inst:XNAS:MSFT': rejectedCandidate('inst:XNAS:MSFT')
		});
		const run = makeScreenerRun(input);
		expect(
			run.rejectedEvaluations['inst:XNAS:MSFT'],
			'a rejected candidate disjoint from matches must be preserved'
		).toBeDefined();
	});

	it('test_makeScreenerRun_throws_when_an_instrument_is_in_both_matches_and_rejectedEvaluations', () => {
		const input = validRunInput([match('inst:XNAS:AAPL', 1)], {
			'inst:XNAS:AAPL': rejectedCandidate('inst:XNAS:AAPL')
		});
		expect(
			() => makeScreenerRun(input),
			'an instrument cannot be both a match and a rejected evaluation'
		).toThrow(/cannot appear in both matches and rejectedEvaluations/);
	});
});

describe('toWireScreenerRun / toWireScreenerMatch', () => {
	it('test_toWireScreenerRun_emits_snake_case_keys_and_delegates_provenance', () => {
		const run = makeScreenerRun(validRunInput([match('inst:XNAS:AAPL', 1)]));
		const wire = toWireScreenerRun(run);
		expect(wire.run_id, 'run_id must be present on the wire').toBe('run_1');
		expect(wire.screener_revision, 'screener_revision must be present on the wire').toBe(3);
		expect(wire.matched_count, 'matched_count must be present on the wire').toBe(1);
		expect(wire.ranking_applied, 'ranking_applied must be present on the wire').toBe(true);
		const wireProvenance = wire.provenance as Record<string, unknown>;
		expect(
			wireProvenance.engine_version,
			'provenance serialization must delegate to toWireProvenance'
		).toBe(ENGINE_VERSION);
		expect(wireProvenance.source_id, 'toWireScreenerRun must not hand-roll provenance fields').toBe(
			'src.screener.engine'
		);
	});

	it('test_toWireScreenerMatch_emits_snake_case_keys_including_node_evaluations', () => {
		const wire = toWireScreenerMatch(match('inst:XNAS:AAPL', 1));
		expect(wire.instrument_id, 'instrument_id must be present').toBe('inst:XNAS:AAPL');
		expect(wire.composite_score, 'composite_score must be present').toBe(1);
		expect(wire.ranking_values, 'ranking_values must be present').toEqual({ 'field.price': 100 });
		const nodeEvaluations = wire.node_evaluations as Record<string, Record<string, unknown>>;
		const evaluation = nodeEvaluations.filter_2;
		expect(evaluation, 'node_evaluations must be keyed by node_id').toBeDefined();
		expect(
			evaluation?.node_id,
			'node_evaluations must be keyed by node_id with node_id preserved inside'
		).toBe('filter_2');
		expect(evaluation?.passed, 'the node evaluation pass/fail must survive').toBe(true);
	});

	it('test_toWireScreenerMatch_emits_dataUnavailable_as_data_unavailable_when_true', () => {
		const wire = toWireScreenerMatch({
			...match('inst:XNAS:AAPL', 1),
			nodeEvaluations: {
				filter_2: { nodeId: 'filter_2', passed: false, value: null, dataUnavailable: true }
			}
		});
		const nodeEvaluations = wire.node_evaluations as Record<string, Record<string, unknown>>;
		expect(
			nodeEvaluations.filter_2?.data_unavailable,
			'a dataUnavailable evaluation must serialize as data_unavailable: true'
		).toBe(true);
	});

	it('test_toWireScreenerRun_emits_rejected_evaluations_keyed_by_instrument_id', () => {
		const run = makeScreenerRun(
			validRunInput([match('inst:XNAS:AAPL', 1)], {
				'inst:XNAS:MSFT': rejectedCandidate('inst:XNAS:MSFT')
			})
		);
		const wire = toWireScreenerRun(run);
		const rejected = wire.rejected_evaluations as Record<string, Record<string, unknown>>;
		expect(
			rejected['inst:XNAS:MSFT'],
			'rejected_evaluations must be keyed by instrument id'
		).toBeDefined();
		expect(
			rejected['inst:XNAS:MSFT']?.instrument_id,
			'a rejected candidate must carry its own instrument_id'
		).toBe('inst:XNAS:MSFT');
	});

	it('test_toWireScreenerRun_matches_array_is_ordered_by_rank', () => {
		const run = makeScreenerRun(
			validRunInput([match('inst:XNAS:AAPL', 1), match('inst:XNAS:MSFT', 2)])
		);
		const wire = toWireScreenerRun(run);
		const matches = wire.matches as Record<string, unknown>[];
		expect(
			matches.map((m) => m.rank),
			'wire matches must preserve rank order'
		).toEqual([1, 2]);
	});
});

describe('ScreenerRunOutcome', () => {
	it('test_ScreenerRunRefusal_carries_no_run_id_and_names_the_blocking_problems', () => {
		const problems: ValidationProblem[] = [
			{
				severity: 'blocking',
				code: 'empty_universe',
				nodeIds: [],
				universeCriteria: ['exchanges'],
				message: 'The universe resolved to zero instruments.'
			}
		];
		const refusal: ScreenerRunRefusal = {
			status: 'refused',
			screenerId: 'screener_1',
			screenerRevision: 2,
			problems
		};
		const outcome: ScreenerRunOutcome = refusal;
		expect(outcome.status, 'a refusal reports status: refused').toBe('refused');
		expect(
			'runId' in outcome,
			'a refusal must carry no runId field -- refusing a run mints no run_id'
		).toBe(false);
		if (outcome.status === 'refused') {
			expect(outcome.problems, 'the refusal must carry the blocking problems').toEqual(problems);
		}
	});

	it('test_ScreenerRunOutcome_discriminates_on_status_between_complete_and_refused', () => {
		const complete: ScreenerRunOutcome = makeScreenerRun(validRunInput([]));
		expect(complete.status, 'a constructed run reports status: complete').toBe('complete');
		if (complete.status === 'complete') {
			expect(complete.matches, 'a complete outcome carries matches').toEqual([]);
		}
	});
});
