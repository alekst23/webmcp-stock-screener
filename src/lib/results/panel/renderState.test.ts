import { describe, expect, it } from 'vitest';
import { computeRenderState } from './renderState';
import type { ProjectedResultsPage } from '../domain/projection';
import { testProvenance } from '../testSupport';

function page(overrides: Partial<ProjectedResultsPage> = {}): ProjectedResultsPage {
	return {
		runId: 'run_1',
		rows: [],
		total: 0,
		offset: 0,
		pageSize: 25,
		nextCursor: null,
		provenance: testProvenance(),
		grouped: false,
		...overrides
	};
}

describe('computeRenderState', () => {
	it('reports unbound when no run id is bound, even with a stale outcome present', () => {
		const state = computeRenderState({
			runId: null,
			outcome: page({ total: 5 }),
			readFailed: null
		});
		expect(state, 'unbound must win over a stale outcome').toEqual({ kind: 'unbound' });
	});

	it('reports loading when a run is bound but no read has completed yet', () => {
		const state = computeRenderState({ runId: 'run_1', outcome: null, readFailed: null });
		expect(state).toEqual({ kind: 'loading' });
	});

	it('reports error when the read threw, even if an outcome from a prior read is present', () => {
		const state = computeRenderState({
			runId: 'run_1',
			outcome: page({ total: 5 }),
			readFailed: 'boom'
		});
		expect(state, 'a caught exception must win over a stale outcome').toEqual({
			kind: 'error',
			message: 'boom'
		});
	});

	it('reports error for a rejected page-size/cursor request', () => {
		const state = computeRenderState({
			runId: 'run_1',
			outcome: {
				rejected: true,
				reason: 'page_size_exceeded',
				requested: 999,
				max: 200,
				message: 'Requested page size 999 exceeds the maximum of 200.'
			},
			readFailed: null
		});
		expect(state).toEqual({
			kind: 'error',
			message: 'Requested page size 999 exceeds the maximum of 200.'
		});
	});

	it('reports unavailable for an unknown/evicted run, appending the re-run instruction', () => {
		const state = computeRenderState({
			runId: 'run_1',
			outcome: {
				available: false,
				runId: 'run_1',
				reason: 'evicted',
				message:
					"Run run_1 is no longer available: it was evicted under the store's retention policy."
			},
			readFailed: null
		});
		expect(state.kind, 'must be the unavailable state, not a generic error').toBe('unavailable');
		if (state.kind === 'unavailable') {
			expect(state.message).toContain('Run the screener again to see current results.');
			expect(state.message).toContain('evicted');
		}
	});

	it('reports empty for a real page with zero total, distinct from unavailable', () => {
		const state = computeRenderState({
			runId: 'run_1',
			outcome: page({ total: 0 }),
			readFailed: null
		});
		expect(state.kind).toBe('empty');
	});

	it('reports ready for a real page with at least one row', () => {
		const outcome = page({ total: 1 });
		const state = computeRenderState({ runId: 'run_1', outcome, readFailed: null });
		expect(state).toEqual({ kind: 'ready', page: outcome });
	});
});
