import { describe, expect, it } from 'vitest';
import { MAX_PAGE_SIZE } from '../domain/page';
import { createSpyPinnedRunStore, testPinnedRunStore, testRun } from '../testSupport';
import { createResultsReader } from './resultsReader';

describe('createResultsReader (the read contract, AC5)', () => {
	it('exposes exactly getRunMetadata and getResultsPage -- no execute/refresh member', () => {
		const reader = createResultsReader(testPinnedRunStore());
		const keys = Object.keys(reader).sort();
		expect(keys, 'the read contract must expose exactly these two operations').toEqual([
			'getResultsPage',
			'getRunMetadata'
		]);
	});

	it('never calls putRun while reading pages, including past the last page (no silent rerun)', () => {
		const run = testRun('run_1', 3);
		const spy = createSpyPinnedRunStore(testPinnedRunStore(run));
		const reader = createResultsReader(spy);

		reader.getRunMetadata('run_1');
		let page = reader.getResultsPage('run_1', { pageSize: 1 });
		let guard = 0;
		while ('nextCursor' in page && page.nextCursor && guard < 10) {
			page = reader.getResultsPage('run_1', { cursor: page.nextCursor, pageSize: 1 });
			guard += 1;
		}
		// Also probe an unknown run -- a rerun-fallback bug is just as likely to
		// hide behind "the run wasn't found, so let's produce one" as behind a
		// normal read path.
		reader.getResultsPage('run_999', { pageSize: 1 });

		expect(spy.putRunCalls, 'reading must never write a run back to the store').toBe(0);
	});

	it('reports a distinct not-available outcome for an unknown run_id, naming it (AC6)', () => {
		const reader = createResultsReader(testPinnedRunStore());
		const outcome = reader.getResultsPage('run_missing');
		if (!('available' in outcome)) {
			throw new Error(`expected a RunNotAvailable outcome, got ${JSON.stringify(outcome)}`);
		}
		expect(outcome.available, 'available must be false').toBe(false);
		expect(outcome.runId, 'the outcome must name the run_id').toBe('run_missing');
		expect(outcome.reason, "an unstored run_id must report 'unknown'").toBe('unknown');
	});

	it('getRunMetadata reports the same not-available outcome for an unknown run_id (AC6)', () => {
		const reader = createResultsReader(testPinnedRunStore());
		const outcome = reader.getRunMetadata('run_missing');
		if (!('available' in outcome)) {
			throw new Error(`expected a RunNotAvailable outcome, got ${JSON.stringify(outcome)}`);
		}
		expect(outcome.reason, "expected 'unknown'").toBe('unknown');
	});

	it('an empty run yields an empty page with total zero, distinct from not-available (AC7)', () => {
		const run = testRun('run_empty', 0);
		const reader = createResultsReader(testPinnedRunStore(run));
		const outcome = reader.getResultsPage('run_empty');
		if ('available' in outcome) {
			throw new Error('an empty run must not be reported as unavailable');
		}
		if ('rejected' in outcome) {
			throw new Error('an empty run must not be rejected');
		}
		expect(outcome.rows.length, 'expected zero rows').toBe(0);
		expect(outcome.total, 'expected total 0').toBe(0);
		expect(outcome.provenance, 'expected full provenance on an empty page').toBeDefined();
	});

	it('rejects a page size over the maximum, naming it, rather than clamping (AC9)', () => {
		const run = testRun('run_1', 5);
		const reader = createResultsReader(testPinnedRunStore(run));
		const outcome = reader.getResultsPage('run_1', { pageSize: MAX_PAGE_SIZE + 1 });
		if (!('rejected' in outcome) || outcome.reason !== 'page_size_exceeded') {
			throw new Error(`expected a page_size_exceeded rejection, got ${JSON.stringify(outcome)}`);
		}
		expect(outcome.max, `expected the rejection to name ${MAX_PAGE_SIZE}`).toBe(MAX_PAGE_SIZE);
	});

	it('rejects a malformed cursor rather than silently returning the first page', () => {
		const run = testRun('run_1', 5);
		const reader = createResultsReader(testPinnedRunStore(run));
		const outcome = reader.getResultsPage('run_1', { cursor: 'garbage' });
		if (!('rejected' in outcome) || outcome.reason !== 'invalid_cursor') {
			throw new Error(`expected an invalid_cursor rejection, got ${JSON.stringify(outcome)}`);
		}
	});

	it('a full traversal at the default page size visits every row exactly once (AC8)', () => {
		const run = testRun('run_1', 63);
		const reader = createResultsReader(testPinnedRunStore(run));
		const seen: string[] = [];
		let outcome = reader.getResultsPage('run_1');
		for (let guard = 0; guard < 10; guard++) {
			if ('available' in outcome || 'rejected' in outcome) {
				throw new Error('unexpected non-page outcome during traversal');
			}
			seen.push(...outcome.rows.map((row) => row.resultId));
			if (outcome.nextCursor === null) break;
			outcome = reader.getResultsPage('run_1', { cursor: outcome.nextCursor });
		}
		expect(seen.length, `expected all 63 rows, got ${seen.length}`).toBe(63);
		expect(new Set(seen).size, 'expected 63 distinct rows').toBe(63);
	});

	it('resolves ticker through the injected resolver, defaulting to null when none is given', () => {
		const run = testRun('run_1', 1);
		const withResolver = createResultsReader(testPinnedRunStore(run), {
			resolveTicker: () => 'AAPL'
		});
		const withoutResolver = createResultsReader(testPinnedRunStore(run));

		const resolved = withResolver.getResultsPage('run_1');
		const unresolved = withoutResolver.getResultsPage('run_1');
		if ('available' in resolved || 'rejected' in resolved) throw new Error('unexpected outcome');
		if ('available' in unresolved || 'rejected' in unresolved)
			throw new Error('unexpected outcome');

		expect(resolved.rows[0]?.ticker, 'expected the injected resolver to be used').toBe('AAPL');
		expect(unresolved.rows[0]?.ticker, 'expected null when no resolver is supplied').toBeNull();
	});
});
