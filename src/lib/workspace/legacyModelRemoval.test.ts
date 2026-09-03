// T-1015-6: failing test stubs for removing the legacy workspace model
// and its Svelte components. See T-1015-6's Solution Approach for why
// visualization.ts is retire-not-absorb, why activity.ts waits on
// T-1015-10, and why apiConfig.ts must NOT be deleted.
//
// Each stub currently throws to fail clearly; the real assertions land
// when T-1015-6 is implemented.

import { describe, it } from 'vitest';

describe('legacy store, engine client, and components are removed', () => {
	// spec.md "Workspace-model removal / Happy path"
	it('store.ts, apiEngine.ts, and their tests no longer exist', () => {
		throw new Error('not implemented: T-1015-6 AC1/AC2 -- files deleted');
	});

	it('WorkspaceView, GridPanel, PriceChart, FocusChart, ChartToolbar, ActivityFeed, SnapshotPicker are removed', () => {
		throw new Error('not implemented: T-1015-6 AC3 -- components deleted, nothing imports them');
	});

	it('apiConfig.ts survives the cleanup', () => {
		throw new Error(
			'not implemented: T-1015-6 -- apiConfig.ts is "keep" per the inventory correction ' +
				'(3 live new-surface tool files import resolveApiBaseUrl); this test guards against ' +
				'an over-broad directory-level deletion of workspace/'
		);
	});
});

describe('absorbed capabilities exist in the new surface before legacy source deletion', () => {
	// spec.md "Workspace-model removal / Absorbed logic"
	it('chart-math functions have equivalent coverage in chartScales.ts before visualization.ts is deleted', () => {
		throw new Error(
			'not implemented: T-1015-6 AC4/AC5 -- computeChartGeometry/axisTicks/nearestBarIndex ' +
				'equivalents in workbench/chart/components/chartScales.ts are unit-tested'
		);
	});

	it('activity.ts is not deleted before T-1015-10 ships an attributed action log', () => {
		throw new Error(
			'not implemented: T-1015-6 -- deleting activity.ts before its replacement lands would ' +
				'silently execute a capability drop the user did not accept (parity matrix item 6 ' +
				'became T-1015-10 scope, not a drop)'
		);
	});

	it('snapshots.ts is not deleted before revisionService.ts is confirmed live', () => {
		throw new Error(
			'not implemented: T-1015-6 -- snapshots.ts/snapshotGuard.ts retire only once ' +
				'WORKBENCH_TOOLS_ENABLED-gated revisionService.ts is confirmed reachable'
		);
	});
});

describe('a returning user with stale legacy storage is not left with a broken app', () => {
	// spec.md "Workspace-model removal / Returning user"
	it('legacy localStorage keys are migrated, deliberately abandoned, or cleaned up on load', () => {
		throw new Error(
			'not implemented: T-1015-6 AC6 -- app opened with pre-cutover workspace/activity ' +
				'localStorage keys present loads without crashing, per one of the three stated ' +
				'strategies'
		);
	});
});
