import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Writable } from 'svelte/store';
import { connectWebmcp } from './register';
import { clearModelContext, fakeBridge } from './testSupport';
import { createApiEngine } from '../workspace/apiEngine';
import { createWorkspaceStore } from '../workspace/store';
import { memoryStorage } from '../workspace/testSupport';
import type { ResearchEngine, WorkspaceState } from './types';

function workspace(): { store: Writable<WorkspaceState>; engine: ResearchEngine } {
	const store = createWorkspaceStore(memoryStorage());
	return { store, engine: createApiEngine(store, { baseUrl: 'http://localhost:8000' }) };
}

function engine(): ResearchEngine {
	return workspace().engine;
}

// Feature #10 gates sampling/measuring/splitting/grid on an existing result
// set, so putting one in the workspace is what unlocks those tools.
function withInstanceSet(store: Writable<WorkspaceState>): void {
	store.update((ws) => ({
		...ws,
		instanceSets: [
			{
				id: 'set-1',
				setupId: 'setup-1',
				count: 3,
				completeCount: 3,
				partialCount: 0,
				from: '2020-01-01',
				to: '2020-12-31'
			}
		]
	}));
}

function withoutInstanceSets(store: Writable<WorkspaceState>): void {
	store.update((ws) => ({ ...ws, instanceSets: [] }));
}

describe('connectWebmcp bridge detection', () => {
	afterEach(() => {
		clearModelContext();
	});

	// The regression this whole change exists to kill: the page saw no
	// document.modelContext, concluded the browser could not do WebMCP, and
	// advertised 11 tools that nothing could call. It must now supply its own
	// bridge and register against that instead of predicting browser support.
	it('registers the full surface when the browser supplies no bridge of its own', async () => {
		clearModelContext();

		const connection = await connectWebmcp(engine());

		expect(
			connection.registeredNames().length,
			'a browser without WebMCP must still end up with callable tools'
		).toBeGreaterThan(0);
		const tools = await document.modelContext!.getTools!();
		expect(
			tools.map((tool) => tool.name).sort(),
			'the page-installed bridge must expose exactly what the connection reports'
		).toEqual(connection.registeredNames().sort());
	});

	// The page bridge is only useful if an agent can actually invoke through
	// it; registering into a write-only registry would be the same lie in a
	// new place.
	it('executes a tool called through the page-installed bridge', async () => {
		clearModelContext();

		await connectWebmcp(engine());
		const result = await document.modelContext!.executeTool!('defineStudy', {
			name: 'gap',
			expression: 'sma(close, 20)'
		});

		expect(result.isError ?? false, `defineStudy must run, got: ${JSON.stringify(result)}`).toBe(
			false
		);
	});

	// A native bridge must win outright: shadowing it with the page's own
	// would hide the tools from the one browser that can see them natively.
	it('registers against the browser bridge rather than installing its own', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(engine());

		expect(document.modelContext, 'a browser-supplied bridge must not be replaced').toBe(bridge.mc);
		expect(
			[...bridge.registered.keys()].sort(),
			'every tool must land on the browser bridge'
		).toEqual(connection.registeredNames().sort());
	});

	// An extension that injects after this script ran used to leave the tools
	// stranded on the object it replaced, which is the "unavailable in this
	// browser" bug wearing a new hat.
	it('re-registers onto a bridge that is injected after the page installed its own', async () => {
		clearModelContext();

		const connection = await connectWebmcp(engine());
		const registeredOnPageBridge = connection.registeredNames().sort();

		const late = fakeBridge();
		document.modelContext = late.mc;
		await vi.waitFor(() => {
			expect(late.registered.size).toBeGreaterThan(0);
		});

		expect(
			[...late.registered.keys()].sort(),
			'the surface must move onto the bridge that arrived late'
		).toEqual(registeredOnPageBridge);
		expect(
			connection.registeredNames().sort(),
			'the reported set must describe the new bridge, not the abandoned one'
		).toEqual(registeredOnPageBridge);
	});

	it('returns a connection when a bridge is present', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(engine());

		expect(connection, 'a present bridge must produce a connection').not.toBeNull();
		expect(
			connection!.registeredNames().length,
			'a connected bridge must have at least the always-available tools registered'
		).toBeGreaterThan(0);
	});

	// T-1004-2 AC1: a rejection must be distinguishable from "no bridge", so
	// the page can render "failed" rather than "unavailable" or nothing.
	it('propagates a registration failure rather than resolving to null', async () => {
		const bridge = fakeBridge({
			onRegister: (name) => {
				throw new Error(`registration refused for ${name}`);
			}
		});
		document.modelContext = bridge.mc;

		await expect(
			connectWebmcp(engine()),
			'a throwing registerTool must reject, not look like an unsupported browser'
		).rejects.toThrow('registration refused');
	});

	// The interesting half of the failure: the first three tools registered
	// fine and stayed callable on a shared bridge that no handle ever reached,
	// under a header reading "0 available - agent bridge failed to connect".
	it('leaves no orphaned registrations when a later tool fails to register', async () => {
		let attempts = 0;
		const bridge = fakeBridge({
			onRegister: (name) => {
				attempts += 1;
				if (attempts === 4) {
					throw new Error(`registration refused for ${name}`);
				}
			}
		});
		document.modelContext = bridge.mc;

		await expect(connectWebmcp(engine()), 'a partial failure must still reject').rejects.toThrow(
			'registration refused'
		);

		expect(
			[...bridge.registered.keys()],
			'connect must be atomic: tools registered before the failure must not stay callable'
		).toEqual([]);
	});
});

