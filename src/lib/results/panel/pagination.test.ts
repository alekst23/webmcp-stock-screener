import { describe, expect, it } from 'vitest';
import { currentCursor, goToNextPage, goToPreviousPage, initialPagination } from './pagination';

describe('pagination', () => {
	it('starts on the first page with an undefined cursor', () => {
		const state = initialPagination();
		expect(currentCursor(state)).toBeUndefined();
	});

	it('advances to the next page using the outcome-supplied cursor', () => {
		let state = initialPagination();
		state = goToNextPage(state, 'rc1~run_1~25');
		expect(currentCursor(state)).toBe('rc1~run_1~25');
	});

	it('does nothing when nextCursor is null (already the last page)', () => {
		const state = initialPagination();
		const next = goToNextPage(state, null);
		expect(next).toEqual(state);
	});

	it('goes back to the first page from the second', () => {
		let state = initialPagination();
		state = goToNextPage(state, 'rc1~run_1~25');
		state = goToPreviousPage(state);
		expect(currentCursor(state)).toBeUndefined();
	});

	it('does nothing when already on the first page', () => {
		const state = initialPagination();
		expect(goToPreviousPage(state)).toEqual(state);
	});

	it('reuses a recorded cursor instead of appending a duplicate when revisiting a page', () => {
		let state = initialPagination();
		state = goToNextPage(state, 'rc1~run_1~25');
		state = goToNextPage(state, 'rc1~run_1~50');
		state = goToPreviousPage(state);
		expect(currentCursor(state)).toBe('rc1~run_1~25');
		state = goToNextPage(state, 'rc1~run_1~50');
		expect(currentCursor(state)).toBe('rc1~run_1~50');
		expect(state.cursors, 'must not have appended a duplicate cursor').toEqual([
			undefined,
			'rc1~run_1~25',
			'rc1~run_1~50'
		]);
	});
});
