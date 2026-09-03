// T-1015-3: failing test stubs for route migration onto the new
// panel/workspace model. Per project convention there is no Svelte
// component-render harness (see T-1015-3's Solution Approach), so these
// stubs inspect route source text statically rather than mounting
// components -- the same technique the ticket's AC8 implies ("no route
// imports the legacy tool builder, legacy engine client, or legacy
// workspace store").
//
// Each stub currently throws to fail clearly; the real assertions land
// when T-1015-3 is implemented.

import { describe, it } from 'vitest';

describe('main route renders the new panel/workspace model', () => {
	// spec.md "Route migration / Happy path"
	it('reads no legacy workspace state', () => {
		throw new Error(
			'not implemented: T-1015-3 -- read src/routes/+page.svelte source and assert it ' +
				"does not import '../lib/workspace/store' or '../lib/workspace/apiEngine'"
		);
	});

	it('does not import the legacy tool builder', () => {
		throw new Error(
			"not implemented: T-1015-3 AC8 -- +page.svelte does not import '../lib/webmcp/tools'"
		);
	});
});

describe('WebMCP status header on the migrated route', () => {
	// spec.md "Route migration / Status header"
	it('reports the new surface defined tool count, available tool count, and bridge state', () => {
		throw new Error(
			'not implemented: T-1015-3 AC2 -- buildWebmcpStatus is fed the new tool list, not ' +
				'the legacy 11-tool list'
		);
	});
});

describe('surviving capabilities are reachable from the migrated route', () => {
	// spec.md "Route migration / Surviving capability"
	it('exposes every capability T-1015-2 marked surviving and UI-observable', () => {
		throw new Error(
			'not implemented: T-1015-3 AC4 -- cross-check capability-parity-matrix.md rows ' +
				"marked 'match' or accepted-partial against what the migrated route renders"
		);
	});

	it('flips *_TOOLS_ENABLED flags for capabilities confirmed surviving', () => {
		throw new Error(
			'not implemented: T-1015-3 -- re-verify current flag values (SCREENER_TOOLS_ENABLED ' +
				'etc.) at implementation time and flip any still false for an accepted-surviving ' +
				'capability'
		);
	});
});

describe('throwaway scaffolding is removed', () => {
	// spec.md "Route migration / Throwaway scaffolding"
	it('deletes src/routes/spike/ and nothing links to it', () => {
		throw new Error(
			'not implemented: T-1015-3 AC5 -- src/routes/spike/+page.svelte no longer exists and ' +
				'no route contains a link to /spike'
		);
	});

	it('resolves the manual tool harness route decisively', () => {
		throw new Error(
			'not implemented: T-1015-3 AC6 -- src/routes/dev/+page.svelte is either migrated to ' +
				'the new tool registry or removed outright; not left half-migrated'
		);
	});
});

describe('production build succeeds on the migrated route', () => {
	// T-1015-3 AC7
	it('loads with no console errors on first paint', () => {
		throw new Error(
			'not implemented: T-1015-3 AC7 -- verified via browser check at ticket close per ' +
				'project convention, not a vitest assertion; this stub tracks that the check happens'
		);
	});
});
