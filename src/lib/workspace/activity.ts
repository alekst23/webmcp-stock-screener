import { writable, type Writable } from 'svelte/store';
import type { ToolResult } from '../webmcp/types';

// One entry in the visible agent-activity feed (spec.md's "Progressive
// tool availability" / human-agent collaboration story made observable).
// Populated by register.ts's execute() wrapper on every tool call, in
// call order — this is the trust affordance that lets a human see what
// the agent has been doing without reading raw tool results.
export interface AgentActivityEvent {
	id: string;
	toolName: string;
	// ISO timestamp of the call.
	timestamp: string;
	input: unknown;
	// One-line human-readable summary of the result, not the raw JSON.
	summary: string;
}

// Deliberately its own store rather than a field on WorkspaceState: the
// feed is a human-facing trust affordance (AC4), not shared session state
// an agent needs to read back (unlike focus.selected -- see store.ts's
// selectInstance) or that any tool contract depends on.
export function createActivityStore(): Writable<AgentActivityEvent[]> {
	return writable<AgentActivityEvent[]>([]);
}

export const activityStore = createActivityStore();

function parsePayload(result: ToolResult): unknown {
	const text = result.content.map((c) => c.text).join('');
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

// Turns a raw ToolResult into the one-line human-readable line the feed
// shows -- the feed's whole point is to spare a human from reading raw JSON
// tool payloads to see what the agent did (tools.ts's ok()/fail() helpers
// JSON-stringify every result).
export function summarizeToolCall(toolName: string, result: ToolResult): string {
	const payload = parsePayload(result);
	if (result.isError) {
		const message =
			payload && typeof payload === 'object' && 'error' in payload
				? String((payload as { error: unknown }).error)
				: 'unknown error';
		return `${toolName} failed: ${message}`;
	}
	if (Array.isArray(payload)) {
		return `${toolName}: ${payload.length} result${payload.length === 1 ? '' : 's'}`;
	}
	if (payload && typeof payload === 'object') {
		const obj = payload as Record<string, unknown>;
		if (typeof obj.count === 'number') {
			return `${toolName}: ${obj.count} instance${obj.count === 1 ? '' : 's'}`;
		}
		if (obj.kind === 'grid' || obj.kind === 'histogram' || obj.kind === 'chart') {
			return `${toolName}: opened ${String(obj.kind)} panel`;
		}
		if (typeof obj.id === 'string') {
			return `${toolName}: ${obj.id}`;
		}
	}
	return `${toolName}: done`;
}
