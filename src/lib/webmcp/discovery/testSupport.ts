// Shared across the discovery tool tests so they cannot drift into disagreeing
// about how a ToolResult is unwrapped.

import type { ToolResult } from '../types';

export function payload(result: ToolResult): Record<string, unknown> {
	const text = result.content[0]?.text;
	if (text === undefined) {
		throw new Error(`tool result carried no content: ${JSON.stringify(result)}`);
	}
	return JSON.parse(text) as Record<string, unknown>;
}
