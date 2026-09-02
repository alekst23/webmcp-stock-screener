import { beforeEach, describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
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
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import { buildDisableAlertTool, type DisableAlertDeps } from './disableAlert';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

const VOLUME_CONDITION: RangeCondition = {
	type: 'range',
	fieldId: 'field.volume',
	lower: 1,
	upper: 2,
	lowerInclusive: true,
	upperInclusive: true
};

interface SuccessPayload {
	change_id: string;
	new_revision: number;
	undo_token: string | null;
	alert_id: string;
	alert: { state: string; armed: boolean };
}

interface FailurePayload {
	error: string;
	message: string;
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

function armedAlert(overrides: Partial<AlertRecord> = {}): AlertRecord {
	return {
		alertId: 'alert_1',
		workspaceId: WORKSPACE_ID,
		name: 'Big caps',
		state: 'armed',
		source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
		previewable: true,
		previewProblems: [],
		pendingActivation: null,
		activationHistory: [{ kind: 'confirmed', at: NOW, actor: 'human' }],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

describe('disable_alert', () => {
	let deps: DisableAlertDeps;
	let tool: ToolSpec;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(writeAlert(emptyWorkspace(WORKSPACE_ID, 'Test', NOW), armedAlert()));
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
		tool = buildDisableAlertTool(deps);
	});

	it('disarms an armed alert immediately, with no confirmation step needed (AC8)', async () => {
		const result = await tool.execute({ alert_id: 'alert_1' });
		expect(result.isError).toBeUndefined();
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.alert.state).toBe('disarmed');
		expect(payload.alert.armed).toBe(false);
	});

	it('the alert stops firing: it is no longer armed on disk', async () => {
		await tool.execute({ alert_id: 'alert_1' });
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(readAlert(doc, 'alert_1')?.state).toBe('disarmed');
	});

	// SAFETY-CRITICAL: the undo_token must always be null for disable_alert.
	// If this test ever fails, it means an inverse leaked back in and an
	// agent has a two-call (disable, undo) or worse a one-call path toward
	// 'armed' via undo_change -- see disableAlert.ts's header comment.
	it('returns undo_token: null -- disarming can never be undone through this tool', async () => {
		const result = await tool.execute({ alert_id: 'alert_1' });
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.undo_token).toBeNull();
	});

	it('is idempotent on an already-disarmed alert: succeeds and stays disarmed (AC9)', async () => {
		await tool.execute({ alert_id: 'alert_1' });
		const second = await tool.execute({ alert_id: 'alert_1' });
		expect(second.isError).toBeUndefined();
		const payload = jsonOf(second) as SuccessPayload;
		expect(payload.alert.state).toBe('disarmed');
		expect(payload.undo_token).toBeNull();
	});

	it('rejects disabling a draft', async () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(
			writeAlert(
				emptyWorkspace(WORKSPACE_ID, 'Test', NOW),
				armedAlert({ state: 'draft', activationHistory: [] })
			)
		);
		repository.setActiveId(WORKSPACE_ID);
		const ids = createIdSequencer();
		const localDeps: DisableAlertDeps = {
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
		const localTool = buildDisableAlertTool(localDeps);
		const result = await localTool.execute({ alert_id: 'alert_1' });
		expect(result.isError).toBe(true);
		const payload = jsonOf(result) as FailurePayload;
		expect(payload.message).toContain('draft');
	});

	it('rejects an unknown alert_id', async () => {
		const result = await tool.execute({ alert_id: 'alert_missing' });
		expect(result.isError).toBe(true);
	});

	it('rejects a missing alert_id', async () => {
		const result = await tool.execute({});
		expect(result.isError).toBe(true);
	});
});
