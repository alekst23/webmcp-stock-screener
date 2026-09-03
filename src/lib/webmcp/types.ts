// WebMCP transport types (T-1015-5): what the bridge, registration layers,
// and every tool group's ToolSpec[] builder depend on. This file used to
// also hold the legacy 11-tool product surface (StudySummary, WorkspaceState,
// ResearchEngine, per-tool Input/Result types, FUNCTION_CATALOG,
// ExpressionError) -- that half retired with the tool surface itself; see
// docs/plan/EPIC-1015/T-1015-5-remove-legacy-tool-surface.md and
// docs/plan/EPIC-1015/retirement-inventory.md §1-3 for which symbols were
// transport versus product and why the file was split rather than deleted.

export interface ToolResult {
	content: { type: 'text'; text: string }[];
	isError?: boolean;
}

// `available` used to be called with the live WorkspaceState to implement
// per-tool progressive availability (the legacy surface's only consumer,
// register.ts's connectWebmcp/refresh). The capability-parity check
// confirmed that mechanism as a deliberate drop for the new surface -- every
// tool group registers unconditionally in one pass -- so nothing calls
// `available()` with an argument any more. Left as a required field (every
// existing ToolSpec across the new surface already implements it as
// `() => true`) rather than removed outright, since dropping it would touch
// every tool-group file outside this ticket's scope for no behavioral gain.
export interface ToolSpec {
	name: string;
	description: string;
	inputSchema: object;
	available(): boolean;
	execute(input: unknown): Promise<ToolResult>;
}

// Minimal ambient typing for the draft WebMCP API (document.modelContext).
// The spec is a moving early-preview target; keep this surface small.
export interface ModelContextToolDescriptor {
	name: string;
	description: string;
	inputSchema: object;
	execute(input: unknown): Promise<ToolResult>;
}

// What getTools() reports back: the descriptor without its execute callback.
export interface RegisteredToolInfo {
	name: string;
	description: string;
	inputSchema: object;
}

export interface ModelContext {
	registerTool(tool: ModelContextToolDescriptor): Promise<void>;
	unregisterTool?(name: string): Promise<void>;
	// Optional because a browser-supplied bridge need not expose them. The
	// page-provided bridge in bridge.ts implements both, so an agent that can
	// only evaluate JS in the tab can still discover and call the surface.
	getTools?(): Promise<RegisteredToolInfo[]>;
	executeTool?(tool: string | { name: string }, input?: unknown): Promise<ToolResult>;
}

declare global {
	interface Document {
		modelContext?: ModelContext;
	}
}
