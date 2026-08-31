import { describe, expect, it } from 'vitest';
import type { WorkspaceState } from '../webmcp/types';
import { hasUnsavedChanges } from './snapshotGuard';

function emptyWorkspace(): WorkspaceState {
	return { studies: [], setups: [], instanceSets: [], panels: [], focus: null };
}

describe('unsaved-changes guard', () => {
	it('reports no unsaved changes when nothing has been saved/loaded and the workspace is still empty', () => {
		expect(hasUnsavedChanges(emptyWorkspace(), null)).toBe(false);
	});

	it('reports unsaved changes when nothing has been saved/loaded but the workspace has content', () => {
		const current: WorkspaceState = {
			...emptyWorkspace(),
			studies: [{ id: 's1', name: 'rel_vol_20', expression: 'volume / sma(volume, 20)' }]
		};

		expect(hasUnsavedChanges(current, null)).toBe(true);
	});

	it('reports no unsaved changes when the live workspace matches the last saved/loaded baseline', () => {
		const baseline: WorkspaceState = {
			...emptyWorkspace(),
			setups: [{ id: 'setup_1', steps: [{ condition: 'gap_pct > 4' }] }]
		};
		const current: WorkspaceState = {
			...emptyWorkspace(),
			setups: [{ id: 'setup_1', steps: [{ condition: 'gap_pct > 4' }] }]
		};

		expect(hasUnsavedChanges(current, baseline)).toBe(false);
	});

	it('reports unsaved changes when the live workspace differs from the last saved/loaded baseline', () => {
		const baseline: WorkspaceState = {
			...emptyWorkspace(),
			setups: [{ id: 'setup_1', steps: [{ condition: 'gap_pct > 4' }] }]
		};
		const current: WorkspaceState = {
			...emptyWorkspace(),
			setups: [
				{ id: 'setup_1', steps: [{ condition: 'gap_pct > 4' }] },
				{ id: 'setup_2', steps: [{ condition: 'gap_pct > 8' }] }
			]
		};

		expect(hasUnsavedChanges(current, baseline)).toBe(true);
	});

	it('compares structurally, not by reference, for an unchanged baseline object', () => {
		const baseline: WorkspaceState = {
			...emptyWorkspace(),
			panels: [{ id: 'panel_1', kind: 'grid', instanceSetId: 'set_1' }]
		};
		// A structurally identical but distinct object -- as would arrive from
		// re-reading the store or a fresh loadSnapshot() call.
		const current: WorkspaceState = JSON.parse(JSON.stringify(baseline)) as WorkspaceState;

		expect(current).not.toBe(baseline);
		expect(hasUnsavedChanges(current, baseline)).toBe(false);
	});
});
