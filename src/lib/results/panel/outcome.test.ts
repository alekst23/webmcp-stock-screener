import { describe, expect, it } from 'vitest';
import { isProjectedPage, isRejectedRequest, isRunNotAvailable } from './outcome';
import type { ProjectedResultsPage } from '../domain/projection';
import { testProvenance } from '../testSupport';

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

const notAvailable = {
	available: false as const,
	runId: 'run_1',
	reason: 'unknown' as const,
	message: 'gone'
};

const rejected = {
	rejected: true as const,
	reason: 'page_size_invalid' as const,
	requested: -1,
	max: 200,
	message: 'invalid'
};

describe('outcome guards', () => {
	it('isProjectedPage is true only for a real page', () => {
		expect(isProjectedPage(page)).toBe(true);
		expect(isProjectedPage(notAvailable)).toBe(false);
		expect(isProjectedPage(rejected)).toBe(false);
	});

	it('isRunNotAvailable is true only for a RunNotAvailable', () => {
		expect(isRunNotAvailable(notAvailable)).toBe(true);
		expect(isRunNotAvailable(page)).toBe(false);
		expect(isRunNotAvailable(rejected)).toBe(false);
	});

	it('isRejectedRequest is true only for a page-size/cursor rejection', () => {
		expect(isRejectedRequest(rejected)).toBe(true);
		expect(isRejectedRequest(page)).toBe(false);
		expect(isRejectedRequest(notAvailable)).toBe(false);
	});
});
