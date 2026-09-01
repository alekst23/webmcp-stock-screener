export interface WebmcpStatus {
	toolCount: number;
	toolNames: string[];
}

// Renders WebmcpStatus into the header string. Always shows the tool
// count -- no connection-state branching (hotfix/webmcp-tools-always-visible).
// Unaffected by toolNames -- the name list renders as its own element in
// +page.svelte, not folded into this string (hotfix/workbench-ui-refactor).
export function formatWebmcpStatus(status: WebmcpStatus): string {
	return `${status.toolCount} tools available`;
}

// Pairs the tool count with the ordered list of tool names (hotfix/workbench-ui-refactor)
// so the header can list every tool the app defines, not just a count.
// Deliberately typed to the minimal shape it needs rather than the full
// ToolSpec[], to stay decoupled from tools.ts.
export function buildWebmcpStatus(tools: { name: string }[]): WebmcpStatus {
	return {
		toolCount: tools.length,
		toolNames: tools.map((tool) => tool.name)
	};
}
