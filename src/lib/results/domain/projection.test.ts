// Tests for T-1010-4's projection arithmetic (domain/projection.ts):
// expression evaluation, column/sort/group value resolution, and the
// default-config fallback. The use-case-level orchestration (paging, cursor,
// no-rerun) is covered by application/getScreenerResults.test.ts.
import { describe, expect, it } from 'vitest';
import type { ScreenerMatch, ScreenerRun } from '../../screener/run';
import { testMatch, testProvenance, testRun } from '../testSupport';
import { parseExpression, type ResultsTableConfig } from './tableConfig';
import {
	defaultResultsTableConfig,
	evaluateExpression,
	projectResultRows,
	toWireProjectedResultsPage,
	toWireProjectedRow,
	type ProjectedResultsPage
} from './projection';

function ast(source: string) {
	const parsed = parseExpression(source);
	if (!parsed.ok) {
		throw new Error(`test fixture expression "${source}" failed to parse: ${parsed.error}`);
	}
	return parsed.ast;
}

function config(overrides: Partial<ResultsTableConfig> = {}): ResultsTableConfig {
	return { ...defaultResultsTableConfig(), ...overrides };
}

// testRun's own overrides type deliberately excludes `matches` (it always
// derives a plausible match list from matchCount) -- these tests need
// specific rankingValues per match, so this helper overrides `matches` on
// the already-built plain object instead of through testRun's parameters.
function runWithMatches(runId: string, matches: ScreenerMatch[]): ScreenerRun {
	return { ...testRun(runId, matches.length), matches };
}

describe('evaluateExpression', () => {
	function field(values: Record<string, number | null>) {
		return (fieldId: string) => values[fieldId] ?? null;
	}

	it('evaluates a simple field reference', () => {
		const result = evaluateExpression(ast('field.volume'), field({ 'field.volume': 100 }));
		expect(result, 'expected the field value verbatim').toBe(100);
	});

	it('evaluates arithmetic over two fields', () => {
		const result = evaluateExpression(
			ast('field.volume / field.avg_volume'),
			field({ 'field.volume': 200, 'field.avg_volume': 100 })
		);
		expect(result, 'expected 200 / 100').toBe(2);
	});

	it('propagates null rather than fabricating a value when a field is missing', () => {
		const result = evaluateExpression(ast('field.volume + 1'), field({}));
		expect(result, 'a missing field must make the whole expression null').toBeNull();
	});

	it('returns null for division by zero instead of Infinity', () => {
		const result = evaluateExpression(
			ast('field.volume / field.zero'),
			field({ 'field.volume': 10, 'field.zero': 0 })
		);
		expect(result, 'division by zero must be null, not Infinity').toBeNull();
	});

	it('returns null for modulo by zero', () => {
		const result = evaluateExpression(
			ast('field.volume % field.zero'),
			field({ 'field.volume': 10, 'field.zero': 0 })
		);
		expect(result, 'modulo by zero must be null').toBeNull();
	});

	it.each([
		['abs(field.x)', { 'field.x': -5 }, 5],
		['sqrt(field.x)', { 'field.x': 9 }, 3],
		['round(field.x)', { 'field.x': 2.6 }, 3],
		['max(field.x, 10)', { 'field.x': 3 }, 10],
		['min(field.x, 10)', { 'field.x': 3 }, 3],
		['sum(field.x, 10)', { 'field.x': 3 }, 13],
		['avg(field.x, 10)', { 'field.x': 0 }, 5]
	])('evaluates permitted function %s', (source, values, expected) => {
		const result = evaluateExpression(ast(source), field(values));
		expect(result, `expected ${source} to evaluate to ${expected}`).toBeCloseTo(expected as number);
	});

	it('returns null for ln/log of a non-positive input rather than NaN', () => {
		expect(
			evaluateExpression(ast('ln(field.x)'), field({ 'field.x': -1 })),
			'ln of a negative number must be null'
		).toBeNull();
		expect(
			evaluateExpression(ast('log(field.x)'), field({ 'field.x': 0 })),
			'log of zero must be null'
		).toBeNull();
	});

	it('guards against a function name outside PERMITTED_FUNCTIONS, defense in depth', () => {
		// Syntactically valid (any identifier can be a call target), but not in
		// tableConfig.ts's PERMITTED_FUNCTIONS -- upstream validation is
		// supposed to reject this before it reaches evaluation; this test
		// proves the evaluator does not silently misinterpret it if it does.
		const result = evaluateExpression(ast('eval(field.x)'), field({ 'field.x': 5 }));
		expect(result, 'an unpermitted function name must evaluate to null, never throw').toBeNull();
	});
});

