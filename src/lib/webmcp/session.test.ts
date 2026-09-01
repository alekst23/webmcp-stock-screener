import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBridgeSession } from './session';
import { clearModelContext, fakeBridge } from './testSupport';
import { createApiEngine } from '../workspace/apiEngine';
import { createWorkspaceStore } from '../workspace/store';
import { memoryStorage } from '../workspace/testSupport';
import type { WebmcpBridgeState } from './status';
import type { ResearchEngine } from './types';

function engine(): ResearchEngine {
	return createApiEngine(createWorkspaceStore(memoryStorage()), {
		baseUrl: 'http://localhost:8000'
	});
}

// Every promise in the connect/dispose chain is a microtask, so one macrotask
// boundary drains all of them -- including the ones queued while draining.
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Recorder {
	states: WebmcpBridgeState[];
	tools: string[][];
}

function recorder(): Recorder {
	return { states: [], tools: [] };
}

// hotfix/webmcp-bridge-status: this mapping is what decides whether the page
// tells an agent the truth about callability, and it had zero coverage while
// it lived inside +page.svelte's onMount.
describe('startBridgeSession bridge state mapping', () => {
	afterEach(() => {
		clearModelContext();
		vi.restoreAllMocks();
	});

	it('reports connecting synchronously, before the connect can possibly resolve', () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;
		const seen = recorder();

		const stop = startBridgeSession(
			engine(),
			undefined,
			(state) => seen.states.push(state),
			(names) => seen.tools.push(names)
		);
		stop();

		expect(
			seen.states,
			'the first state a mount reports must be connecting, never connected'
		).toEqual(['connecting']);
	});

	// The page installs its own bridge when the browser has none, so there is
	// no browser-capability state left to report. A session that went looking
	// for one and settled on "unavailable" is the regression this replaces.
	it('reports connected on a browser that supplies no bridge of its own', async () => {
		clearModelContext();
		const seen = recorder();

		startBridgeSession(
			engine(),
			undefined,
			(state) => seen.states.push(state),
			(names) => seen.tools.push(names)
		);
		await settle();

		expect(
			seen.states,
			`no browser may be reported as unsupported, got: ${seen.states.join(' -> ')}`
		).toEqual(['connecting', 'connected']);
		expect(
			seen.tools.at(-1)?.length ?? 0,
			'connected must mean tools actually landed on the page-installed bridge'
		).toBeGreaterThan(0);
	});

	it('reports connected and the registered names when a bridge accepts the tools', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;
		const seen = recorder();

		startBridgeSession(
			engine(),
			undefined,
			(state) => seen.states.push(state),
			(names) => seen.tools.push([...names])
		);
		await settle();

		expect(
			seen.states,
			`a resolved connection is "connected", got: ${seen.states.join(' -> ')}`
		).toEqual(['connecting', 'connected']);
		expect(
			seen.tools[seen.tools.length - 1]!.sort(),
			'the reported names must be what is actually on the bridge'
		).toEqual([...bridge.registered.keys()].sort());
	});

	it('reports failed and clears the available names when registration rejects', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const bridge = fakeBridge({
			onRegister: (name) => {
				throw new Error(`registration refused for ${name}`);
			}
		});
		document.modelContext = bridge.mc;
		const seen = recorder();

		startBridgeSession(
			engine(),
			undefined,
			(state) => seen.states.push(state),
			(names) => seen.tools.push([...names])
		);
		await settle();

		expect(
			seen.states,
			`a rejection is "failed", distinct from "unavailable", got: ${seen.states.join(' -> ')}`
		).toEqual(['connecting', 'failed']);
		expect(
			seen.tools[seen.tools.length - 1],
			'a failed connect leaves nothing callable, so the count must go to zero'
		).toEqual([]);
		// spec.md's "with a readable reason": the header has one clause, so the
		// underlying error goes to the console rather than being discarded.
		expect(logged, 'the underlying error must reach the console for diagnosis').toHaveBeenCalled();
	});
});

describe('startBridgeSession teardown', () => {
	afterEach(() => {
		clearModelContext();
		vi.restoreAllMocks();
	});

	it('disposes a connection that arrives after cleanup already ran', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;
		const seen = recorder();

		const stop = startBridgeSession(
			engine(),
			undefined,
			(state) => seen.states.push(state),
			(names) => seen.tools.push([...names])
		);
		stop();
		await settle();

		expect(
			[...bridge.registered.keys()],
			'a connection arriving after unmount must be torn down, not leaked onto the bridge'
		).toEqual([]);
		expect(
			seen.states,
			`an unmounted session must not report connected, got: ${seen.states.join(' -> ')}`
		).toEqual(['connecting']);
	});

	it('disposes exactly once when cleanup runs after the connect resolved', async () => {
		const bridge = fakeBridge();
		document.modelContext = bridge.mc;
		const seen = recorder();

		const stop = startBridgeSession(
			engine(),
			undefined,
			(state) => seen.states.push(state),
			(names) => seen.tools.push([...names])
		);
		await settle();
		const liveBefore = bridge.registered.size;
		stop();
		await settle();

		expect(liveBefore, 'sanity: the session registered tools before cleanup').toBeGreaterThan(0);
		expect([...bridge.registered.keys()], 'cleanup must clear the bridge').toEqual([]);
		expect(
			bridge.unregisterCalls.length,
			`each tool must be unregistered once, got: ${bridge.unregisterCalls.join(', ')}`
		).toBe(bridge.registerCalls.length);
	});
});
