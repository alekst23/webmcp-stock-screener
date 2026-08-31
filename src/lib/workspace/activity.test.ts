import { describe, it } from 'vitest';

// T-1002-2: activityStore persists to localStorage under its own key,
// mirroring store.ts's read-on-init/write-on-update pattern for
// WorkspaceState.
describe('activity log persistence', () => {
	it('persists logged actions to localStorage under their own key', () => {
		throw new Error('not implemented');
	});

	it('restores the full log, in the same order, on reload in the same browser', () => {
		throw new Error('not implemented');
	});

	it('starts with an empty log in a fresh browser with no existing key', () => {
		throw new Error('not implemented');
	});
});