describe('projectResultRows: default config (no table configuration yet)', () => {
	it("keeps the run's own rank order and produces empty columns/null groupValue", () => {
		const run = testRun('run_1', 3);
		const rows = projectResultRows(run, defaultResultsTableConfig(), () => null);
		expect(
			rows.map((r) => r.rank),
			"default config must not reorder the run's rank-ascending matches"
		).toEqual([1, 2, 3]);
		rows.forEach((row) => {
			expect(row.columns, 'default config adds no display columns').toEqual({});
			expect(row.groupValue, 'default config configures no grouping').toBeNull();
		});
	});
});

describe('projectResultRows: computed and display columns', () => {
	it("resolves a computed column value from the match's ranking values", () => {
		const run = runWithMatches('run_1', [
			testMatch(1, { rankingValues: { 'field.volume': 200, 'field.avg_volume': 100 } })
		]);
		const rows = projectResultRows(
			run,
			config({
				computedColumns: [
					{
						id: 'column_1',
						label: 'Relative volume',
						valueType: 'number',
						expression: 'field.volume / field.avg_volume'
					}
				],
				columns: [
					{
						id: 'column_1',
						identity: { source: 'computed_column', computedColumnId: 'column_1' },
						label: 'Relative volume',
						valueType: 'number'
					}
				]
			}),
			() => null
		);
		expect(rows[0]?.columns['column_1'], 'expected 200 / 100').toBe(2);
	});

	it('resolves a catalog_field column, and is honestly null for a field outside rankingValues', () => {
		const run = runWithMatches('run_1', [
			testMatch(1, { rankingValues: { 'field.price.close': 150 } })
		]);
		const rows = projectResultRows(
			run,
			config({
				columns: [
					{
						id: 'column_1',
						identity: { source: 'catalog_field', fieldId: 'field.price.close' },
						label: 'Close',
						valueType: 'number'
					},
					{
						id: 'column_2',
						identity: { source: 'catalog_field', fieldId: 'field.not_ranked' },
						label: 'Unranked field',
						valueType: 'number'
					}
				]
			}),
			() => null
		);
		expect(rows[0]?.columns['column_1'], 'expected the ranked field value').toBe(150);
		expect(
			rows[0]?.columns['column_2'],
			'a field outside rankingValues must resolve to null, not a fabricated value'
		).toBeNull();
	});
});

