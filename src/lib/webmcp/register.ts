import type { Writable } from 'svelte/store';
import { buildTools } from './tools';
import { recordAction, type AgentActivityEvent } from '../workspace/activity';
import type { ModelContext, ResearchEngine, ToolResult, ToolSpec } from './types';

export interface WebmcpConnection {
	refresh(): Promise<void>;
	registeredNames(): string[];
	// Unregisters everything this connection registered. Safe to call twice.
	dispose(): Promise<void>;
}

// Registers the tool surface against document.modelContext and keeps it in
// sync with workspace state: tools appear as the workflow unlocks them
// (measure only once an instance set exists, focusInstance only once a panel
// exists) and retire if their prerequisites go away. `activity` is where
// every call gets logged (AC4's running feed) -- optional so callers that
// don't render a feed (there are none left after this ticket, but nothing
// else here depends on it existing) aren't forced to construct one.
// `onToolsChanged` surfaces the registration set every time it changes, so the
// page header's live "N available" count tracks tools unlocking and retiring
// mid-session instead of showing a one-time snapshot.
export async function connectWebmcp(
	engine: ResearchEngine,
	activity?: Writable<AgentActivityEvent[]>,
	onToolsChanged?: (names: string[]) => void
): Promise<WebmcpConnection | null> {
	const mc = document.modelContext;
	if (!mc) {
		return null;
	}
	return connect(mc, engine, activity, onToolsChanged);
}

async function connect(
	mc: ModelContext,
	engine: ResearchEngine,
	activity?: Writable<AgentActivityEvent[]>,
	onToolsChanged?: (names: string[]) => void
): Promise<WebmcpConnection> {
	const specs = buildTools(engine);
	const registered = new Set<string>();
	let notified = false;

	function recordActivity(spec: ToolSpec, input: unknown, result: ToolResult): void {
		recordAction(activity, 'agent', spec.name, input, result);
	}

	async function refresh(): Promise<void> {
		const ws = await engine.getWorkspace();
		let changed = false;
		for (const spec of specs) {
			const wanted = spec.available(ws);
			if (wanted && !registered.has(spec.name)) {
				await mc.registerTool(toDescriptor(spec, refresh, recordActivity));
				registered.add(spec.name);
				changed = true;
			} else if (!wanted && registered.has(spec.name)) {
				// The draft spec's unregistration story is still settling; guard the call.
				await mc.unregisterTool?.(spec.name);
				registered.delete(spec.name);
				changed = true;
			}
		}
		// The first refresh always reports, even if it registered nothing, so the
		// caller can distinguish "connected with zero tools" from "never heard back".
		if (changed || !notified) {
			notified = true;
			onToolsChanged?.([...registered]);
		}
	}

	// A remount closes over a fresh `registered` set while document.modelContext
	// keeps the previous mount's registrations, so without this the second mount
	// re-registers everything against a bridge that already has it.
	async function dispose(): Promise<void> {
		for (const name of [...registered]) {
			await mc.unregisterTool?.(name);
			registered.delete(name);
		}
	}

	await refresh();
	return { refresh, registeredNames: () => [...registered], dispose };
}

function toDescriptor(
	spec: ToolSpec,
	sync: () => Promise<void>,
	recordActivity: (spec: ToolSpec, input: unknown, result: ToolResult) => void
) {
	return {
		name: spec.name,
		description: spec.description,
		inputSchema: spec.inputSchema,
		execute: async (input: unknown): Promise<ToolResult> => {
			const result = await spec.execute(input);
			recordActivity(spec, input, result);
			// A tool's side effects can unlock or retire other tools.
			await sync();
			return result;
		}
	};
}
