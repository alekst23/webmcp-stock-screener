import { describe, expect, it } from 'vitest';
import { toggleSelection } from './selection';

describe('toggleSelection', () => {
	it('adds an id not already selected', () => {
		expect(toggleSelection([], 'result_1')).toEqual(['result_1']);
		expect(toggleSelection(['result_1'], 'result_2')).toEqual(['result_1', 'result_2']);
	});

	it('removes an id already selected', () => {
		expect(toggleSelection(['result_1', 'result_2'], 'result_1')).toEqual(['result_2']);
	});

	it('does not mutate the input array', () => {
		const original = ['result_1'];
		toggleSelection(original, 'result_2');
		expect(original, 'toggleSelection must be pure').toEqual(['result_1']);
	});
});
