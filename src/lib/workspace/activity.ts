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
