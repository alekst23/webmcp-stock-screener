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
export function formatDefinedStatus(status: WebmcpStatus): string {
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

// Feature #10 means the registered set is a moving target, so no state's text
// may present its tool list as the live one.
const SURFACE_CAVEAT =
	`This is the full defined tool surface, not necessarily what's currently ` +
	`unlocked by workflow state.`;

// The half the original text lacked: a real agent diagnosed the missing
// bridge unaided and found the UI fallback on its own, because nothing on
// the page mentioned one existed.
const UI_FALLBACK =
	`Every operation these tools perform is also reachable through the page's ` +
	`visible UI controls — drive those instead.`;

function connectedBody(status: WebmcpStatus): string {
	return (
		`this page registers ${status.toolCount} tools via document.modelContext for the ` +
		`shared Pattern Research Workbench session. Defined tools: ` +
		`${status.toolNames.join(', ')}. ${SURFACE_CAVEAT} Query document.modelContext ` +
		`directly for authoritative live availability and schemas. Call the tools through ` +
		`the WebMCP protocol to read and modify workspace state a human researcher can see ` +
		`and steer directly.`
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

// A bridge IS present here -- registration threw. Saying
// "document.modelContext is not connected here" (the unavailable wording)
// would be flatly false and would send the reader looking for a missing
// object it can see.
function failedBody(status: WebmcpStatus): string {
	return (
		`this page defines ${status.toolCount} tools and document.modelContext is present ` +
		`in this browser, but registering them against it failed, so they are not callable ` +
		`in this session. Defined tools: ${status.toolNames.join(', ')}. ${SURFACE_CAVEAT} ` +
		`${UI_FALLBACK} The underlying registration error is logged to the browser console. ` +
		`document.modelContext itself, not this static list, stays authoritative for ` +
		`whatever it does hold.`
	);
}

function unavailableBody(status: WebmcpStatus): string {
	return (
		`this page defines ${status.toolCount} tools, but they are not callable in this ` +
		`session — document.modelContext is not connected here. Defined tools: ` +
		`${status.toolNames.join(', ')}. ${SURFACE_CAVEAT} ${UI_FALLBACK} Should a bridge ` +
		`appear, document.modelContext itself is authoritative for live availability and ` +
		`schemas, not this static list.`
	);
}

function agentToolsBody(status: WebmcpStatus, bridge: WebmcpBridgeState): string {
	switch (bridge) {
		case 'connecting':
			return connectingBody(status);
		case 'connected':
			return connectedBody(status);
		case 'unavailable':
			return unavailableBody(status);
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
// silently mislabel any caller that forgot to pass it. All four states get
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
