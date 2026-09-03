// T-1015-5: the 11-tool legacy WebMCP surface is removed while the
// transport layer keeps serving the new surface. See T-1015-5's Solution
// Approach for the mandatory ok()/fail() extraction and the resolution of
// register.ts/session.ts/status.ts's "absorb, contingent" disposition.
//
// This project has no Node typings (see theme/paletteGuard.test.ts's own
// note), so absence/presence of a source file or an identifier is checked
// via Vite's import.meta.glob(..., { query: '?raw' }) reading real source
// text, the same technique routeMigration.test.ts and paletteGuard.test.ts
// already use -- not a filesystem walk.

import { describe, expect, it } from 'vitest';
import { ok, fail } from './toolResult';
import type { ModelContext, ModelContextToolDescriptor, ToolResult, ToolSpec } from './types';
import typesSource from './types.ts?raw';

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

const THIS_FILE = '/src/lib/webmcp/toolSurfaceRemoval.test.ts';

// Every other .ts source file's text, keyed by path -- excludes this file
// itself, which necessarily names all eleven tools as data.
const OTHER_TS_ENTRIES = Object.entries(TS_SOURCES).filter(([path]) => path !== THIS_FILE);

function fileExists(path: string): boolean {
	return path in TS_SOURCES || path in SVELTE_SOURCES;
}

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
	// spec.md "Tool-surface removal / Happy path". A ToolSpec always declares
	// its name as `name: '<literal>'` (every builder in this codebase does,
	// including the deleted webmcp/tools.ts) -- searching for that exact
	// pattern across every surviving source file is precise enough to rule
	// out both a live registration and an orphaned builder nobody calls.
	it.each(LEGACY_TOOL_NAMES)('%s is not registered with the bridge', (toolName) => {
		const pattern = `name: '${toolName}'`;
		const tsHit = OTHER_TS_ENTRIES.find(([, text]) => text.includes(pattern));
		const svelteHit = Object.entries(SVELTE_SOURCES).find(([, text]) => text.includes(pattern));
		expect(
			tsHit?.[0] ?? svelteHit?.[0],
			`found "${pattern}" in ${tsHit?.[0] ?? svelteHit?.[0]}`
		).toBeUndefined();
	});

	it('tools.ts no longer exists in the codebase', () => {
		expect(fileExists('/src/lib/webmcp/tools.ts')).toBe(false);
	});
});

