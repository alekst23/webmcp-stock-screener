import type { Writable } from 'svelte/store';
import { ensureModelContext, onBridgeReplaced } from './bridge';
import { buildTools } from './tools';
import { recordAction, type AgentActivityEvent } from '../workspace/activity';
import type {
	ModelContext,
	ModelContextToolDescriptor,
	ResearchEngine,
	ToolResult,
	ToolSpec
} from './types';

export interface WebmcpConnection {
	refresh(): Promise<void>;
	registeredNames(): string[];
	// Unregisters every tool this connection still owns, best-effort. Safe to
	// call twice. A bridge missing the optional `unregisterTool` cannot retire
	// anything, so those names stay in registeredNames() -- they remain
	// callable, and reporting a teardown that did not happen is the same class
	// of false claim this module exists to avoid.
	dispose(): Promise<void>;
}

// `document.modelContext` is one shared object per document, and every mount
// of this page registers the same tool names against it. Ownership is tracked
// at module scope so a slow-resolving old mount can only unregister names no
// newer mount has since claimed -- otherwise its cleanup would silently wipe
// the live mount's registrations while that mount still reports them as
// available (hotfix/webmcp-bridge-status).
const toolOwners = new Map<string, number>();
let lastGeneration = 0;

interface ConnectionState {
	// Reassigned when a browser bridge arrives after the page installed its
	// own; see adoptBridge.
	mc: ModelContext;
	engine: ResearchEngine;
	activity?: Writable<AgentActivityEvent[]>;
	onToolsChanged?: (names: string[]) => void;
	specs: ToolSpec[];
	// This connection's claim on a shared bridge; see toolOwners.
	generation: number;
	// The draft spec makes unregisterTool optional (types.ts). Captured once so
	// refresh() and dispose() agree on whether a retirement can happen at all.
	unregisterTool?: (name: string) => Promise<void>;
	registered: Set<string>;
	notified: boolean;
	disposed: boolean;
	// Drops this connection's adoptBridge hook on teardown.
	unsubscribeReplacement?: () => void;
}

// Registers the tool surface against document.modelContext -- the browser's
// if it supplied one, otherwise the page's own (bridge.ts) -- and keeps it in
// sync with workspace state: tools appear as the workflow unlocks them
// (measure only once an instance set exists, focusInstance only once a panel
// exists) and retire if their prerequisites go away. `activity` is where
// every call gets logged (AC4's running feed) -- optional so callers that
// don't render a feed (there are none left after this ticket, but nothing
// else here depends on it existing) aren't forced to construct one.
// `onToolsChanged` surfaces the registration set every time it changes, so the
// page header's live "N available" count tracks tools unlocking and retiring
// mid-session instead of showing a one-time snapshot. It always fires at
// least once on connect, even with nothing registered, so the caller can tell
// "connected with zero tools" from "never heard back".
// There is no browser-support check here and must not be one: which browsers
// expose document.modelContext is not knowable from inside the page, and
// guessing wrong suppressed a working tool surface. ensureModelContext always
// yields a bridge, so this never returns null and the caller has no
// "unavailable" case to render.
export async function connectWebmcp(
	engine: ResearchEngine,
	activity?: Writable<AgentActivityEvent[]>,
	onToolsChanged?: (names: string[]) => void
): Promise<WebmcpConnection> {
	return connect(ensureModelContext(), engine, activity, onToolsChanged);
}

async function connect(
	mc: ModelContext,
	engine: ResearchEngine,
	activity?: Writable<AgentActivityEvent[]>,
	onToolsChanged?: (names: string[]) => void
): Promise<WebmcpConnection> {
	const state: ConnectionState = {
		mc,
		engine,
		activity,
		onToolsChanged,
		specs: buildTools(engine),
		generation: ++lastGeneration,
		unregisterTool: mc.unregisterTool?.bind(mc),
		registered: new Set<string>(),
		notified: false,
		disposed: false
	};
	const connection: WebmcpConnection = {
		refresh: () => refresh(state),
		registeredNames: () => [...state.registered],
		dispose: () => dispose(state)
	};

	// A bridge injected mid-connect must not be missed, so this is hooked up
	// before the first registration rather than after it settles.
	state.unsubscribeReplacement = onBridgeReplaced((next) => void adoptBridge(state, next));

	try {
		await connection.refresh();
	} catch (error) {
		// Connect is all-or-nothing. A throw partway through the loop would
		// otherwise leave the earlier tools live on the bridge with no handle
		// ever reaching the caller -- and an agent calling one of those orphans
		// would sync(), re-register the rest, and grow the "N available" count
		// under a header reading "agent bridge failed to connect".
		await connection.dispose().catch(() => {});
		throw error;
	}
	return connection;
}

