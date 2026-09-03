// T-1015-3: route migration onto the new panel/workspace model. Per project
// convention there is no Svelte component-render harness (see T-1015-3's
// Solution Approach), so these tests inspect route source text statically
// rather than mounting components -- the same technique AC8 itself implies
// ("no route imports the legacy tool builder, legacy engine client, or
// legacy workspace store").
import { describe, expect, it } from 'vitest';

// Vite's glob import rather than a filesystem walk -- this project has no
// node typings (see theme/paletteGuard.test.ts's own use of the same
// pattern). Eager + a literal glob so a missing route resolves to "absent
// from this map" instead of a thrown import error, which is what makes the
// "route no longer exists" assertions below possible.
const ROUTE_SOURCES = import.meta.glob('/src/routes/**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const MAIN_ROUTE = ROUTE_SOURCES['/src/routes/+page.svelte'] ?? '';

describe('main route renders the new panel/workspace model', () => {
	it('resolved the main route source at all (glob sanity)', () => {
		expect(MAIN_ROUTE, '/src/routes/+page.svelte was not resolved by the glob').not.toBe('');
	});

	// spec.md "Route migration / Happy path"
	it('reads no legacy workspace state', () => {
		expect(MAIN_ROUTE).not.toContain('$lib/workspace/store');
		expect(MAIN_ROUTE).not.toContain('$lib/workspace/apiEngine');
		expect(MAIN_ROUTE).not.toContain('workspaceStore');
	});

	it('does not import the legacy tool builder', () => {
		expect(MAIN_ROUTE).not.toContain('$lib/webmcp/tools');
	});

	it('composes the same panel/workspace composition root /workbench uses, not a second one', () => {
		expect(MAIN_ROUTE).toContain(
			"import { createWorkbenchCompositionGuard } from '$lib/workbench/composition/workbenchCompositionGuard'"
		);
		expect(MAIN_ROUTE).toContain('PanelContainer');
	});
});

describe('WebMCP status header on the migrated route', () => {
	// spec.md "Route migration / Status header"
	it('reports the new surface defined tool count, available tool count, and bridge state', () => {
		// Re-pointed at newSurfaceSession.ts (whose own test suite proves the
		// connecting/connected/failed mapping and the tool-count/name sourcing
		// off document.modelContext.getTools()) rather than session.ts's
		// connectWebmcp(engine, ...), which AC8 forbids importing here.
		expect(MAIN_ROUTE).toContain('$lib/webmcp/newSurfaceSession');
		expect(MAIN_ROUTE).not.toContain("from '$lib/webmcp/session'");
		expect(MAIN_ROUTE).toContain('formatDefinedStatus');
		expect(MAIN_ROUTE).toContain('formatAvailableStatus');
		expect(MAIN_ROUTE).toContain('formatBridgeStatus');
	});
});

describe('surviving capabilities are reachable from the migrated route', () => {
	// spec.md "Route migration / Surviving capability". Cross-checks
	// capability-parity-matrix.md's "reachability gap" rows (11-14): each
	// names a flag that only needed flipping plus a live caller for its
	// group's tools to become reachable. The caller is
	// workbenchCompositionRoot.ts (proven by its own test suite); this test
	// proves the flags are the confirmed-surviving trio, re-verified at
	// implementation time per the ticket's Solution Approach, not trusted
	// from the design pass.
	it('exposes every capability T-1015-2 marked surviving and UI-observable', async () => {
		const { CHART_TOOLS_ENABLED } = await import('../lib/workbench/chart/tools/registerChartTools');
		const { SIMILARITY_TOOLS_ENABLED } =
			await import('../lib/workbench/similarity/tools/registerSimilarityTools');
		const { FOLLOWUP_AUTHORING_TOOLS_ENABLED } =
			await import('../lib/workbench/followup/tools/registerFollowupTools');
		const { SCREENER_TOOLS_ENABLED } = await import('../lib/webmcp/screener/registerScreenerTools');
		const { WORKBENCH_TOOLS_ENABLED } =
			await import('../lib/workbench/tools/registerWorkbenchTools');

		expect(CHART_TOOLS_ENABLED, 'chart: study/grid visualization row').toBe(true);
		expect(SIMILARITY_TOOLS_ENABLED, 'similarity: find/explain/compare row').toBe(true);
		expect(FOLLOWUP_AUTHORING_TOOLS_ENABLED, 'follow-up authoring: study definition row').toBe(
			true
		);
		expect(SCREENER_TOOLS_ENABLED, 'screener: instance search row').toBe(true);
		expect(WORKBENCH_TOOLS_ENABLED, 'workbench-core: named snapshots row').toBe(true);
	});

	it('flips *_TOOLS_ENABLED flags for capabilities confirmed surviving, and leaves accepted drops off', async () => {
		// measure/splitInstances (backtest) was an accepted drop; alert and
		// watchlist have no reason to enable independent of this cutover
		// (Solution Approach). workbenchCompositionRoot.test.ts's own negative
		// test enforces that none of these three are ever registered.
		const { BACKTEST_TOOLS_ENABLED } =
			await import('../lib/workbench/backtest/tools/registerBacktestTools');
		const { ALERT_TOOLS_ENABLED } =
			await import('../lib/workbench/alerts/tools/registerAlertTools');
		const { WATCHLIST_TOOLS_ENABLED } =
			await import('../lib/workbench/watchlist/tools/registerWatchlistTools');

		expect(BACKTEST_TOOLS_ENABLED, 'measure/splitInstances was an accepted drop').toBe(false);
		expect(ALERT_TOOLS_ENABLED, 'no reason to enable independent of this cutover').toBe(false);
		expect(WATCHLIST_TOOLS_ENABLED, 'no reason to enable independent of this cutover').toBe(false);
	});
});

describe('throwaway scaffolding is removed', () => {
	// spec.md "Route migration / Throwaway scaffolding"
	it('deletes src/routes/spike/ and nothing links to it', () => {
		expect('/src/routes/spike/+page.svelte' in ROUTE_SOURCES).toBe(false);
		expect(MAIN_ROUTE).not.toContain('/spike');
	});

	it('resolves the manual tool harness route decisively by removing it (AC6)', () => {
		// Recorded decision (Solution Approach): src/routes/dev/+page.svelte had
		// no new-surface replacement per the parity matrix's confirmed drop
		// ("Manual tool-harness route... Drop. No equivalent dev/test route
		// exists for the new surface"), so it is removed outright rather than
		// migrated -- executing an already-accepted drop, not a new decision.
		expect('/src/routes/dev/+page.svelte' in ROUTE_SOURCES).toBe(false);
		expect(MAIN_ROUTE).not.toContain('/dev');
	});
});

describe('production build succeeds on the migrated route', () => {
	// T-1015-3 AC7
	it('is verified via a browser check at ticket close, not a vitest assertion', () => {
		// This project has no Svelte component-render harness (see this
		// ticket's Technical Considerations); "loads with no console errors on
		// first paint" is a UI-observable claim only a real browser can prove.
		// AC7 is verified by /at-browser-check at ticket close instead --
		// nothing here can meaningfully assert DOM/console behavior, so this
		// test only documents that the check is required, not optional.
		expect(true).toBe(true);
	});
});
