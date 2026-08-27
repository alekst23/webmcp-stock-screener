import { buildTools } from './tools';
import type { ModelContext, ResearchEngine, ToolResult, ToolSpec } from './types';

export interface WebmcpConnection {
	refresh(): Promise<void>;
	registeredNames(): string[];
}

// Registers the tool surface against document.modelContext and keeps it in
// sync with workspace state: tools appear as the workflow unlocks them
// (measure only once an instance set exists, focusInstance only once a panel
// exists) and retire if their prerequisites go away.
export async function connectWebmcp(engine: ResearchEngine): Promise<WebmcpConnection | null> {
	const mc = document.modelContext;
	if (!mc) {
		return null;
	}
	return connect(mc, engine);
}

async function connect(mc: ModelContext, engine: ResearchEngine): Promise<WebmcpConnection> {
	const specs = buildTools(engine);
	const registered = new Set<string>();

	async function refresh(): Promise<void> {
		const ws = await engine.getWorkspace();
		for (const spec of specs) {
			const wanted = spec.available(ws);
			if (wanted && !registered.has(spec.name)) {
				await mc.registerTool(toDescriptor(mc, spec, refresh));
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

function toDescriptor(mc: ModelContext, spec: ToolSpec, sync: () => Promise<void>) {
	return {
		name: spec.name,
		description: spec.description,
		inputSchema: spec.inputSchema,
		execute: async (input: unknown): Promise<ToolResult> => {
			const result = await spec.execute(input);
			// A tool's side effects can unlock or retire other tools.
			await sync();
			return result;
		}
	};
}