async function refresh(state: ConnectionState): Promise<void> {
	// A descriptor an agent captured before unmount stays callable, and its
	// execute() syncs; without this guard a stale call would re-register the
	// whole surface against a bridge no live connection can dispose.
	if (state.disposed) {
		return;
	}
	const ws = await state.engine.getWorkspace();
	let changed = false;
	for (const spec of state.specs) {
		const stepped = spec.available(ws) ? await register(state, spec) : await retire(state, spec);
		changed = stepped || changed;
	}
	if (changed || !state.notified) {
		state.notified = true;
		state.onToolsChanged?.([...state.registered]);
	}
}

async function register(state: ConnectionState, spec: ToolSpec): Promise<boolean> {
	if (state.registered.has(spec.name)) {
		return false;
	}
	await state.mc.registerTool(toDescriptor(state, spec));
	state.registered.add(spec.name);
	toolOwners.set(spec.name, state.generation);
	return true;
}

// Retirement only counts when this connection can actually take the tool off
// the bridge: without `unregisterTool`, or once a newer connection owns the
// name, dropping it from `registered` would shrink the visible "N available"
// count while the tool stays callable -- the header would under-report a live
// surface, and `unregisterTool?.()` no-oping made that invisible.
async function retire(state: ConnectionState, spec: ToolSpec): Promise<boolean> {
	if (!state.registered.has(spec.name)) {
		return false;
	}
	if (!state.unregisterTool || toolOwners.get(spec.name) !== state.generation) {
		return false;
	}
	await state.unregisterTool(spec.name);
	toolOwners.delete(spec.name);
	state.registered.delete(spec.name);
	return true;
}

// A remount closes over a fresh `registered` set while document.modelContext
// keeps the previous mount's registrations, so without this the second mount
// re-registers everything against a bridge that already has it.
async function dispose(state: ConnectionState): Promise<void> {
	state.disposed = true;
	state.unsubscribeReplacement?.();
	state.unsubscribeReplacement = undefined;
	if (!state.unregisterTool) {
		// Nothing can come off this bridge, so the tools are still callable and
		// still this connection's; leave them reported rather than claim a
		// teardown that did not happen.
		return;
	}
	for (const name of [...state.registered]) {
		if (toolOwners.get(name) !== state.generation) {
			// A newer mount re-registered this name and owns the live descriptor.
			// Unregistering by name here would wipe a mount that is still up.
			state.registered.delete(name);
			continue;
		}
		try {
			await state.unregisterTool(name);
			toolOwners.delete(name);
			state.registered.delete(name);
		} catch {
			// Best effort: one rejecting unregisterTool must not strand the rest,
			// and the name stays reported because it may well still be live.
		}
	}
}

// A browser bridge that appears after the page installed its own (an
// extension injecting late, a flag-gated bootstrap losing the race to a fast
// static page) has never heard of this connection's tools. Re-register onto
// it rather than leave the surface stranded on the object it replaced --
// that stranding was the original "unavailable in this browser" bug wearing
// a new hat.
async function adoptBridge(state: ConnectionState, mc: ModelContext): Promise<void> {
	if (state.disposed || state.mc === mc) {
		return;
	}
	state.mc = mc;
	state.unregisterTool = mc.unregisterTool?.bind(mc);
	// Ownership restarts: nothing this connection holds exists on the new
	// bridge, so keeping the old names would let a later retire() try to
	// unregister them from a bridge that never had them.
	for (const name of state.registered) {
		if (toolOwners.get(name) === state.generation) {
			toolOwners.delete(name);
		}
	}
	state.registered.clear();
	state.generation = ++lastGeneration;
	// Forces the count callback even if the re-registration lands on the same
	// set of names, so the caller sees the new bridge acknowledged.
	state.notified = false;
	try {
		await refresh(state);
	} catch (error) {
		console.error('WebMCP re-registration onto a newly injected bridge failed', error);
	}
}

function toDescriptor(state: ConnectionState, spec: ToolSpec): ModelContextToolDescriptor {
	return {
		name: spec.name,
		description: spec.description,
		inputSchema: spec.inputSchema,
		execute: async (input: unknown): Promise<ToolResult> => {
			const result = await spec.execute(input);
			recordAction(state.activity, 'agent', spec.name, input, result);
			// A tool's side effects can unlock or retire other tools.
			await refresh(state);
			return result;
		}
	};
}
