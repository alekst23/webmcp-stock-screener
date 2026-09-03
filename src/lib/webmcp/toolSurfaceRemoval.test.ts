// T-1015-5: failing test stubs for removing the legacy 11-tool surface
// while keeping the WebMCP transport layer live. See T-1015-5's Solution
// Approach for the mandatory ok()/fail() extraction and the
// register.ts/session.ts/status.ts "absorb, contingent" disposition.
//
// Each stub currently throws to fail clearly; the real assertions land
// when T-1015-5 is implemented.

import { describe, it } from 'vitest';

const LEGACY_TOOL_NAMES = [
	'defineStudy',
	'defineSetup',
	'findInstances',
	'sampleInstances',
	'measure',
	'splitInstances',
	'showGrid',
	'showTickerCharts',
	'clearPanels',
	'focusInstance',
	'getWorkspace'
];

describe('the 11 legacy tools are gone', () => {
	// spec.md "Tool-surface removal / Happy path"
	it.each(LEGACY_TOOL_NAMES)('%s is not registered with the bridge', (toolName) => {
		throw new Error(`not implemented: T-1015-5 AC1 -- ${toolName} must not be registered`);
	});

	it('tools.ts no longer exists in the codebase', () => {
		throw new Error('not implemented: T-1015-5 AC1 -- src/lib/webmcp/tools.ts is deleted');
	});
});

describe('shared module split: transport types survive, product types do not', () => {
	// spec.md "Tool-surface removal / Shared module"
	it('ModelContext, ModelContextToolDescriptor, ToolResult, ToolSpec remain importable', () => {
		throw new Error(
			'not implemented: T-1015-5 AC3 -- transport types still export from their new home'
		);
	});

	it('WorkspaceState, StudySummary, and the per-tool Input types are removed', () => {
		throw new Error('not implemented: T-1015-5 AC2 -- legacy product types no longer exist');
	});

	it('ok() and fail() are extracted before tools.ts deletion and remain importable', () => {
		throw new Error(
			'not implemented: T-1015-5 -- 19 new-surface files import ok/fail from webmcp/tools; ' +
				'they must resolve against the extracted module after this ticket lands'
		);
	});
});

describe('transport modules survive and keep serving the new tool surface', () => {
	// spec.md "Tool-surface removal / Transport preserved"
	it('bridge.ts, register.ts, session.ts, status.ts still exist', () => {
		throw new Error(
			'not implemented: T-1015-5 AC4 -- transport modules present, either serving the new ' +
				'surface directly or downgraded to retire per the contingency this ticket resolves'
		);
	});

	it('register.ts no longer imports buildTools or ResearchEngine directly', () => {
		throw new Error(
			'not implemented: T-1015-5 AC5 -- registration layer takes a ToolSpec[] and engine as ' +
				'parameters instead of importing the legacy builder'
		);
	});

	it('remount-generation ownership and best-effort dispose semantics are unweakened', () => {
		throw new Error(
			'not implemented: T-1015-5 -- existing register.test.ts coverage for the T-1006 bug ' +
				"fix (slow-resolving old mount must not unregister a newer mount's names) still " +
				'passes'
		);
	});
});

describe('legacy-only tests are deleted, not skipped', () => {
	// spec.md "Tool-surface removal / Legacy-only test"
	it('tools.test.ts and integration.test.ts no longer exist', () => {
		throw new Error(
			'not implemented: T-1015-5 AC6 -- files are deleted, not left as skipped test suites'
		);
	});

	it('no surviving test asserts on a removed tool name', () => {
		throw new Error(
			'not implemented: T-1015-5 AC6 -- grep surviving *.test.ts files for the 11 legacy ' +
				'tool names and assert no match'
		);
	});
});
