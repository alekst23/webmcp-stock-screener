import type { Writable } from 'svelte/store';
import { buildTools } from './tools';
import { summarizeToolCall, type AgentActivityEvent } from '../workspace/activity';
import type { ModelContext, ResearchEngine, ToolResult, ToolSpec } from './types';

export interface WebmcpConnection {
	refresh(): Promise<void>;
	registeredNames(): string[];
}

// Registers the tool surface against document.modelContext and keeps it in
// sync with workspace state: tools appear as the workflow unlocks them
// (measure only once an instance set exists, focusInstance only once a panel
// exists) and retire if their prerequisites go away. `activity` is where
// every call gets logged (AC4's running feed) -- optional so callers that
// don't render a feed (there are none left after this ticket, but nothing
// else here depends on it existing) aren't forced to construct one.
export async function connectWebmcp(
	engine: ResearchEngine,
	activity?: Writable<AgentActivityEvent[]>
): Promise<WebmcpConnection | null> {
	const mc = document.modelContext;
	if (!mc) {
		return null;
	}
	return connect(mc, engine, activity);
}

async function connect(
	mc: ModelContext,
	engine: ResearchEngine,
	activity?: Writable<AgentActivityEvent[]>
): Promise<WebmcpConnection> {
	const specs = buildTools(engine);
	const registered = new Set<string>();
	let nextActivityId = 1;

	function recordActivity(spec: ToolSpec, input: unknown, result: ToolResult): void {
		activity?.update((events) => [
			...events,
			{
				id: `activity_${nextActivityId++}`,
				toolName: spec.name,
				timestamp: new Date().toISOString(),
				input,
				summary: summarizeToolCall(spec.name, result)
			}
		]);
	}

	async function refresh(): Promise<void> {
		const ws = await engine.getWorkspace();
		for (const spec of specs) {
			const wanted = spec.available(ws);
			if (wanted && !registered.has(spec.name)) {
				await mc.registerTool(toDescriptor(spec, refresh, recordActivity));
				registered.add(spec.name);
			} else if (!wanted && registered.has(spec.name)) {
				// The draft spec's unregistration story is still settling; guard the call.
				await mc.unregisterTool?.(spec.name);
				registered.delete(spec.name);
			}
		}
	}

	await refresh();
	return { refresh, registeredNames: () => [...registered] };
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
