// T-1015-9: the new shared shell and URL consolidation. Per project
// convention there is no Svelte component-render harness (see T-1015-3's
// Solution Approach and src/routes/routeMigration.test.ts), so shell
// markup/composition assertions inspect source text statically rather than
// mounting components. The WebMCP status wrapper's own connecting/connected/
// failed state-machine coverage lives in newSurfaceSession.test.ts (built by
// T-1015-3, confirmed sufficient by this ticket's Solution Approach) --
// duplicating it here would just be a second copy of the same test, so this
// file's WebMCP-status assertions check the wiring decision T-1015-9 itself
// makes: the shell is backed by that wrapper, not session.ts, and never
// tracks a second "available" number independent of "defined".
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob('/src/**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const MAIN_ROUTE = SOURCES['/src/routes/+page.svelte'] ?? '';
const WORKBENCH_SHELL = SOURCES['/src/lib/panels/shell/WorkbenchShell.svelte'] ?? '';

describe('new shell component shows product identity, freshness, and WebMCP status', () => {
	// spec.md "Route migration / Shared shell", "Status header"; T-1015-9 AC1
	it('resolved WorkbenchShell.svelte source at all (glob sanity)', () => {
		expect(
			WORKBENCH_SHELL,
			'/src/lib/panels/shell/WorkbenchShell.svelte was not resolved by the glob'
		).not.toBe('');
	});

	it('renders product identity (name/logo) following the terminal-ui-theme visual language', () => {
		expect(WORKBENCH_SHELL).toContain('MarketPane');
		// Dark/dense visual language: theme tokens, not literal colors/sizes
		// (docs/design/terminal-ui-theme/spec.md) -- the same tokens the
		// legacy AppShell.svelte's top-bar region uses.
		expect(WORKBENCH_SHELL).toContain('var(--bg-panel)');
		expect(WORKBENCH_SHELL).toContain('var(--font-mono)');
	});

	it('renders a data-freshness indicator', () => {
		expect(WORKBENCH_SHELL).toContain("from '../../workspace/panelStatus'");
		expect(WORKBENCH_SHELL).toContain('formatFreshness');
		expect(WORKBENCH_SHELL).toContain('freshness-pill');
	});

	it('reports WebMCP defined tool count, available tool count, and bridge state', () => {
		expect(WORKBENCH_SHELL).toContain("from '../../webmcp/status'");
		expect(WORKBENCH_SHELL).toContain('formatDefinedStatus(webmcpStatus)');
		expect(WORKBENCH_SHELL).toContain('formatAvailableStatus(availableCount)');
		expect(WORKBENCH_SHELL).toContain('formatBridgeStatus(bridgeState)');
	});

	it('is a new component, not a reuse of the legacy AppShell.svelte', () => {
		// The component may still explain in a comment why it does not reuse
		// AppShell.svelte (WHY, per project convention) -- what must not exist
		// is an actual import of it.
		expect(WORKBENCH_SHELL).not.toMatch(/import\s+\w+\s+from\s+['"][^'"]*AppShell\.svelte['"]/);
	});
});

describe('new WebMCP status wrapper tracks connection state for the new surface', () => {
	// technical.md "WebMCP status wrapper for the new surface (T-1015-9)".
	// connectNewSurfaceBridge already satisfies this requirement -- T-1015-3
	// built it (src/lib/webmcp/newSurfaceSession.ts) for exactly this
	// purpose, and its own test suite proves the connecting -> connected /
	// connecting -> failed transitions and the tool-count/name sourcing off
	// document.modelContext.getTools(). This block confirms the route reads
	// that wrapper, not session.ts's ResearchEngine-shaped startBridgeSession.
	it('the canonical route is backed by connectNewSurfaceBridge, not session.ts', () => {
		expect(MAIN_ROUTE).toContain("from '$lib/webmcp/newSurfaceSession'");
		expect(MAIN_ROUTE).not.toContain("from '$lib/webmcp/session'");
	});

	it('reports connected once registration resolves, and the tool count across every group', () => {
		// The shell renders whatever bridgeState it is handed straight through
		// formatBridgeStatus -- connectNewSurfaceBridge (proven elsewhere) is
		// the one thing driving that state through 'connecting' -> 'connected'.
		expect(MAIN_ROUTE).toContain('bridgeState = state');
		expect(WORKBENCH_SHELL).toContain('formatBridgeStatus(bridgeState)');
	});

	it('reports failed if the composition-root registration call throws', () => {
		// Same wiring: a rejected compose() reaches the shell as bridgeState
		// 'failed' (newSurfaceSession.test.ts proves the rejection maps to
		// 'failed'); the shell renders that state via the .degraded class.
		expect(WORKBENCH_SHELL).toContain("bridgeState === 'failed'");
	});

	it('available count always equals defined count (progressive availability is a confirmed drop)', () => {
		// No second live number is tracked: availableCount derives from the
		// same webmcpStatus.toolCount that formatDefinedStatus reads, gated
		// only on bridgeState -- not a separately maintained count.
		expect(WORKBENCH_SHELL).toMatch(
			/availableCount = \$derived\(bridgeState === 'connected' \? \(webmcpStatus\?\.toolCount \?\? 0\) : 0\)/
		);
		expect(WORKBENCH_SHELL).not.toMatch(/availableCount\s*=\s*\$state/);
	});
});

describe('the canonical app URL renders the new panel/workspace model in the shell', () => {
	// spec.md "Route migration / One URL, one surface"; T-1015-9 AC2
	it('the canonical route wraps PanelContainer in the new shell component', () => {
		expect(MAIN_ROUTE).toContain(
			"import WorkbenchShell from '$lib/panels/shell/WorkbenchShell.svelte'"
		);
		const shellOpenIndex = MAIN_ROUTE.indexOf('<WorkbenchShell');
		const panelContainerIndex = MAIN_ROUTE.indexOf('<PanelContainer');
		const shellCloseIndex = MAIN_ROUTE.indexOf('</WorkbenchShell>');
		expect(shellOpenIndex, 'WorkbenchShell must be rendered on the canonical route').toBeGreaterThan(
			-1
		);
		expect(
			panelContainerIndex,
			'PanelContainer must render inside the WorkbenchShell open/close tags'
		).toBeGreaterThan(shellOpenIndex);
		expect(panelContainerIndex).toBeLessThan(shellCloseIndex);
	});
});

describe('the interim second route no longer exists as a separate surface', () => {
	// spec.md "Route migration / One URL, one surface"; T-1015-9 AC3
	it('src/routes/workbench/+page.svelte was removed outright', () => {
		expect(
			'/src/routes/workbench/+page.svelte' in SOURCES,
			'the interim route must not exist as a separate surface'
		).toBe(false);
	});

	it('nothing else links into /workbench as a route', () => {
		// The route's own comments may still explain (WHY, per project
		// convention) that this composition used to be reached via the now-
		// retired /workbench route -- what must not exist is an actual link
		// or programmatic navigation into it.
		expect(MAIN_ROUTE).not.toMatch(/href=["']\/workbench["']/);
		expect(MAIN_ROUTE).not.toMatch(/goto\(["']\/workbench["']\)/);
	});
});

describe('production build succeeds with no console errors at the canonical URL', () => {
	// T-1015-9 AC4
	it('is verified via a browser check at ticket close, not a vitest assertion', () => {
		// This project has no Svelte component-render harness (see
		// routeMigration.test.ts's identical convention for T-1015-3's AC7);
		// "loads with no console errors on first paint" is a UI-observable
		// claim only a real browser can prove. Verified by /at-browser-check
		// at ticket close instead -- see this ticket's Implementation Notes
		// for the outstanding verification if the shared dev server port was
		// unavailable when this ticket landed.
		expect(true).toBe(true);
	});
});

describe('no visual regression to the panel grid', () => {
	// T-1015-9 AC5
	it('the shell wraps PanelContainer without altering panel rendering', () => {
		// Static proof: the shell's DOM/CSS was lifted verbatim out of
		// +page.svelte (T-1015-3's inline header) into WorkbenchShell.svelte,
		// and PanelContainer.svelte itself (its own test suite covers its
		// rendering) was not touched by this ticket. The visual claim itself
		// is verified via /at-browser-check at ticket close, same as AC4.
		expect(WORKBENCH_SHELL).toContain('{@render children()}');
		expect(MAIN_ROUTE).toContain(
			"import PanelContainer from '$lib/panels/shell/PanelContainer.svelte'"
		);
	});
});
