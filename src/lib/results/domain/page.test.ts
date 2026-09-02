import { describe, expect, it } from 'vitest';
import { makeProvenance, type MarketDataProvenance } from '../../workbench/domain/provenance';
import { emptyFilterTree } from '../../screener/definition';
import type { ScreenerMatch, ScreenerRun } from '../../screener/run';
import {
	buildResultsPage,
	buildRow,
	DEFAULT_PAGE_SIZE,
	decodeCursor,
	encodeCursor,
	makeResultsPage,
	MAX_PAGE_SIZE,
	mintResultId,
	resolvePageSize,
	toWireResultsPage,
	type ResultRow
} from './page';

// Local, minimal fixtures -- this is a domain-layer test, so it does not
// reach into ../testSupport (which composes over screener/runStore.ts, an
// infra module); it builds only the plain data page.ts's functions need.
// Narrowed to `asOf` only -- the one field these tests vary -- rather than a
// generic Partial<MarketDataProvenance>: makeProvenance's input is a
// discriminated union keyed on `liveness`, and spreading an arbitrary
// override object into one arm defeats that union's own type-checking.
function testProvenance(overrides: { asOf?: string } = {}): MarketDataProvenance {
	return makeProvenance({
		asOf: overrides.asOf ?? '2026-09-02T14:30:00.000Z',
		sourceId: 'src.screener.engine',
		sourceLabel: 'Screener engine',
		liveness: 'end_of_day',
		timezone: 'America/New_York',
		currency: 'USD',
		priceAdjustment: 'adjusted'
	});
}

function testMatch(rank: number, overrides: Partial<ScreenerMatch> = {}): ScreenerMatch {
	return {
		instrumentId: `inst_${rank}`,
		rank,
		compositeScore: 1 / rank,
		rankingValues: {},
		nodeEvaluations: {},
		...overrides
	};
}

function testRun(
	runId: string,
	matchCount: number,
	overrides: Partial<ScreenerRun> = {}
): ScreenerRun {
	const defaultMatches = Array.from({ length: matchCount }, (_, index) => testMatch(index + 1));
	return {
		runId,
		screenerId: 'screener_1',
		screenerRevision: 1,
		status: 'complete',
		universeCount: 1000,
		matchedCount: matchCount,
		returnedCount: matchCount,
		truncated: false,
		rankingApplied: true,
		normalization: 'percentile_rank',
		warnings: [],
		provenance: testProvenance(),
		rejectedEvaluations: {},
		filterTree: emptyFilterTree('filter_1'),
		rankingSpec: null,
		createdAt: '2026-09-02T14:30:05.000Z',
		...overrides,
		matches: overrides.matches ?? defaultMatches
	};
}

describe('mintResultId', () => {
	it('derives the same result_id for the same run and rank every time', () => {
		const first = mintResultId('run_1', 7);
		const second = mintResultId('run_1', 7);
		expect(first, 'mintResultId must be deterministic').toBe(second);
	});

	it('mints an id that carries the "result" kind and round-trips the run_id as discriminator', () => {
		const id = mintResultId('run_3', 7);
		expect(id, 'expected a result_run_3_7-shaped id').toBe('result_run_3_7');
	});

	it('mints distinct ids for distinct ranks within the same run', () => {
		const a = mintResultId('run_1', 1);
		const b = mintResultId('run_1', 2);
		expect(a, 'expected distinct ids for distinct ranks').not.toBe(b);
	});
});

describe('buildRow', () => {
	it('carries the ticker only as a display attribute, never as the row identity', () => {
		const row = buildRow('run_1', testMatch(1, { instrumentId: 'inst_aapl' }), () => 'AAPL');
		expect(row.instrumentId, 'instrumentId must stay the stable id').toBe('inst_aapl');
		expect(row.ticker, 'expected the resolved ticker').toBe('AAPL');
		expect(row.resultId, 'result id must never equal the display ticker').not.toBe('AAPL');
	});

	it('reports an honestly-absent ticker as null rather than fabricating one', () => {
		const row = buildRow('run_1', testMatch(1), () => null);
		expect(row.ticker, 'expected null when the resolver has no ticker').toBeNull();
	});
});

