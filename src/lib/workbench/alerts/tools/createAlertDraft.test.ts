import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { readAlert } from '../domain/alert';
import { buildCreateAlertDraftTool, type CreateAlertDraftDeps } from './createAlertDraft';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

interface SuccessPayload {
	change_id: string;
	new_revision: number;
	affected_ids: string[];
	warnings: string[];
	undo_token: string | null;
	alert_id: string;
	alert: { alert_id: string; name: string; state: string; armed: boolean; previewable: boolean };
}

interface FailurePayload {
	error: string;
	message: string;
	issues?: string[];
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

describe('create_alert_draft', () => {
	let deps: CreateAlertDraftDeps;
	let tool: ToolSpec;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(emptyWorkspace(WORKSPACE_ID, 'Test', NOW));
		repository.setActiveId(WORKSPACE_ID);
		const ids = createIdSequencer();
		deps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock,
				ids,
				idempotency: createIdempotencyCache()
			}),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			clock,
			ids
		};
		tool = buildCreateAlertDraftTool(deps);
	});

	it('creates a draft alert that is inert and not armed (AC1-3)', async () => {
		const result = await tool.execute({
			name: 'Big caps breaking out',
			conditions: [
				{
					type: 'range',
					fieldId: 'field.volume',
					lower: 1,
					upper: 2,
					lowerInclusive: true,
					upperInclusive: true
				}
			]
		});
		expect(result.isError).toBeUndefined();
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.alert.state).toBe('draft');
		expect(payload.alert.armed).toBe(false);
		expect(payload.alert.name).toBe('Big caps breaking out');
		expect(payload.alert.previewable).toBe(true);
		expect(payload.undo_token).not.toBeNull();
	});

	it('emits no notification of any kind: the only side effect is the stored alert', async () => {
		const result = await tool.execute({ name: 'x', conditions: [rangeCondition()] });
		const payload = jsonOf(result) as SuccessPayload;
		// The only observable output is the tool result itself and the stored
		// record it names -- there is no separate notification channel to check
		// for absence of a call, which is the point: none exists in this module.
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(readAlert(doc, payload.alert_id)?.state).toBe('draft');
	});

	it('rejects a request naming neither screener_id nor conditions', async () => {
		const result = await tool.execute({ name: 'x' });
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('invalid_request');
	});

	it('marks a contradictory draft not previewable, naming the problem (AC8)', async () => {
		const result = await tool.execute({
			name: 'Contradiction',
			conditions: [
				rangeCondition({ lower: 1, upper: 2 }),
				rangeCondition({ lower: 100, upper: 200 })
			]
		});
		const payload = jsonOf(result) as SuccessPayload & { alert: { preview_problems: string[] } };
		expect(payload.alert.previewable).toBe(false);
		expect(payload.alert.preview_problems.length).toBeGreaterThan(0);
	});

	it('a repeated idempotency_key does not create a second draft (AC11)', async () => {
		const first = jsonOf(
			await tool.execute({ name: 'x', conditions: [rangeCondition()], idempotency_key: 'k1' })
		) as SuccessPayload;
		const second = jsonOf(
			await tool.execute({ name: 'x', conditions: [rangeCondition()], idempotency_key: 'k1' })
		) as SuccessPayload;
		expect(second.alert_id).toBe(first.alert_id);
		expect(second.change_id).toBe(first.change_id);
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(2); // one commit, not two
	});

	it('undoing with the returned undo token removes the draft (AC11)', async () => {
		const payload = jsonOf(
			await tool.execute({ name: 'x', conditions: [rangeCondition()] })
		) as SuccessPayload;
		undoChange(payload.undo_token!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock,
			context: { actor: 'agent' }
		});
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(readAlert(doc, payload.alert_id)).toBeNull();
	});

	it('rejects a stale expected_revision without creating anything', async () => {
		const result = await tool.execute({
			name: 'x',
			conditions: [rangeCondition()],
			expected_revision: 99
		});
		expect(result.isError).toBe(true);
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(1);
	});

	function rangeCondition(overrides: Partial<Record<string, unknown>> = {}) {
		return {
			type: 'range',
			fieldId: 'field.volume',
			lower: 1,
			upper: 2,
			lowerInclusive: true,
			upperInclusive: true,
			...overrides
		};
	}
});
