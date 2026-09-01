export interface WebmcpStatus {
	toolCount: number;
	toolNames: string[];
}

// Renders WebmcpStatus into the header string. Always shows the tool
// count -- no connection-state branching (hotfix/webmcp-tools-always-visible).
// Unaffected by toolNames -- the name list is never rendered as visible
// UI (see formatAgentToolsContext), so this string never folds it in
// (hotfix/workbench-ui-refactor).
export function formatWebmcpStatus(status: WebmcpStatus): string {
	return `${status.toolCount} tools available`;
}

// Pairs the tool count with the ordered list of tool names (hotfix/workbench-ui-refactor)
// so the page can list every tool the app defines, not just a count.
// Deliberately typed to the minimal shape it needs rather than the full
// ToolSpec[], to stay decoupled from tools.ts.
export function buildWebmcpStatus(tools: { name: string }[]): WebmcpStatus {
	return {
		toolCount: tools.length,
		toolNames: tools.map((tool) => tool.name)
	};
}

// Preface + tool listing for the agent-only HTML comment in +page.svelte
// (hotfix/workbench-ui-refactor). Kept separate from formatWebmcpStatus --
// this text is for an agent reading the page's HTML source, never for the
// human researcher looking at the rendered UI.
export function formatAgentToolsContext(status: WebmcpStatus): string {
	return (
		`WebMCP agent context: this page registers ${status.toolCount} tools via ` +
		`document.modelContext for the shared Pattern Research Workbench session. ` +
		`Available tools: ${status.toolNames.join(', ')}. Call them through the WebMCP ` +
		`protocol to read and modify workspace state a human researcher can see and ` +
		`steer directly.`
	);
}