describe('shared module split: transport types survive, product types do not', () => {
	// spec.md "Tool-surface removal / Shared module". Type-only symbols have
	// no runtime representation, so absence is proven by scanning types.ts's
	// own raw source for the identifier; presence is proven by constructing
	// real values against the surviving types -- if either was missing, this
	// file would fail to typecheck (AC7 covers that gate separately).
	it('ModelContext, ModelContextToolDescriptor, ToolResult, ToolSpec remain importable', () => {
		const result: ToolResult = { content: [{ type: 'text', text: 'probe' }] };
		const spec: ToolSpec = {
			name: 'probe_tool',
			description: 'probe',
			inputSchema: { type: 'object', properties: {} },
			available: () => true,
			execute: async () => result
		};
		const descriptor: ModelContextToolDescriptor = {
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		};
		const mc: ModelContext = { registerTool: async () => {} };

		expect(spec.available()).toBe(true);
		expect(descriptor.name).toBe('probe_tool');
		expect(typeof mc.registerTool).toBe('function');
	});

	it('WorkspaceState, StudySummary, and the per-tool Input types are removed', () => {
		const removedIdentifiers = [
			'WorkspaceState',
			'StudySummary',
			'SetupStep',
			'SetupSummary',
			'InstanceEvent',
			'InstanceSetSummary',
			'PanelSummary',
			'FocusState',
			'ResearchEngine',
			'FUNCTION_CATALOG',
			'ExpressionError',
			'DefineStudyInput',
			'DefineSetupInput',
			'FindInstancesInput',
			'SampleInstancesInput',
			'MeasureInput',
			'MeasureResult',
			'SplitInstancesInput',
			'ShowGridInput',
			'ShowTickerChartsInput',
			'FocusInstanceInput'
		];
		// A declaration pattern, not a bare substring search -- types.ts's own
		// header comment names several of these identifiers to explain what
		// moved where, which is legitimate history, not a surviving symbol.
		const declarationPattern = (identifier: string): RegExp =>
			new RegExp(`\\b(interface|type|class|const)\\s+${identifier}\\b`);
		for (const identifier of removedIdentifiers) {
			expect(
				declarationPattern(identifier).test(typesSource),
				`types.ts still declares the removed product type "${identifier}"`
			).toBe(false);
		}
	});

	it('ok() and fail() are extracted before tools.ts deletion and remain importable', () => {
		const okResult = ok({ a: 1 });
		expect(okResult.isError).toBeFalsy();
		expect(okResult.content[0]!.text).toContain('"a": 1');

		const failResult = fail('bad input', { field: 'x' });
		expect(failResult.isError).toBe(true);
		expect(failResult.content[0]!.text).toContain('bad input');

		// The 19+ new-surface files the inventory found importing ok/fail from
		// the deleted webmcp/tools.ts must all resolve against this module now.
		const stillImportsFromDeletedTools = OTHER_TS_ENTRIES.filter(([, text]) =>
			/from ['"].*webmcp\/tools['"]/.test(text)
		);
		expect(
			stillImportsFromDeletedTools.map(([path]) => path),
			'no source file may still import from the deleted webmcp/tools module'
		).toEqual([]);
	});
});

describe('transport modules survive and keep serving the new tool surface', () => {
	// spec.md "Tool-surface removal / Transport preserved". Resolving the
	// "absorb, contingent" disposition (Solution Approach): newSurfaceSession.ts
	// (T-1015-3) verifiably does not reuse register.ts's connectWebmcp or
	// session.ts's startBridgeSession -- both are ResearchEngine-shaped and
	// implement per-tool progressive availability, which the capability-parity
	// check confirmed as a structural drop (every new-surface tool group
	// registers unconditionally in one pass). With zero live callers left,
	// both retire here rather than being kept unused. bridge.ts and status.ts
	// have real, current importers on the new surface (newSurfaceSession.ts,
	// WorkbenchShell.svelte, every tool group's ensureModelContext() call) and
	// survive.
	it('bridge.ts and status.ts still exist', () => {
		expect(fileExists('/src/lib/webmcp/bridge.ts')).toBe(true);
		expect(fileExists('/src/lib/webmcp/status.ts')).toBe(true);
	});

	it('register.ts and session.ts are retired: nothing on the new surface reused their diffing or state machine', () => {
		expect(
			fileExists('/src/lib/webmcp/register.ts'),
			'register.ts had zero live callers outside the deleted legacy chain'
		).toBe(false);
		expect(
			fileExists('/src/lib/webmcp/session.ts'),
			'session.ts had zero live callers outside the deleted legacy chain'
		).toBe(false);
	});

	it('register.ts no longer imports buildTools or ResearchEngine directly', () => {
		// AC5 is satisfied vacuously: the module that carried that coupling
		// (connectWebmcp) retired along with the legacy engine it existed to
		// serve, rather than being re-pointed to take a ToolSpec[] and engine
		// as parameters.
		expect(fileExists('/src/lib/webmcp/register.ts')).toBe(false);
	});

	it('remount-generation ownership and best-effort dispose semantics are unweakened', () => {
		// register.test.ts's coverage of the T-1006 bug fix (a slow-resolving
		// old mount must not unregister a newer mount's names; a bridge without
		// unregisterTool must not report a teardown that did not happen) is not
		// weakened -- it retired because the mechanism it protected (per-tool
		// unregister/remount) no longer exists anywhere live. Every new-surface
		// tool group registers once, statically, and never calls
		// unregisterTool -- verified here rather than assumed, so the bug class
		// genuinely has no surface to regress on.
		// `.unregisterTool(` is an actual invocation (register.ts's own former
		// call sites looked exactly like this); `unregisterTool:`/`unregisterTool?(`
		// are the ModelContext interface's declaration and bridge.ts's
		// implementation, which legitimately survive and must not trip this.
		const callsUnregisterTool = OTHER_TS_ENTRIES.filter(
			([path, text]) => !path.endsWith('.test.ts') && text.includes('.unregisterTool(')
		);
		expect(
			callsUnregisterTool.map(([path]) => path),
			'no live (non-test) module may call unregisterTool now that register.ts is gone'
		).toEqual([]);
	});
});

describe('legacy-only tests are deleted, not skipped', () => {
	// spec.md "Tool-surface removal / Legacy-only test"
	it('tools.test.ts and integration.test.ts no longer exist', () => {
		expect(fileExists('/src/lib/webmcp/tools.test.ts')).toBe(false);
		expect(fileExists('/src/lib/webmcp/integration.test.ts')).toBe(false);
	});

	it('no surviving test asserts on a removed tool name', () => {
		// A genuine assertion on a legacy tool name needs it as a quoted string
		// literal (as fixture data or an expected value) -- a bare-word
		// occurrence like "a volatility measure" or a historical comment
		// explaining why a flag is off is not an assertion on the tool.
		const offenders: { path: string; name: string }[] = [];
		for (const [path, text] of OTHER_TS_ENTRIES) {
			if (!path.endsWith('.test.ts')) {
				continue;
			}
			for (const name of LEGACY_TOOL_NAMES) {
				if (text.includes(`'${name}'`) || text.includes(`"${name}"`)) {
					offenders.push({ path, name });
				}
			}
		}
		expect(
			offenders,
			`quoted legacy tool names found in surviving tests: ${JSON.stringify(offenders)}`
		).toEqual([]);
	});
});