describe('resolvePageSize', () => {
	it('defaults to DEFAULT_PAGE_SIZE when no page size is requested', () => {
		const result = resolvePageSize(undefined);
		expect(result, 'expected the default page size').toBe(DEFAULT_PAGE_SIZE);
	});

	it('accepts a requested size at or below the maximum', () => {
		const result = resolvePageSize(MAX_PAGE_SIZE);
		expect(result, `expected ${MAX_PAGE_SIZE} to be accepted`).toBe(MAX_PAGE_SIZE);
	});

	it('rejects a request over the maximum, naming the maximum, rather than clamping', () => {
		const result = resolvePageSize(MAX_PAGE_SIZE + 1);
		if (typeof result === 'number') {
			throw new Error(`expected a rejection, got a clamped/accepted size ${result}`);
		}
		expect(result.rejected, 'expected a rejected outcome').toBe(true);
		expect(result.reason, 'expected page_size_exceeded').toBe('page_size_exceeded');
		expect(result.max, `expected the rejection to name ${MAX_PAGE_SIZE}`).toBe(MAX_PAGE_SIZE);
		expect(result.message, 'expected the message to name the maximum').toContain(
			String(MAX_PAGE_SIZE)
		);
	});

	it('rejects a non-positive or non-integer page size instead of coercing it', () => {
		const zero = resolvePageSize(0);
		const negative = resolvePageSize(-5);
		const fractional = resolvePageSize(2.5);
		for (const [label, result] of [
			['zero', zero],
			['negative', negative],
			['fractional', fractional]
		] as const) {
			if (typeof result === 'number') {
				throw new Error(`expected ${label} to be rejected, got accepted size ${result}`);
			}
			expect(result.reason, `expected ${label} to be page_size_invalid`).toBe('page_size_invalid');
		}
	});
});

describe('makeResultsPage (the page model enforces its own bound)', () => {
	function pageWithRows(count: number) {
		const rows: ResultRow[] = Array.from({ length: count }, (_, i) => ({
			resultId: mintResultId('run_1', i + 1),
			instrumentId: `inst_${i + 1}`,
			ticker: null,
			rank: i + 1,
			compositeScore: null
		}));
		return {
			runId: 'run_1',
			rows,
			total: count,
			offset: 0,
			pageSize: count,
			nextCursor: null,
			provenance: testProvenance()
		};
	}

	it('accepts a page at exactly the hard maximum', () => {
		expect(() => makeResultsPage(pageWithRows(MAX_PAGE_SIZE))).not.toThrow();
	});

	it('cannot represent a page larger than the documented hard maximum', () => {
		expect(() => makeResultsPage(pageWithRows(MAX_PAGE_SIZE + 1))).toThrow(
			new RegExp(String(MAX_PAGE_SIZE))
		);
	});
});

describe('cursor encode/decode', () => {
	it('round-trips a valid cursor back to its offset', () => {
		const cursor = encodeCursor({ runId: 'run_1', offset: 40 });
		const decoded = decodeCursor(cursor, 'run_1');
		if ('rejected' in decoded) {
			throw new Error(`expected the cursor to decode, got a rejection: ${decoded.message}`);
		}
		expect(decoded.offset, 'expected offset 40').toBe(40);
	});

	it('rejects a malformed cursor rather than silently treating it as the first page', () => {
		const decoded = decodeCursor('not-a-real-cursor', 'run_1');
		if (!('rejected' in decoded)) {
			throw new Error('expected a rejection for a malformed cursor');
		}
		expect(decoded.cursorReason, "expected 'malformed'").toBe('malformed');
	});

	it('rejects a cursor minted for a different run rather than reinterpreting it', () => {
		const cursor = encodeCursor({ runId: 'run_1', offset: 10 });
		const decoded = decodeCursor(cursor, 'run_2');
		if (!('rejected' in decoded)) {
			throw new Error('expected a rejection for a cursor from a different run');
		}
		expect(decoded.cursorReason, "expected 'run_mismatch'").toBe('run_mismatch');
	});
});

