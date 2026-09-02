import { beforeEach, describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
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
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import { buildEnableAlertTool, type EnableAlertDeps } from './enableAlert';

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
	armed: boolean;
	message: string;
	alert: { state: string; armed: boolean; pending_activation: { requested_at: string } | null };
}

interface FailurePayload {
	error: string;
	message: string;
	issues?: string[];
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

function draftAlert(overrides: Partial<AlertRecord> = {}): AlertRecord {
	return {
		alertId: 'alert_1',
		workspaceId: WORKSPACE_ID,
		name: 'Big caps',
		state: 'draft',
		source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
		previewable: true,
		previewProblems: [],
		pendingActivation: null,
		activationHistory: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

describe('enable_alert', () => {
	let deps: EnableAlertDeps;
	let tool: ToolSpec;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(writeAlert(emptyWorkspace(WORKSPACE_ID, 'Test', NOW), draftAlert()));
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
		tool = buildEnableAlertTool(deps);
	});

	it('does not arm the alert, and says so explicitly (AC1)', async () => {
		const result = await tool.execute({ alert_id: 'alert_1' });
		expect(result.isError).toBeUndefined();
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.armed).toBe(false);
		expect(payload.alert.armed).toBe(false);
		expect(payload.alert.state).toBe('pending_activation');
		expect(payload.message.toLowerCase()).toContain('not armed');
		expect(payload.message.toLowerCase()).toContain('confirm');
	});

	it('records a pending activation request', async () => {
		const result = await tool.execute({ alert_id: 'alert_1' });
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.alert.pending_activation).not.toBeNull();
	});

	it('the alert state on disk is pending_activation, never armed', async () => {
		await tool.execute({ alert_id: 'alert_1' });
		const doc = deps.repository.get(WORKSPACE_ID)!;
		const alert = readAlert(doc, 'alert_1');
		expect(alert?.state).toBe('pending_activation');
		expect(alert?.state).not.toBe('armed');
	});

	it('ignores an adversarial state: "armed" field in the wire request (does not arm)', async () => {
		const result = await tool.execute({ alert_id: 'alert_1', state: 'armed' });
		const payload = jsonOf(result) as SuccessPayload;
		expect(payload.alert.state).toBe('pending_activation');
	});

	it('rejects requesting activation twice while the first request is still pending', async () => {
		await tool.execute({ alert_id: 'alert_1' });
		const second = await tool.execute({ alert_id: 'alert_1' });
		expect(second.isError).toBe(true);
		const payload = jsonOf(second) as FailurePayload;
		expect(payload.message.toLowerCase()).toContain('pending');
	});

	it('a repeated idempotency_key does not create a second pending request (AC11)', async () => {
		const first = jsonOf(
			await tool.execute({ alert_id: 'alert_1', idempotency_key: 'k1' })
		) as SuccessPayload;
		const second = jsonOf(
			await tool.execute({ alert_id: 'alert_1', idempotency_key: 'k1' })
		) as SuccessPayload;
		expect(second.change_id).toBe(first.change_id);
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(2); // one commit, not two
	});

	it('undoing with the undo token clears the pending request, never arms it (AC12)', async () => {
		const payload = jsonOf(await tool.execute({ alert_id: 'alert_1' })) as SuccessPayload;
		expect(payload.undo_token).not.toBeNull();
		undoChange(payload.undo_token!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock,
			context: { actor: 'agent' }
		});
		const doc = deps.repository.get(WORKSPACE_ID)!;
		const alert = readAlert(doc, 'alert_1');
		expect(alert?.state).toBe('draft');
		expect(alert?.pendingActivation).toBeNull();
		expect(alert?.state).not.toBe('armed');
	});

	it('rejects a stale expected_revision without changing anything', async () => {
		const result = await tool.execute({ alert_id: 'alert_1', expected_revision: 99 });
		expect(result.isError).toBe(true);
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(readAlert(doc, 'alert_1')?.state).toBe('draft');
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