// hotfix/webmcp-bridge-status: the header's live "N available" count needs a
// change signal, not a one-time snapshot -- registration changes as feature
// #10 unlocks and retires tools mid-session.
describe('connectWebmcp live registration signal', () => {
	afterEach(() => {
		clearModelContext();
	});

	it('reports the registered tool names to the caller on connect', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;
		const seen: string[][] = [];

		await connectWebmcp(engine(), undefined, (names) => seen.push([...names]));

		expect(seen.length, 'expected at least one change notification on connect').toBeGreaterThan(0);
		expect(
			seen[seen.length - 1]!.length,
			`last notification should match the bridge's registration count, got: ${JSON.stringify(seen)}`
		).toBe(bridge.registered.size);
	});

	it('reports names matching what was actually registered on the bridge', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;
		let latest: string[] = [];

		await connectWebmcp(engine(), undefined, (names) => {
			latest = [...names];
		});

		expect(
			[...latest].sort(),
			'the reported names must be the names actually on the bridge'
		).toEqual([...bridge.registered.keys()].sort());
	});

	it('fires again when a later refresh unlocks tools', async () => {
		const { store, engine: apiEngine } = workspace();
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;
		const seen: string[][] = [];

		const connection = await connectWebmcp(apiEngine, undefined, (names) => seen.push([...names]));
		const initialCount = seen.length;
		withInstanceSet(store);
		await connection!.refresh();

		expect(
			seen.length,
			`unlocking result-set tools must notify the header, got ${seen.length} notifications`
		).toBeGreaterThan(initialCount);
		expect(
			seen[seen.length - 1]!.length,
			`expected more tools after a result set exists, got: ${seen[seen.length - 1]!.join(', ')}`
		).toBeGreaterThan(seen[initialCount - 1]!.length);
	});

	it('fires again when a later refresh retires tools', async () => {
		const { store, engine: apiEngine } = workspace();
		withInstanceSet(store);
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;
		const seen: string[][] = [];

		const connection = await connectWebmcp(apiEngine, undefined, (names) => seen.push([...names]));
		const unlockedCount = seen[seen.length - 1]!.length;
		withoutInstanceSets(store);
		await connection!.refresh();

		expect(
			seen[seen.length - 1]!.length,
			`retiring must shrink the reported set, got: ${seen[seen.length - 1]!.join(', ')}`
		).toBeLessThan(unlockedCount);
		expect(
			connection!.registeredNames().sort(),
			'the reported set must still match the bridge after a retirement'
		).toEqual([...bridge.registered.keys()].sort());
	});

	it('does not fire on a refresh that changes nothing', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;
		const seen: string[][] = [];

		const connection = await connectWebmcp(engine(), undefined, (names) => seen.push([...names]));
		const afterConnect = seen.length;
		await connection!.refresh();

		expect(seen.length, 'a no-op refresh must not churn the header with an identical set').toBe(
			afterConnect
		);
	});
});

