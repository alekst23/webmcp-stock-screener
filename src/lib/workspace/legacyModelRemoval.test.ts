// T-1015-6: the legacy workspace model and its Svelte components are gone.
// Most of this ticket's own scope (store.ts, apiEngine.ts, the five legacy
// components, visualization.ts, snapshots.ts/snapshotGuard.ts) was actually
// deleted by T-1015-5, which already had to remove them to keep the build
// compiling once it deleted the shared types they depended on -- see
// T-1015-5's own commit history. This ticket's real remaining scope was
// ActivityFeed.svelte/activity.ts (held back pending T-1015-10, now live)
// and src/lib/shell/AppShell.svelte (held back pending T-1015-9, now live),
// plus TickerSearch.svelte/tickerSearch.ts, which had no dependency and
// were simply not reached yet.
//
// Absence/presence of a source file or an identifier is checked via Vite's
// import.meta.glob(..., { query: '?raw' }) reading real source text, the
// same technique paletteGuard.test.ts and toolSurfaceRemoval.test.ts already
// use -- this project has no Node typings, so there is no fs.existsSync.

import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from './apiConfig';
import { formatFreshness, isMockPanel } from './panelStatus';

const TS_SOURCES = import.meta.glob('/src/**/*.ts', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const SVELTE_SOURCES = import.meta.glob('/src/**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const THIS_FILE = '/src/lib/workspace/legacyModelRemoval.test.ts';

function fileExists(path: string): boolean {
	return path in TS_SOURCES || path in SVELTE_SOURCES;
}

// Every other source file's text, keyed by path -- excludes this file
// itself, which necessarily names every retired path as data.
const OTHER_ENTRIES = [
	...Object.entries(TS_SOURCES).filter(([path]) => path !== THIS_FILE),
	...Object.entries(SVELTE_SOURCES)
];

function importers(specifierFragment: string): string[] {
	const pattern = new RegExp(`from ['"][^'"]*${specifierFragment}['"]`);
	return OTHER_ENTRIES.filter(([, text]) => pattern.test(text)).map(([path]) => path);
}

describe('legacy store, engine client, and components are removed', () => {
	// spec.md "Workspace-model removal / Happy path". AC1/AC2: deleted by
	// T-1015-5, verified still true here rather than re-asserted as this
	// ticket's own work.
	it('store.ts, apiEngine.ts, and their tests no longer exist (T-1015-5)', () => {
		for (const path of [
			'/src/lib/workspace/store.ts',
			'/src/lib/workspace/store.test.ts',
			'/src/lib/workspace/apiEngine.ts',
			'/src/lib/workspace/apiEngine.test.ts'
		]) {
			expect(fileExists(path), `${path} still exists`).toBe(false);
		}
	});

	// AC3. WorkspaceView/GridPanel/PriceChart/FocusChart/ChartToolbar/
	// SnapshotPicker were deleted by T-1015-5; ActivityFeed is this ticket's
	// own deletion, held back until T-1015-10 shipped its replacement.
	it('WorkspaceView, GridPanel, PriceChart, FocusChart, ChartToolbar, ActivityFeed, SnapshotPicker are removed', () => {
		for (const path of [
			'/src/lib/workspace/WorkspaceView.svelte',
			'/src/lib/workspace/GridPanel.svelte',
			'/src/lib/workspace/PriceChart.svelte',
			'/src/lib/workspace/FocusChart.svelte',
			'/src/lib/workspace/ChartToolbar.svelte',
			'/src/lib/workspace/ActivityFeed.svelte',
			'/src/lib/workspace/SnapshotPicker.svelte',
			'/src/lib/workspace/activity.ts',
			'/src/lib/workspace/activity.test.ts'
		]) {
			expect(fileExists(path), `${path} still exists`).toBe(false);
		}
		expect(
			importers('workspace/ActivityFeed\\.svelte'),
			'a live import of ActivityFeed survives'
		).toEqual([]);
		expect(importers('workspace/activity(?!\\w)'), 'a live import of activity.ts survives').toEqual(
			[]
		);
	});

	// Correction to this ticket's original scope: T-1015-1's inventory
	// classified AppShell.svelte as retire-once-replaced (blocked on
	// T-1015-9) and TickerSearch.svelte/tickerSearch.ts as retire (never
	// blocked, simply not yet reached). Both are this ticket's own deletions.
	it('AppShell.svelte and TickerSearch.svelte/tickerSearch.ts are removed, and nothing imports them', () => {
		for (const path of [
			'/src/lib/shell/AppShell.svelte',
			'/src/lib/workspace/TickerSearch.svelte',
			'/src/lib/workspace/tickerSearch.ts',
			'/src/lib/workspace/tickerSearch.test.ts'
		]) {
			expect(fileExists(path), `${path} still exists`).toBe(false);
		}
		expect(importers('shell/AppShell\\.svelte'), 'a live import of AppShell survives').toEqual([]);
		expect(
			importers('workspace/TickerSearch\\.svelte'),
			'a live import of TickerSearch.svelte survives'
		).toEqual([]);
		expect(
			importers('workspace/tickerSearch(?!\\w)'),
			'a live import of tickerSearch.ts survives'
		).toEqual([]);
	});

	// workspace/testSupport.ts had exactly one consumer, activity.test.ts;
	// deleting the consumer without deleting the helper would leave an
	// orphaned test helper (AC8).
	it('workspace/testSupport.ts is removed along with its only consumer', () => {
		expect(fileExists('/src/lib/workspace/testSupport.ts'), 'testSupport.ts still exists').toBe(
			false
		);
	});

	// Correction to this ticket's original scope: panelStatus.ts and
	// apiConfig.ts both survive -- T-1015-9's WorkbenchShell.svelte imports
	// panelStatus.ts directly for its data-freshness pill, so deleting it
	// (as the original inventory assumed, before that consumer existed)
	// would break the live shell. apiConfig.ts already had this correction.
	it('panelStatus.ts and apiConfig.ts survive the cleanup', () => {
		expect(fileExists('/src/lib/workspace/panelStatus.ts'), 'panelStatus.ts was deleted').toBe(
			true
		);
		expect(fileExists('/src/lib/workspace/apiConfig.ts'), 'apiConfig.ts was deleted').toBe(true);
		expect(
			importers('workspace/panelStatus'),
			'no live module still imports panelStatus.ts'
		).not.toEqual([]);
		expect(
			importers('workspace/apiConfig'),
			'no live module still imports apiConfig.ts'
		).not.toEqual([]);
		// Both stay usable, not just importable.
		expect(typeof resolveApiBaseUrl).toBe('function');
		expect(
			isMockPanel({ asOf: '', firstDate: '', tickerCount: 0, rowCount: 0, source: 'mock' })
		).toBe(true);
		expect(formatFreshness(null).state).toBe('unknown');
	});
});

describe('absorbed capabilities exist in the new surface before legacy source deletion', () => {
	// spec.md "Workspace-model removal / Absorbed logic". AC4/AC5: chart-math
	// and snapshot persistence were verified live by T-1015-5 before it
	// deleted visualization.ts/snapshots.ts; re-confirmed here rather than
	// re-litigated.
	it('chartScales.ts (chart-math absorption) and revisionService.ts (snapshot absorption) exist', () => {
		expect(
			fileExists('/src/lib/workbench/chart/components/chartScales.ts'),
			'chartScales.ts is missing -- chart-math absorption (T-1015-5) regressed'
		).toBe(true);
		expect(
			fileExists('/src/lib/workbench/application/revisionService.ts'),
			'revisionService.ts is missing -- snapshot absorption (T-1015-5) regressed'
		).toBe(true);
		expect(fileExists('/src/lib/workspace/visualization.ts'), 'visualization.ts still exists').toBe(
			false
		);
		expect(fileExists('/src/lib/workspace/snapshots.ts'), 'snapshots.ts still exists').toBe(false);
		expect(fileExists('/src/lib/workspace/snapshotGuard.ts'), 'snapshotGuard.ts still exists').toBe(
			false
		);
	});

	// T-1015-10 (merged) shipped ActionLogPanel.svelte, backed by
	// changeHistory.ts's attributed ChangeRecord (actor: 'human' | 'agent'),
	// and wired it into WorkbenchShell.svelte -- the parity-matrix item that
	// held activity.ts back is now satisfied by real, live code, so deleting
	// activity.ts/ActivityFeed.svelte here is not a silent capability drop.
	it('the unified action log is absorbed by ActionLogPanel.svelte/changeHistory.ts, not dropped', () => {
		expect(
			fileExists('/src/lib/panels/shell/ActionLogPanel.svelte'),
			'ActionLogPanel.svelte is missing'
		).toBe(true);
		const changeHistorySource = TS_SOURCES['/src/lib/workbench/application/changeHistory.ts'];
		expect(changeHistorySource, 'changeHistory.ts was not resolved').toBeTruthy();
		expect(
			changeHistorySource,
			'changeHistory.ts must attribute each change to a human or an agent'
		).toMatch(/actor:\s*Actor/);
		const shellSource = SVELTE_SOURCES['/src/lib/panels/shell/WorkbenchShell.svelte'];
		expect(shellSource, 'WorkbenchShell.svelte was not resolved').toBeTruthy();
		expect(shellSource, 'WorkbenchShell.svelte no longer renders the action log').toContain(
			'<ActionLogPanel'
		);
	});

	// Technical Considerations: the legacy store kept human-driven and
	// agent-driven focus state in two separate fields so neither actor could
	// clobber the other. T-1015-5 deleted WorkspaceState/FocusState outright
	// (webmcp/toolSurfaceRemoval.test.ts asserts neither identifier survives
	// as a declaration anywhere) rather than collapsing them into one new
	// field -- there is no merged-focus-field regression to catch, because
	// there is no focus field of any kind left. Recorded here as the
	// resolution of that named risk, not re-tested (already covered).
	it('WorkspaceState/FocusState are gone outright, not collapsed into a single field', () => {
		const declarationPattern = /\b(interface|type|class|const)\s+(WorkspaceState|FocusState)\b/;
		const offenders = OTHER_ENTRIES.filter(([, text]) => declarationPattern.test(text));
		expect(
			offenders.map(([path]) => path),
			'WorkspaceState or FocusState is still declared somewhere'
		).toEqual([]);
	});
});

describe('a returning user with stale legacy storage is not left with a broken app', () => {
	// spec.md "Workspace-model removal / Returning user". AC6.
	//
	// Decision (deliberately abandon, not migrate or clear): store.ts wrote
	// 'webmcp-workspace-state', snapshots.ts wrote
	// 'webmcp-workspace-snapshots' (both retired by T-1015-5), and
	// activity.ts wrote 'webmcp-activity-log' (retired by this ticket). None
	// of the three is read by any surviving module -- workbench's own
	// localStorage-backed repository already uses disjoint keys
	// ('workbench-workspaces'/'workbench-revisions'/'workbench-active', see
	// workspaceRepository.ts) specifically so it would never collide with or
	// need to interpret the legacy slots. A returning user's browser keeps
	// whatever JSON sat under the old keys; nothing in the app ever calls
	// getItem on them again, so it can neither crash on corrupt/foreign data
	// there nor accidentally resurrect it. Migrating or actively clearing
	// those keys was rejected: it would mean writing new code whose only
	// purpose is to read a shape only the deleted modules understood.
	it('no surviving source reads or writes the retired legacy storage keys', () => {
		const legacyKeys = [
			'webmcp-workspace-state',
			'webmcp-workspace-snapshots',
			'webmcp-activity-log'
		];
		for (const key of legacyKeys) {
			// A quoted literal, not a bare substring: workspaceRepository.ts's
			// own header comment names these keys unquoted, in prose, to explain
			// why its own keys are disjoint from them -- that is legitimate
			// history, not a surviving getItem/setItem call site (which would
			// need the string quoted to be valid TS).
			const quoted = new RegExp(`['"]${key}['"]`);
			const liveHits = OTHER_ENTRIES.filter(
				([path, text]) => !path.endsWith('.test.ts') && quoted.test(text)
			);
			expect(
				liveHits.map(([path]) => path),
				`'${key}' is still referenced by live (non-test) code: ${liveHits.map(([p]) => p).join(', ')}`
			).toEqual([]);
		}
	});

	it('the surviving workbench repository uses keys disjoint from every retired legacy key', () => {
		const repoSource = TS_SOURCES['/src/lib/workbench/infra/workspaceRepository.ts'];
		expect(repoSource, 'workspaceRepository.ts was not resolved').toBeTruthy();
		for (const legacyKey of [
			'webmcp-workspace-state',
			'webmcp-workspace-snapshots',
			'webmcp-activity-log'
		]) {
			expect(
				repoSource,
				`workspaceRepository.ts must not reuse the retired key '${legacyKey}'`
			).not.toContain(`'${legacyKey}'`);
		}
	});
});
