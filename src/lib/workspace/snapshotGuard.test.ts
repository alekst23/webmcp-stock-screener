import { describe, expect, it } from 'vitest';
import { hasUnsavedChanges } from './snapshotGuard';

describe('unsaved-changes guard', () => {
	it('reports no unsaved changes when nothing has been saved/loaded and the workspace is still empty', () => {
		expect.fail('not implemented');
	});

	it('reports unsaved changes when nothing has been saved/loaded but the workspace has content', () => {
		expect.fail('not implemented');
	});

	it('reports no unsaved changes when the live workspace matches the last saved/loaded baseline', () => {
		expect.fail('not implemented');
	});

	it('reports unsaved changes when the live workspace differs from the last saved/loaded baseline', () => {
		expect.fail('not implemented');
	});

	it('compares structurally, not by reference, for an unchanged baseline object', () => {
		expect.fail('not implemented');
	});
});