describe('projectResultRows: sort (AC2, AC3)', () => {
	it('sorts across the full match set by a catalog_field key', () => {
		const run = runWithMatches('run_1', [
			testMatch(1, { rankingValues: { 'field.score': 10 } }),
			testMatch(2, { rankingValues: { 'field.score': 30 } }),
			testMatch(3, { rankingValues: { 'field.score': 20 } })
		]);
		const rows = projectResultRows(
			run,
			config({
				sort: { key: { source: 'catalog_field', fieldId: 'field.score' }, direction: 'desc' }
			}),
			() => null
		);
		expect(
			rows.map((r) => r.rank),
			'expected rank order 2 (score 30), 3 (score 20), 1 (score 10)'
		).toEqual([2, 3, 1]);
	});

	it('breaks ties by result_id using numeric rank, not lexicographic string order', () => {
		// 11 tied rows so rank reaches double digits: a lexicographic compare of
		// "result_run_1_10" vs "result_run_1_9" would (wrongly) place rank 10
		// before rank 9. Numeric rank comparison must not.
		const matches = Array.from({ length: 11 }, (_, i) =>
			testMatch(i + 1, { rankingValues: { 'field.score': 1 } })
		);
		const run = runWithMatches('run_1', matches);
		const rows = projectResultRows(
			run,
			config({
				sort: { key: { source: 'catalog_field', fieldId: 'field.score' }, direction: 'asc' }
			}),
			() => null
		);
		expect(
			rows.map((r) => r.rank),
			'a tied sort must fall back to ascending numeric rank, 1..11 in order'
		).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
	});

	it('sorts nulls after every non-null value, in both directions', () => {
		const run = runWithMatches('run_1', [
			testMatch(1, { rankingValues: { 'field.score': 10 } }),
			testMatch(2, { rankingValues: {} }), // field.score missing -> null
			testMatch(3, { rankingValues: { 'field.score': 20 } })
		]);
		const asc = projectResultRows(
			run,
			config({
				sort: { key: { source: 'catalog_field', fieldId: 'field.score' }, direction: 'asc' }
			}),
			() => null
		);
		expect(
			asc.map((r) => r.rank),
			'null must sort last, ascending'
		).toEqual([1, 3, 2]);

		const desc = projectResultRows(
			run,
			config({
				sort: { key: { source: 'catalog_field', fieldId: 'field.score' }, direction: 'desc' }
			}),
			() => null
		);
		expect(
			desc.map((r) => r.rank),
			'null must sort last, descending too'
		).toEqual([3, 1, 2]);
	});

	it('honors an explicit tie-break key over the default result_id fallback', () => {
		const run = runWithMatches('run_1', [
			testMatch(1, { rankingValues: { 'field.score': 10, 'field.secondary': 5 } }),
			testMatch(2, { rankingValues: { 'field.score': 10, 'field.secondary': 1 } })
		]);
		const rows = projectResultRows(
			run,
			config({
				sort: {
					key: { source: 'catalog_field', fieldId: 'field.score' },
					direction: 'asc',
					tieBreak: { source: 'catalog_field', fieldId: 'field.secondary' },
					tieBreakDirection: 'asc'
				}
			}),
			() => null
		);
		expect(
			rows.map((r) => r.rank),
			'expected rank 2 (secondary 1) before rank 1 (secondary 5)'
		).toEqual([2, 1]);
	});
});

describe('projectResultRows: grouping (AC4)', () => {
	it('attaches the resolved group value to every row', () => {
		const run = runWithMatches('run_1', [
			testMatch(1, { rankingValues: { 'field.sector': 1 } }),
			testMatch(2, { rankingValues: { 'field.sector': 2 } })
		]);
		const rows = projectResultRows(
			run,
			config({ grouping: { key: { source: 'catalog_field', fieldId: 'field.sector' } } }),
			() => null
		);
		expect(rows[0]?.groupValue, "expected the first row's sector").toBe(1);
		expect(rows[1]?.groupValue, "expected the second row's sector").toBe(2);
	});
});

describe('wire serialization', () => {
	it('toWireProjectedRow includes base identity fields plus columns and group_value', () => {
		const run = testRun('run_1', 1);
		const [row] = projectResultRows(
			run,
			config({ grouping: { key: { source: 'result_id' } } }),
			() => 'AAPL'
		);
		if (!row) {
			throw new Error('expected one projected row');
		}
		const wire = toWireProjectedRow(row);
		expect(wire.result_id, 'expected the base row shape to be present').toBe(row.resultId);
		expect(wire.ticker, 'expected the ticker resolver to be used').toBe('AAPL');
		expect(wire.columns, 'expected the columns map').toEqual({});
		expect(wire.group_value, 'expected the group value under snake_case').toBe(row.resultId);
	});

	it('toWireProjectedResultsPage delegates provenance to toWireProvenance', () => {
		const page: ProjectedResultsPage = {
			runId: 'run_1',
			rows: [],
			total: 0,
			offset: 0,
			pageSize: 25,
			nextCursor: null,
			provenance: testProvenance(),
			grouped: false
		};
		const wire = toWireProjectedResultsPage(page);
		expect(wire.run_id, 'expected run_id under snake_case').toBe('run_1');
		expect(wire.provenance, 'expected a provenance object').toBeDefined();
		expect((wire.provenance as Record<string, unknown>).as_of, 'expected as_of on the wire').toBe(
			testProvenance().asOf
		);
	});
});
