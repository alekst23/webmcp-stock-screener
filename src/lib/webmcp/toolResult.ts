import type { ToolResult } from './types';

// Extracted from the now-deleted webmcp/tools.ts (T-1015-5): these are
// generic ToolResult constructors, not part of the legacy 11-tool product
// surface -- 19+ new-surface tool-group files import them, plus
// workspace/activity.ts's test fixtures. Moving them here (rather than
// deleting tools.ts wholesale) is what keeps those builds green; see this
// ticket's Solution Approach. (ChartToolbar.svelte was a former consumer
// too, but it was the legacy engine's own component and retired along with
// the rest of the cascade this ticket's type deletions forced -- see the
// commit message for why that cascade was necessary.)
export function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function fail(message: string, extra?: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
		isError: true
	};
}
