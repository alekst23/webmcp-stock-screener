import { afterEach, describe, expect, it } from 'vitest';
import { connectWebmcp } from './register';
import { createApiEngine } from '../workspace/apiEngine';
import { createWorkspaceStore } from '../workspace/store';
import { memoryStorage } from '../workspace/testSupport';
import type { ModelContext, ModelContextToolDescriptor } from './types';

function engine() {
	return createApiEngine(createWorkspaceStore(memoryStorage()), {
		baseUrl: 'http://localhost:8000'
	});
}

interface FakeBridge {
	mc: ModelContext;
	registered: Map<string, ModelContextToolDescriptor>;
	registerCalls: string[];
	unregisterCalls: string[];
}

function fakeBridge(onRegister?: (name: string) => void): FakeBridge {
	const registered = new Map<string, ModelContextToolDescriptor>();
	const registerCalls: string[] = [];
	const unregisterCalls: string[] = [];
	const mc: ModelContext = {
		registerTool: async (tool) => {
			onRegister?.(tool.name);
			registerCalls.push(tool.name);
			registered.set(tool.name, tool);
		},
		unregisterTool: async (name) => {
			unregisterCalls.push(name);
			registered.delete(name);
		}
	};
	return { mc, registered, registerCalls, unregisterCalls };
}

describe('connectWebmcp bridge detection', () => {
	afterEach(() => {
		document.modelContext = undefined;
	});

	// The condition a real agent hit on the deployed site: the page advertised
	// its tools, but there was no bridge object to call them through.
	it('returns null when document.modelContext is absent, so the caller can report "unavailable"', async () => {
		document.modelContext = undefined;

		const connection = await connectWebmcp(engine());

		expect(connection, 'no bridge must be reported as null, not a hollow connection').toBeNull();
	});

	it('returns a connection when a bridge is present', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(engine());

		expect(connection).not.toBeNull();
		expect(connection!.registeredNames().length).toBeGreaterThan(0);
	});

	// T-1004-2 AC1: a rejection must be distinguishable from "no bridge", so
	// the page can render "failed" rather than "unavailable" or nothing.
	it('propagates a registration failure rather than resolving to null', async () => {
		const bridge = fakeBridge((name) => {
			throw new Error(`registration refused for ${name}`);
		});
		document.modelContext = bridge.mc;

		await expect(
			connectWebmcp(engine()),
			'a throwing registerTool must reject, not look like an unsupported browser'
		).rejects.toThrow('registration refused');
	});
});

// hotfix/webmcp-bridge-status: the header's live "N available" count needs a
// change signal, not a one-time snapshot -- registration changes as feature
// #10 unlocks and retires tools mid-session.
describe('connectWebmcp live registration signal', () => {
	afterEach(() => {
		document.modelContext = undefined;
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

		expect([...latest].sort()).toEqual([...bridge.registered.keys()].sort());
	});
});

// T-1004-2 AC2. connect() closes over a fresh registered-Set per call while
// document.modelContext keeps the previous mount's registrations, so a
// remount double-registers. Reachable here: ssr is off and / <-> /dev is
// client-side navigation, which unmounts and remounts +page.svelte.
describe('connectWebmcp remount cleanup', () => {
	afterEach(() => {
		document.modelContext = undefined;
	});

	it('unregisters every tool it registered when disposed', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(engine());
		const registeredBefore = connection!.registeredNames().length;
		await connection!.dispose();

		expect(registeredBefore).toBeGreaterThan(0);
		expect(bridge.registered.size, 'dispose must leave no tools on the bridge').toBe(0);
		expect([...bridge.unregisterCalls].sort()).toEqual([...bridge.registerCalls].sort());
	});

	it('leaves exactly one registration per tool across a dispose-and-reconnect cycle', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const first = await connectWebmcp(engine());
		await first!.dispose();
		const second = await connectWebmcp(engine());

		const names = [...bridge.registered.keys()];
		expect(
			new Set(names).size,
			`expected no duplicate registrations after remount, got: ${names.join(', ')}`
		).toBe(names.length);
		expect(second!.registeredNames().length).toBe(names.length);
	});

	it('is safe to dispose twice', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;

		const connection = await connectWebmcp(engine());
		await connection!.dispose();

		await expect(connection!.dispose()).resolves.not.toThrow();
	});
});