describe('buildResultsPage', () => {
	it("reports the pinned run's own provenance and as_of, not a fresh one", () => {
		const run = testRun('run_1', 3, {
			provenance: testProvenance({ asOf: '2020-01-01T00:00:00.000Z' })
		});
		const page = buildResultsPage({
			run,
			matches: run.matches,
			offset: 0,
			pageSize: 25,
			resolveTicker: () => null
		});
		expect(page.provenance.asOf, "expected the run's as_of to be reported verbatim").toBe(
			'2020-01-01T00:00:00.000Z'
		);
	});

	it('omits nextCursor on the last page and provides one when more rows remain', () => {
		const run = testRun('run_1', 30);
		const firstPage = buildResultsPage({
			run,
			matches: run.matches.slice(0, 25),
			offset: 0,
			pageSize: 25,
			resolveTicker: () => null
		});
		expect(firstPage.nextCursor, 'expected a cursor when more rows remain').not.toBeNull();

		const lastPage = buildResultsPage({
			run,
			matches: run.matches.slice(25, 30),
			offset: 25,
			pageSize: 25,
			resolveTicker: () => null
		});
		expect(lastPage.nextCursor, 'expected no cursor on the last page').toBeNull();
	});

	it('an empty run yields an empty page with total zero and full provenance (AC7)', () => {
		const run = testRun('run_1', 0);
		const page = buildResultsPage({
			run,
			matches: [],
			offset: 0,
			pageSize: 25,
			resolveTicker: () => null
		});
		expect(page.rows.length, 'expected zero rows').toBe(0);
		expect(page.total, 'expected total 0').toBe(0);
		expect(page.nextCursor, 'expected no next cursor for an empty run').toBeNull();
		expect(page.provenance, 'expected full provenance even for an empty run').toBeDefined();
	});

	it('paging with page size 1 over ties visits every row exactly once and skips none (AC8)', () => {
		const run = testRun('run_1', 7, {
			matches: Array.from({ length: 7 }, (_, i) => testMatch(i + 1, { compositeScore: 0.5 }))
		});
		const seen: string[] = [];
		let offset = 0;
		for (let guard = 0; guard < 100; guard++) {
			const slice = run.matches.slice(offset, offset + 1);
			const page = buildResultsPage({
				run,
				matches: slice,
				offset,
				pageSize: 1,
				resolveTicker: () => null
			});
			page.rows.forEach((row) => seen.push(row.resultId));
			if (page.nextCursor === null) break;
			const decoded = decodeCursor(page.nextCursor, run.runId);
			if ('rejected' in decoded) throw new Error('unexpected cursor rejection during traversal');
			offset = decoded.offset;
		}
		expect(seen.length, `expected exactly 7 rows visited, got ${seen.join(',')}`).toBe(7);
		expect(new Set(seen).size, 'expected 7 distinct rows').toBe(7);
	});
});

describe('toWireResultsPage', () => {
	it('serializes to snake_case with the run id and rows present', () => {
		const run = testRun('run_1', 1);
		const page = buildResultsPage({
			run,
			matches: run.matches,
			offset: 0,
			pageSize: 25,
			resolveTicker: () => null
		});
		const wire = toWireResultsPage(page);
		expect(wire.run_id, 'expected run_id on the wire').toBe('run_1');
		expect(Array.isArray(wire.rows), 'expected rows to serialize as an array').toBe(true);
		expect(wire.next_cursor, 'expected next_cursor null on the last page').toBeNull();
	});
});
