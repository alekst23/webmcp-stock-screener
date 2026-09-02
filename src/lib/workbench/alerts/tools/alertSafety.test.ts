// A dedicated safety verification, per T-1014-8's stop condition: no code
// path in this ticket may transition an alert to 'armed'. Unit coverage for
// the individual pieces already lives alongside them (alertStateMachine.test.ts's
// export-surface pin, createAlertDraft.test.ts's and editAlertDraft.test.ts's
// operation-level mutation checks). This file proves the same property
// end-to-end, at the wire boundary an agent actually calls through, where a
// `state` field is not even part of the typed input -- so the adversarial
// input here is untyped JSON, not a TypeScript-suppressed cast.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import * as alertStateMachine from '../domain/alertStateMachine';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { readAlert } from '../domain/alert';
import { buildCreateAlertDraftTool, type CreateAlertDraftDeps } from './createAlertDraft';
import { buildEditAlertDraftTool, type EditAlertDraftDeps } from './editAlertDraft';
import { buildPreviewAlertTool } from './previewAlert';
import { createInMemoryAlertHistoricalData } from '../infra/inMemoryAlertHistoricalData';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

function jsonOf(result: { content: { type: 'text'; text: string }[] }): {
	alert_id: string;
	alert: { state: string };
} {
	return JSON.parse(result.content[0]!.text);
}

describe('alert safety: armed is unreachable from this ticket', () => {
	let deps: CreateAlertDraftDeps & EditAlertDraftDeps;
	let createTool: ToolSpec;
	let editTool: ToolSpec;
	let previewTool: ToolSpec;

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
		createTool = buildCreateAlertDraftTool(deps);
		editTool = buildEditAlertDraftTool(deps);
		previewTool = buildPreviewAlertTool({
			repository: deps.repository,
			port: createInMemoryAlertHistoricalData(),
			clock
		});
	});

	it('the state machine module exports nothing that can perform a transition', () => {
		expect(Object.keys(alertStateMachine).sort()).toEqual([
			'ALERT_STATES',
			'ALERT_STATE_TRANSITIONS',
			'INITIAL_ALERT_STATE',
			'isDraft'
		]);
	});

	it('create_alert_draft ignores an adversarial `state: "armed"` field in the raw wire request', async () => {
		const result = await createTool.execute({
			name: 'x',
			conditions: [
				{
					type: 'range',
					fieldId: 'field.volume',
					lower: 1,
					upper: 2,
					lowerInclusive: true,
					upperInclusive: true
				}
			],
			// Untyped: CreateAlertDraftDeps's wire input has no `state` field to
			// begin with, so this can only be smuggled in as raw JSON, exactly as
			// a real caller would have to attempt it.
			state: 'armed'
		});
		const payload = jsonOf(result);
		expect(payload.alert.state).toBe('draft');
	});

	it('edit_alert_draft ignores an adversarial `state: "armed"` field in the raw wire request', async () => {
		const created = jsonOf(
			await createTool.execute({
				name: 'x',
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
			})
		);
		const result = await editTool.execute({
			alert_id: created.alert_id,
			name: 'renamed',
			state: 'armed'
		});
		const payload = jsonOf(result);
		expect(payload.alert.state).toBe('draft');
	});

	it('there is no tool in this surface whose name suggests arming, and preview_alert never writes', async () => {
		const created = jsonOf(
			await createTool.execute({
				name: 'x',
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
			})
		);
		expect([createTool.name, editTool.name, previewTool.name]).not.toContain('arm_alert');
		expect([createTool.name, editTool.name, previewTool.name]).not.toContain('enable_alert');

		await previewTool.execute({ alert_id: created.alert_id });
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(readAlert(doc, created.alert_id)?.state).toBe('draft');
	});
});