// T-1004-2 AC2. connect() closes over a fresh registered-Set per call while
// document.modelContext keeps the previous mount's registrations, so a
// remount double-registers. Reachable here: ssr is off and / <-> /dev is
// client-side navigation, which unmounts and remounts +page.svelte.
describe('connectWebmcp remount cleanup', () => {
	afterEach(() => {
		clearModelContext();
	});

	it('unregisters every tool it registered when disposed', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(engine());
		const registeredBefore = connection!.registeredNames().length;
		await connection!.dispose();

		expect(
			registeredBefore,
			'the connection must have registered something to tear down'
		).toBeGreaterThan(0);
		expect(bridge.registered.size, 'dispose must leave no tools on the bridge').toBe(0);
		expect(
			[...bridge.unregisterCalls].sort(),
			'every registered name must have been unregistered'
		).toEqual([...bridge.registerCalls].sort());
	});

	// This assertion used to be a tautology: the fake keys registrations by
	// name, so `new Set(names).size === names.length` held even with dispose()
	// neutered (12 register calls, 6 live keys, test green). The bridge now
	// records the duplicate at register time, where it is actually visible.
	it('leaves exactly one registration per tool across a dispose-and-reconnect cycle', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const first = await connectWebmcp(engine());
		const firstCount = first!.registeredNames().length;
		await first!.dispose();
		const second = await connectWebmcp(engine());

		expect(
			bridge.duplicateRegistrations,
			'a remount must not register a name the bridge already holds'
		).toEqual([]);
		expect(
			bridge.registerCalls.length,
			`expected one register call per tool per mount, got: ${bridge.registerCalls.join(', ')}`
		).toBe(firstCount * 2);
		expect(
			bridge.unregisterCalls.length,
			'the first mount must have unregistered everything it registered'
		).toBe(firstCount);
		expect(
			second!.registeredNames().sort(),
			'the second mount must own exactly what is live on the bridge'
		).toEqual([...bridge.registered.keys()].sort());
	});

	it('is safe to dispose twice', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(engine());
		await connection!.dispose();

		await expect(connection!.dispose(), 'a second dispose must be a no-op').resolves.not.toThrow();
	});

	// A descriptor an agent grabbed before unmount stays callable forever. Its
	// execute() syncs, and without a disposed guard that sync re-registered the
	// entire surface against a bridge no live object could ever tear down.
	it('does not resurrect registrations when a stale tool call arrives after dispose', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(engine());
		const stale = bridge.registered.get('getWorkspace');
		await connection!.dispose();
		await stale!.execute({});

		expect(
			[...bridge.registered.keys()],
			'a call on a stale descriptor must not put tools back on the bridge'
		).toEqual([]);
		expect(
			connection!.registeredNames(),
			'a disposed connection must not start reporting tools again'
		).toEqual([]);
	});

	// One rejecting unregisterTool used to abort the loop and strand the rest
	// (verified: 4 tools still live), and both +page.svelte call sites used
	// `void promise.then(...)`, so it surfaced as an unhandled rejection.
	it('keeps tearing down the rest when one unregisterTool rejects', async () => {
		const bridge = fakeBridge({
			onUnregister: (name) => {
				if (name === 'findInstances') {
					throw new Error('boom');
				}
			}
		});
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(engine());
		const registeredBefore = connection!.registeredNames().length;

		await expect(
			connection!.dispose(),
			'teardown is best-effort and must not reject on the caller'
		).resolves.not.toThrow();
		expect(
			[...bridge.registered.keys()],
			'only the tool whose unregisterTool rejected may remain'
		).toEqual(['findInstances']);
		expect(
			connection!.registeredNames(),
			'a tool that could not be unregistered is still callable and must stay reported'
		).toEqual(['findInstances']);
		expect(
			registeredBefore,
			'sanity: the connection registered more than one tool'
		).toBeGreaterThan(1);
	});
});

// types.ts makes ModelContext.unregisterTool optional. `mc.unregisterTool?.()`
// no-oped while the bookkeeping ran anyway, so the page reported a teardown
// that never happened -- and a remount then double-registered (verified: the
// bridge held 12 tools, 6 of them duplicates).
describe('connectWebmcp against a bridge without unregisterTool', () => {
	afterEach(() => {
		clearModelContext();
	});

	it('does not report a disposal it could not perform', async () => {
		const bridge = fakeBridge({ supportsUnregister: false });
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(engine());
		const registeredBefore = connection!.registeredNames();
		await connection!.dispose();

		expect(
			[...bridge.registered.keys()].sort(),
			'nothing can come off a bridge with no unregisterTool'
		).toEqual([...registeredBefore].sort());
		expect(
			connection!.registeredNames().sort(),
			'tools that are still callable must still be reported as registered'
		).toEqual([...registeredBefore].sort());
	});

	it('does not shrink the reported count for a retirement it could not perform', async () => {
		const { store, engine: apiEngine } = workspace();
		withInstanceSet(store);
		const bridge = fakeBridge({ supportsUnregister: false });
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(apiEngine);
		const unlocked = connection!.registeredNames().length;
		withoutInstanceSets(store);
		await connection!.refresh();

		expect(
			bridge.registered.size,
			'sanity: the retire branch cannot actually remove anything here'
		).toBe(unlocked);
		expect(
			connection!.registeredNames().length,
			'the "N available" count must never drop a tool that is still callable'
		).toBe(unlocked);
	});
});

// Two mounts share one document.modelContext and register identical names.
// Without ownership tracking, mount A's late cleanup unregistered by name and
// wiped mount B's live registrations while B still reported 6 available.
describe('connectWebmcp ownership across overlapping mounts', () => {
	afterEach(() => {
		clearModelContext();
	});

	it('does not let a stale mount unregister the tools a newer mount owns', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const stale = await connectWebmcp(engine());
		const live = await connectWebmcp(engine());
		await stale!.dispose();

		expect(
			[...bridge.registered.keys()].sort(),
			'the live mount must keep every tool it registered'
		).toEqual(live!.registeredNames().sort());
		expect(
			bridge.registered.size,
			'the live mount reports tools it must actually still have on the bridge'
		).toBe(live!.registeredNames().length);
	});
});
