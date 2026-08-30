// T-1001-2 platform spike: a single, throwaway WebMCP tool proving an
// agent-invoked execute() can reach a real, separately-running FastAPI
// backend over HTTP and return data sourced from that backend's mock
// dataset. NOT one of the 9 product tools (see ./tools.ts) -- do not extend
// this file; it is superseded once T-1001-5 wires the real networked tool
// surface against a proper ResearchEngine/fetch client.
import type { ModelContext, ToolResult } from './types';

// Hardcoded on purpose: this spike only needs to prove `fetch()` reaches a
// separate local process, not a configurable deploy target (that's
// T-1001-5/T-1001-8's PUBLIC_API_BASE_URL). See backend/main.py for the
// server this points at (`uv run uvicorn main:app --reload` from backend/).
const SPIKE_BACKEND_URL = 'http://localhost:8000/api/spike/ping';

export interface SpikePingSample {
	ticker: string;
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface SpikePingResponse {
	message: string;
	sample: SpikePingSample;
}

// Real network call -- no mock/hardcoded response -- against the locally
// running backend (T-1001-2 AC3/AC4).
export async function spikePing(): Promise<SpikePingResponse> {
	const response = await fetch(SPIKE_BACKEND_URL);
	if (!response.ok) {
		throw new Error(`spike backend returned ${response.status}: ${await response.text()}`);
	}
	return (await response.json()) as SpikePingResponse;
}

async function execute(): Promise<ToolResult> {
	try {
		const data = await spikePing();
		return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
			isError: true
		};
	}
}

// Registers the spike tool against document.modelContext, per the
// feature-detect pattern in docs/reference/webmcp-guide.md. Returns false
// (without throwing) when the current browser has no WebMCP support, so the
// caller can show the human why no tool appeared.
export async function registerSpikeTool(mc: ModelContext | undefined): Promise<boolean> {
	if (!mc) {
		return false;
	}
	await mc.registerTool({
		name: 'spikePing',
		description:
			'T-1001-2 platform spike tool. Calls a live, locally-running FastAPI backend over HTTP ' +
			"and returns one sample OHLCV row read from that backend's mock data panel. Proves a " +
			'WebMCP tool can reach a real, separately-running backend process rather than returning ' +
			'a hardcoded or purely local response.',
		inputSchema: { type: 'object', properties: {} },
		execute
	});
	return true;
}
