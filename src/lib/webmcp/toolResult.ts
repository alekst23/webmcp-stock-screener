import type { ToolResult } from './types';

// Extracted from the now-deleted webmcp/tools.ts (T-1015-5): these are
// generic ToolResult constructors, not part of the legacy 11-tool product
// surface -- 19+ new-surface tool-group files import them. Moving them here
// (rather than deleting tools.ts wholesale) is what keeps those builds
// green; see T-1015-5's Solution Approach. (ChartToolbar.svelte and
// workspace/activity.ts were former consumers too, but both were legacy-
// surface code retired by T-1015-5 and T-1015-6 respectively.)
export function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function fail(message: string, extra?: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
		isError: true
	};
}
