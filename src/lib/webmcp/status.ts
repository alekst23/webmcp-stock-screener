export interface WebmcpStatus {
	toolCount: number;
	toolNames: string[];
}

// Whether an agent can actually call this page's tools right now.
// There is deliberately no "this browser doesn't support WebMCP" state: the
// page installs its own document.modelContext when the browser supplies
// none (bridge.ts), so browser support is never in question and was never
// something this code could predict. `connecting` must never render as
// `connected` -- claiming a live bridge before one exists is the failure
// this type was added to fix.
export type WebmcpBridgeState = 'connecting' | 'connected' | 'failed';

// Renders WebmcpStatus into the header string. Always shows the tool
// count -- no connection-state branching (hotfix/webmcp-tools-always-visible).
// The word is "defined", not "available": a real agent read "available" as
// "callable", found no bridge, and had to diagnose the contradiction itself
// (hotfix/webmcp-bridge-status). Callability lives in formatBridgeStatus.
// Unaffected by toolNames -- the name list is disclosed separately
// (hotfix/workbench-ui-refactor).
export function formatDefinedStatus(status: WebmcpStatus): string {
	return `${status.toolCount} WebMCP tools defined`;
}

// The second, live count (hotfix/webmcp-bridge-status). Unlike the defined
// count this one tracks progressive availability, so the two are shown
// together and neither number has to stand in for the other.
export function formatAvailableStatus(availableCount: number): string {
	return `${availableCount} available`;
}

// One short clause per bridge state (hotfix/webmcp-bridge-status). No state
// blames the browser: `failed` means registration threw here and now, which
// the console error explains, not that this browser lacks a capability.
export function formatBridgeStatus(state: WebmcpBridgeState): string {
	switch (state) {
		case 'connecting':
			return 'agent bridge connecting…';
		case 'connected':
			return 'agent bridge connected';
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

// Feature #10 means the registered set is a moving target, so no state's text
// may present its tool list as the live one.
const SURFACE_CAVEAT =
	`This is the full defined tool surface, not necessarily what's currently ` +
	`unlocked by workflow state.`;

// The half the original text lacked: a real agent diagnosed the missing
// bridge unaided and found the UI fallback on its own, because nothing on
// the page mentioned one existed. Ticker/universe search is the one
// exception -- that control is WebMCP-only by design, so it isn't offered
// as a fallback here.
const UI_FALLBACK =
	`Most operations these tools perform are also reachable through the page's ` +
	`visible UI controls — drive those instead. Ticker/universe search has no UI ` +
	`control; it is WebMCP-only by design.`;

// The page supplies its own document.modelContext where the browser has none,
// so a reader whose client shows no native WebMCP tool list is not out of
// luck — it just has to call the object itself. Saying so is what makes
// "pretend every browser has it" true in practice rather than only in the
// header.
const DIRECT_CALL =
	`If your client does not surface these natively, call them yourself: ` +
	`await document.modelContext.executeTool('<name>', { …input }), and ` +
	`await document.modelContext.getTools() for the live list. If that object is hidden by an ` +
	`isolated browser world, dispatch JSON CustomEvents named webmcp:agent-request and listen ` +
	`for webmcp:agent-response; use method "getTools" or "executeTool" with {tool, input}.`;

function connectedBody(status: WebmcpStatus): string {
	return (
		`this page registers ${status.toolCount} tools via document.modelContext for the ` +
		`shared MarketPane session. Defined tools: ` +
		`${status.toolNames.join(', ')}. ${SURFACE_CAVEAT} Query document.modelContext ` +
		`directly for authoritative live availability and schemas. Call the tools through ` +
		`the WebMCP protocol to read and modify workspace state a human researcher can see ` +
		`and steer directly. ${DIRECT_CALL}`
	);
}

// This is what the first DOM render shows on a *working* WebMCP browser --
// connect() needs a dozen-plus microtasks to settle, and the comment is
// written before then. Saying the tools are dead here would send every agent
// on a working browser to the UI fallback (hotfix/webmcp-bridge-status);
// saying they are live would be the premature claim this change removes. So
// it says neither and points at the one authoritative source.
function connectingBody(status: WebmcpStatus): string {
	return (
		`this page defines ${status.toolCount} tools and is registering them with ` +
		`document.modelContext right now. Registration is still in progress, so they are ` +
		`not callable yet — but this comment was written before the bridge could settle ` +
		`and is not evidence that it failed. Defined tools: ${status.toolNames.join(', ')}. ` +
		`${SURFACE_CAVEAT} Query document.modelContext directly for authoritative live ` +
		`availability and schemas; if the tools are there, call them.`
	);
}

// A bridge IS present here -- registration threw. The reason belongs in the
// console, not in a guess about the browser.
function failedBody(status: WebmcpStatus): string {
	return (
		`this page defines ${status.toolCount} tools and document.modelContext is present, ` +
		`but registering them against it failed, so they are not callable ` +
		`in this session. Defined tools: ${status.toolNames.join(', ')}. ${SURFACE_CAVEAT} ` +
		`${UI_FALLBACK} The underlying registration error is logged to the browser console. ` +
		`document.modelContext itself, not this static list, stays authoritative for ` +
		`whatever it does hold.`
	);
}

function agentToolsBody(status: WebmcpStatus, bridge: WebmcpBridgeState): string {
	switch (bridge) {
		case 'connecting':
			return connectingBody(status);
		case 'connected':
			return connectedBody(status);
		case 'failed':
			return failedBody(status);
	}
}

// Preface + tool listing for the agent-only HTML comment in +page.svelte
// (hotfix/workbench-ui-refactor). Kept separate from formatDefinedStatus --
// this text is for an agent reading the page's HTML source, never for the
// human researcher looking at the rendered UI.
// `bridge` is required rather than defaulted (hotfix/webmcp-bridge-status):
// a default would either re-create the false "these are callable" claim or
// silently mislabel any caller that forgot to pass it. All three states get
// their own wording -- collapsing any pair asserts something untrue about
// callability for at least one of them.
export function formatAgentToolsContext(status: WebmcpStatus, bridge: WebmcpBridgeState): string {
	// The caller wraps this in <!-- -->, where "--" closes the comment early
	// and would expose the tail as rendered page text. Escaping lives here
	// rather than at the call site (hotfix/webmcp-bridge-status) because
	// producing comment-safe content is this function's whole job. The
	// literals above write "—" directly, so this guard has exactly one job
	// left: interpolated tool names, which this module does not control.
	return `WebMCP agent context: ${agentToolsBody(status, bridge)}`.replaceAll('--', '—');
}
