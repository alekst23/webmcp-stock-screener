export interface WebmcpStatus {
	toolCount: number;
	toolNames: string[];
}

// Whether an agent can actually call this page's tools right now.
// `unavailable` and `failed` both mean zero callable tools but must stay
// distinct: one is "this browser can't", the other is "this browser could
// and didn't". `connecting` must never render as `connected` -- claiming a
// live bridge before one exists is the failure this type was added to fix.
export type WebmcpBridgeState = 'connecting' | 'connected' | 'unavailable' | 'failed';

// Renders WebmcpStatus into the header string. Always shows the tool
// count -- no connection-state branching (hotfix/webmcp-tools-always-visible).
// The word is "defined", not "available": a real agent read "available" as
// "callable", found no bridge, and had to diagnose the contradiction itself
// (hotfix/webmcp-bridge-status). Callability lives in formatBridgeStatus.
// Unaffected by toolNames -- the name list is disclosed separately
// (hotfix/workbench-ui-refactor).
export function formatWebmcpStatus(status: WebmcpStatus): string {
	return `${status.toolCount} WebMCP tools defined`;
}

// The second, live count (hotfix/webmcp-bridge-status). Unlike the defined
// count this one tracks progressive availability, so the two are shown
// together and neither number has to stand in for the other.
export function formatAvailableStatus(availableCount: number): string {
	return `${availableCount} available`;
}

// One short clause per bridge state (hotfix/webmcp-bridge-status).
// `unavailable` and `failed` both mean zero callable tools but never share
// wording: one is "this browser can't", the other is "this browser could and
// didn't".
export function formatBridgeStatus(state: WebmcpBridgeState): string {
	switch (state) {
		case 'connecting':
			return 'agent bridge connecting…';
		case 'connected':
			return 'agent bridge connected';
		case 'unavailable':
			return 'agent bridge unavailable in this browser';
		case 'failed':
			return 'agent bridge failed to connect';
	}
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
// `bridge` is required rather than defaulted (hotfix/webmcp-bridge-status):
// a default would either re-create the false "these are callable" claim or
// silently mislabel any caller that forgot to pass it.
export function formatAgentToolsContext(status: WebmcpStatus, bridge: WebmcpBridgeState): string {
	const body =
		bridge === 'connected'
			? `this page registers ${status.toolCount} tools via document.modelContext for the ` +
				`shared Pattern Research Workbench session. Available tools: ` +
				`${status.toolNames.join(', ')}. This is the full defined tool surface, not ` +
				`necessarily what's currently unlocked by workflow state -- query ` +
				`document.modelContext directly for authoritative live availability and schemas. ` +
				`Call the tools through the WebMCP protocol to read and modify workspace state a ` +
				`human researcher can see and steer directly.`
			: `this page defines ${status.toolCount} tools, but they are not callable in this ` +
				`session -- document.modelContext is not connected here. Defined tools: ` +
				`${status.toolNames.join(', ')}. This is the full defined tool surface, not ` +
				`necessarily what's currently unlocked by workflow state. Every operation these ` +
				`tools perform is also reachable through the page's visible UI controls -- drive ` +
				`those instead. Should a bridge appear, document.modelContext itself is ` +
				`authoritative for live availability and schemas, not this static list.`;

	// The caller wraps this in <!-- -->, where "--" closes the comment early
	// and would expose the tail as rendered page text. Escaping lives here
	// rather than at the call site (hotfix/webmcp-bridge-status) because
	// producing comment-safe content is this function's whole job.
	return `WebMCP agent context: ${body}`.replaceAll('--', '—');
}
