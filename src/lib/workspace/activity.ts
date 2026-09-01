import { writable, type Writable } from 'svelte/store';
import type { ToolResult } from '../webmcp/types';

// One entry in the visible unified action log (spec.md's "Unified action
// log" / human-agent collaboration story made observable). Appended to
// only through recordAction below -- register.ts's tool wrapper (actor:
// 'agent') and any human-triggered UI control such as ChartToolbar.svelte
// (actor: 'human') are the only call sites, in call order -- this is the
// trust affordance that lets a human see what happened in the session
// without reading raw tool results.
export interface AgentActivityEvent {
	id: string;
	// Set statically per call site (T-0002-1), never runtime-detected.
	actor: 'human' | 'agent';
	toolName: string;
	// ISO timestamp of the call.
	timestamp: string;
	input: unknown;
	// One-line human-readable summary of the result, not the raw JSON.
	summary: string;
}

const STORAGE_KEY = 'webmcp-activity-log';

function readPersisted(storage: Storage | undefined): AgentActivityEvent[] {
	if (!storage) {
		return [];
	}
	const raw = storage.getItem(STORAGE_KEY);
	if (!raw) {
		return [];
	}
	try {
		return JSON.parse(raw) as AgentActivityEvent[];
	} catch {
		// Corrupted or foreign data in the slot must not crash the app on load.
		return [];
	}
}

// Deliberately its own store rather than a field on WorkspaceState: the
// log is a human-facing trust affordance (AC4), not shared session state
// an agent needs to read back (unlike focus.selected -- see store.ts's
// selectInstance) or that any tool contract depends on. Persists to its
// own localStorage key (T-0002-2), mirroring store.ts's
// createWorkspaceStore read-on-init/write-on-update pattern -- storage is
// an explicit parameter (default: real browser localStorage) for the same
// reason store.ts's is: tests need an isolated in-memory Storage.
export function createActivityStore(storage?: Storage): Writable<AgentActivityEvent[]> {
	const backing = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
	const persisted = readPersisted(backing);
	// nextActivityId is module-level (shared across the one real
	// activityStore singleton); restart it past whatever ids the restored
	// log already used, or a post-reload recordAction call would mint an
	// id that collides with a persisted entry's, breaking ActivityFeed's
	// keyed {#each}.
	nextActivityId = Math.max(nextActivityId, nextIdAfter(persisted));
	const store = writable<AgentActivityEvent[]>(persisted);
	store.subscribe((events) => {
		backing?.setItem(STORAGE_KEY, JSON.stringify(events));
	});
	return store;
}

function nextIdAfter(events: AgentActivityEvent[]): number {
	let max = 0;
	for (const event of events) {
		const n = Number(event.id.replace('activity_', ''));
		if (!Number.isNaN(n) && n > max) {
			max = n;
		}
	}
	return max + 1;
}

let nextActivityId = 1;

export const activityStore = createActivityStore();

// The shared recording entry point (T-0002-1, AC1): the only place that
// appends to an activity store. register.ts's tool wrapper and
// ChartToolbar.svelte's UI-control handlers both call this instead of
// writing to their store directly, so the actor label and the
// summarizeToolCall-based summary (including failures, AC4) are applied
// identically regardless of who acted.
export function recordAction(
	activity: Writable<AgentActivityEvent[]> | undefined,
	actor: 'human' | 'agent',
	actionName: string,
	input: unknown,
	result: ToolResult
): void {
	activity?.update((events) => [
		...events,
		{
			id: `activity_${nextActivityId++}`,
			actor,
			toolName: actionName,
			timestamp: new Date().toISOString(),
			input,
			summary: summarizeToolCall(actionName, result)
		}
	]);
}

// T-0002-3: the timeline UI's actor badge, extracted as a pure function so
// the label mapping is unit-testable without mounting ActivityFeed.svelte.
export function actorLabel(actor: 'human' | 'agent'): 'Human' | 'Agent' {
	return actor === 'human' ? 'Human' : 'Agent';
}

// The one exception to recordAction being the sole append-only mutator
// (hotfix/workbench-ui-refactor) -- a deliberate, all-or-nothing wipe of
// the whole log, not a per-entry edit/delete. The existing subscribe-based
// persistence writes the cleared (empty) array to storage automatically.
// nextActivityId is intentionally left unreset so ids keep incrementing
// past the clear rather than risk colliding with entries rendered before it.
export function clearActivity(activity: Writable<AgentActivityEvent[]>): void {
	activity.set([]);
}

function parsePayload(result: ToolResult): unknown {
	const text = result.content.map((c) => c.text).join('');
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

// Turns a raw ToolResult into the one-line human-readable line the feed
// shows -- the feed's whole point is to spare a human from reading raw JSON
// tool payloads to see what the agent did (tools.ts's ok()/fail() helpers
// JSON-stringify every result).
export function summarizeToolCall(toolName: string, result: ToolResult): string {
	const payload = parsePayload(result);
	if (result.isError) {
		const message =
			payload && typeof payload === 'object' && 'error' in payload
				? String((payload as { error: unknown }).error)
				: 'unknown error';
		return `${toolName} failed: ${message}`;
	}
	if (Array.isArray(payload)) {
		return `${toolName}: ${payload.length} result${payload.length === 1 ? '' : 's'}`;
	}
	if (payload && typeof payload === 'object') {
		const obj = payload as Record<string, unknown>;
		if (typeof obj.count === 'number') {
			return `${toolName}: ${obj.count} instance${obj.count === 1 ? '' : 's'}`;
		}
		if (obj.kind === 'grid' || obj.kind === 'histogram' || obj.kind === 'chart') {
			return `${toolName}: opened ${String(obj.kind)} panel`;
		}
		if (typeof obj.id === 'string') {
			return `${toolName}: ${obj.id}`;
		}
	}
	return `${toolName}: done`;
}
