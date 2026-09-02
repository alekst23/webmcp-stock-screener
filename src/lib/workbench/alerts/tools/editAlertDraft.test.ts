import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { buildCreateAlertDraftTool, type CreateAlertDraftDeps } from './createAlertDraft';
import { buildEditAlertDraftTool, type EditAlertDraftDeps } from './editAlertDraft';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

interface SuccessPayload {
	alert_id: string;
	change_id: string;
	undo_token: string | null;
	alert: { name: string; state: string; armed: boolean; previewable: boolean };
}

interface FailurePayload {
	error: string;
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

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

describe('edit_alert_draft', () => {
	let deps: CreateAlertDraftDeps & EditAlertDraftDeps;
	let createTool: ToolSpec;
	let editTool: ToolSpec;
	let alertId: string;

	beforeEach(async () => {
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
		createTool = buildCreateAlertDraftTool(deps);
		editTool = buildEditAlertDraftTool(deps);
		const created = jsonOf(
			await createTool.execute({ name: 'Big caps', conditions: [rangeCondition()] })
		) as SuccessPayload;
		alertId = created.alert_id;
	});

	it('renames a draft and keeps it a draft (AC9)', async () => {
		const result = await editTool.execute({ alert_id: alertId, name: 'Small caps' });
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.alert.name).toBe('Small caps');
		expect(payload.alert.state).toBe('draft');
		expect(payload.alert.armed).toBe(false);
	});

	it('replaces conditions and recomputes previewability (AC9, AC8)', async () => {
		const result = await editTool.execute({
			alert_id: alertId,
			conditions: [
				rangeCondition({ lower: 1, upper: 2 }),
				rangeCondition({ lower: 100, upper: 200 })
			]
		});
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.alert.previewable).toBe(false);
	});

	it('rejects editing an unknown alert', async () => {
		const result = await editTool.execute({ alert_id: 'alert_missing', name: 'x' });
		expect(result.isError).toBe(true);
	});

	it('rejects an edit with nothing to change', async () => {
		const result = await editTool.execute({ alert_id: alertId });
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.error).toBe('invalid_request');
	});

	it('undo restores the pre-edit draft', async () => {
		const before = jsonOf(
			await createTool.execute({ name: 'x', conditions: [rangeCondition()] })
		) as SuccessPayload;
		const edited = jsonOf(
			await editTool.execute({ alert_id: before.alert_id, name: 'renamed' })
		) as SuccessPayload;
		expect(edited.undo_token).not.toBeNull();
	});
});
