// T-1015-9: failing test stubs for the new shared shell and URL
// consolidation. Per project convention there is no Svelte
// component-render harness (see T-1015-3's Solution Approach), so shell
// markup/composition stubs inspect source text statically rather than
// mounting components; the WebMCP status wrapper's state machine is pure
// logic and gets real unit coverage once implemented.
//
// Each stub currently throws to fail clearly; the real assertions land
// when T-1015-9 is implemented.

import { describe, it } from 'vitest';

describe('new shell component shows product identity, freshness, and WebMCP status', () => {
	// spec.md "Route migration / Shared shell", "Status header"; T-1015-9 AC1
	it('renders product identity (name/logo) following the terminal-ui-theme visual language', () => {
		throw new Error(
			'not implemented: T-1015-9 AC1 -- WorkbenchShell.svelte renders the product name, ' +
				'styled per docs/design/terminal-ui-theme/spec.md, not by importing AppShell.svelte'
		);
	});

	it('renders a data-freshness indicator', () => {
		throw new Error(
			'not implemented: T-1015-9 AC1 -- shell shows freshness data (source/reuse of ' +
				'workspace/panelStatus.ts pending T-1015-4 confirming the backend endpoint survives)'
		);
	});

	it('reports WebMCP defined tool count, available tool count, and bridge state', () => {
		throw new Error(
			'not implemented: T-1015-9 AC1 -- shell reads the new status wrapper (not ' +
				"webmcp/session.ts's startBridgeSession, which is legacy-ResearchEngine-specific) " +
				'and renders formatDefinedStatus/formatAvailableStatus/formatBridgeStatus output'
		);
	});

	it('is a new component, not a reuse of the legacy AppShell.svelte', () => {
		throw new Error(
			"not implemented: T-1015-9 AC1 -- WorkbenchShell.svelte does not import " +
				"'../../shell/AppShell.svelte'"
		);
	});
});

describe('new WebMCP status wrapper tracks connection state for the new surface', () => {
	// technical.md "WebMCP status wrapper for the new surface (T-1015-9)"
	it('reports connecting before the composition-root registration call resolves', () => {
		throw new Error(
			"not implemented: T-1015-9 -- the wrapper's state starts 'connecting' synchronously, " +
				'before registerWorkbenchComposition() (or its T-1015-3 successor) resolves'
		);
	});

	it('reports connected once registration resolves, and the tool count across every group', () => {
		throw new Error(
			"not implemented: T-1015-9 -- state becomes 'connected' on resolve; toolCount is the " +
				'total ToolSpec count across every registered tool group'
		);
	});

	it('reports failed if the composition-root registration call throws', () => {
		throw new Error(
			"not implemented: T-1015-9 -- state becomes 'failed' on a caught rejection, mirroring " +
				"session.ts's state semantics without reusing its ResearchEngine-shaped body"
		);
	});

	it('available count always equals defined count (progressive availability is a confirmed drop)', () => {
		throw new Error(
			'not implemented: T-1015-9 -- formatAvailableStatus is called with the same toolCount ' +
				'formatDefinedStatus uses, per spec.md Open Question 4'
		);
	});
});

describe('the canonical app URL renders the new panel/workspace model in the shell', () => {
	// spec.md "Route migration / One URL, one surface"; T-1015-9 AC2
	it('the canonical route wraps PanelContainer in the new shell component', () => {
		throw new Error(
			'not implemented: T-1015-9 AC2 -- src/routes/+page.svelte (post T-1015-3) renders ' +
				'WorkbenchShell wrapping PanelContainer'
		);
	});
});

describe('the interim second route no longer exists as a separate surface', () => {
	// spec.md "Route migration / One URL, one surface"; T-1015-9 AC3
	it('either /workbench redirects to the canonical URL or is removed outright', () => {
		throw new Error(
			'not implemented: T-1015-9 AC3 -- src/routes/workbench/+page.svelte no longer renders ' +
				'an independent, unwrapped composition -- check routeMigration.test.ts (T-1015-3) ' +
				'for what T-1015-3 already settled before choosing redirect vs. removal'
		);
	});
});

describe('production build succeeds with no console errors at the canonical URL', () => {
	// T-1015-9 AC4
	it('loads with no console errors on first paint', () => {
		throw new Error(
			'not implemented: T-1015-9 AC4 -- verified via browser check at ticket close per ' +
				'project convention, not a vitest assertion; this stub tracks that the check happens'
		);
	});
});

describe('no visual regression to the panel grid', () => {
	// T-1015-9 AC5
	it('the shell wraps PanelContainer without altering panel rendering', () => {
		throw new Error(
			'not implemented: T-1015-9 AC5 -- verified via browser check comparing panel layout ' +
				'before/after the shell wrap; this stub tracks that the check happens'
		);
	});
});
