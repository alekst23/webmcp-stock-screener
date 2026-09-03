import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { ok } from '../webmcp/toolResult';
import { actorLabel, clearActivity, createActivityStore, recordAction } from './activity';
import { memoryStorage } from './testSupport';

// T-0002-2: activityStore persists to localStorage under its own key,
// mirroring store.ts's read-on-init/write-on-update pattern for
// WorkspaceState.
describe('activity log persistence', () => {
	it('persists logged actions to localStorage under their own key', () => {
		const storage = memoryStorage();
		const activity = createActivityStore(storage);

		recordAction(activity, 'human', 'close_panel', undefined, ok({}));

		const raw = storage.getItem('webmcp-activity-log');
		expect(raw, 'nothing was written to the activity log key').not.toBeNull();
		const persisted = JSON.parse(raw!) as unknown[];
		expect(persisted, `persisted: ${raw}`).toHaveLength(1);
	});

	it('restores the full log, in the same order, on reload in the same browser', () => {
		const storage = memoryStorage();
		const first = createActivityStore(storage);
		recordAction(first, 'human', 'close_panel', undefined, ok({}));
		recordAction(first, 'agent', 'run_screener', undefined, ok({ id: 'study_1' }));

		// A page reload re-runs module init against the same storage -- a
		// fresh createActivityStore call is the reload's equivalent here.
		const reloaded = createActivityStore(storage);
		const events = get(reloaded);

		expect(
			events.map((e) => `${e.actor}:${e.toolName}`),
			`events: ${JSON.stringify(events)}`
		).toEqual(['human:close_panel', 'agent:run_screener']);
	});

	it('starts with an empty log in a fresh browser with no existing key', () => {
		const activity = createActivityStore(memoryStorage());

		expect(get(activity)).toEqual([]);
	});
});

// T-0002-3: the timeline UI shows each entry's actor as "Human" or
// "Agent" -- extracted as a pure helper so the label mapping is testable
// without mounting ActivityFeed.svelte (raw-dump removal and rendered
// ordering are structural/covered by T-0002-1's ordering test, not
// re-tested here).
describe('actor label', () => {
	it('labels a human-actor event "Human"', () => {
		expect(actorLabel('human')).toBe('Human');
	});

	it('labels an agent-actor event "Agent"', () => {
		expect(actorLabel('agent')).toBe('Agent');
	});
});

// hotfix/workbench-ui-refactor: "Clear log" is the one exception to the
// log's append-only model -- a deliberate, all-or-nothing wipe.
describe('clearActivity', () => {
	it('empties the store', () => {
		const activity = createActivityStore(memoryStorage());
		recordAction(activity, 'human', 'close_panel', undefined, ok({}));

		clearActivity(activity);

		expect(get(activity)).toEqual([]);
	});

	it('persists the cleared (empty) log to storage', () => {
		const storage = memoryStorage();
		const activity = createActivityStore(storage);
		recordAction(activity, 'human', 'close_panel', undefined, ok({}));

		clearActivity(activity);

		const raw = storage.getItem('webmcp-activity-log');
		expect(raw, 'nothing was written after clearing').not.toBeNull();
		expect(JSON.parse(raw!), `persisted: ${raw}`).toEqual([]);
	});

	it('leaves the log usable afterward -- a subsequent action appends normally', () => {
		const activity = createActivityStore(memoryStorage());
		recordAction(activity, 'human', 'close_panel', undefined, ok({}));

		clearActivity(activity);
		recordAction(activity, 'agent', 'run_screener', undefined, ok({ id: 'study_1' }));

		const events = get(activity);
		expect(events, `events: ${JSON.stringify(events)}`).toHaveLength(1);
		expect(events[0]!.toolName).toBe('run_screener');
	});

	it('is a no-op when the log is already empty', () => {
		const activity = createActivityStore(memoryStorage());

		expect(() => clearActivity(activity)).not.toThrow();
		expect(get(activity)).toEqual([]);
	});
});
