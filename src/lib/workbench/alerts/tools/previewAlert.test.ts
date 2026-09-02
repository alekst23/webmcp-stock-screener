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
import { createInMemoryAlertHistoricalData } from '../infra/inMemoryAlertHistoricalData';
import { buildCreateAlertDraftTool, type CreateAlertDraftDeps } from './createAlertDraft';
import { buildPreviewAlertTool } from './previewAlert';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

interface CreatedPayload {
	alert_id: string;
}

interface PreviewPayload {
	previewable: boolean;
	preview_problems: string[];
	firing_count?: number;
	firing_rate?: number;
	noisy?: boolean;
	instruments?: string[];
	warnings?: string[];
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

describe('preview_alert', () => {
	let deps: CreateAlertDraftDeps;
	let createTool: ToolSpec;
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
		const created = jsonOf(
			await createTool.execute({ name: 'Big caps', conditions: [rangeCondition()] })
		) as CreatedPayload;
		alertId = created.alert_id;
	});

	it('rejects expected_revision on a read', async () => {
		const previewTool = buildPreviewAlertTool({
			repository: deps.repository,
			port: createInMemoryAlertHistoricalData(),
			clock
		});
		const result = await previewTool.execute({ alert_id: alertId, expected_revision: 1 });
		expect(result.isError).toBe(true);
	});

	it('reports zero firings plainly for a never-fires draft (AC7)', async () => {
		const previewTool = buildPreviewAlertTool({
			repository: deps.repository,
			port: createInMemoryAlertHistoricalData({ instrumentIds: ['inst:A'] }),
			clock
		});
		const result = await previewTool.execute({ alert_id: alertId });
		expect(result.isError).toBeUndefined();
		const payload = jsonOf(result) as PreviewPayload;
		expect(payload.previewable).toBe(true);
		expect(payload.firing_count).toBe(0);
	});

	it('flags a noisy alert with the observed rate (AC6)', async () => {
		const previewTool = buildPreviewAlertTool({
			repository: deps.repository,
			port: createInMemoryAlertHistoricalData({
				instrumentIds: ['inst:A', 'inst:B', 'inst:C'],
				fires: () => true
			}),
			clock
		});
		const result = await previewTool.execute({
			alert_id: alertId,
			window: { start: '2026-06-01', end: '2026-06-05' }
		});
		const payload = jsonOf(result) as PreviewPayload;
		expect(payload.noisy).toBe(true);
	});

	it('is not previewable for a contradictory draft, naming the problem (AC8), without evaluating anything', async () => {
		const created = jsonOf(
			await createTool.execute({
				name: 'Contradiction',
				conditions: [
					rangeCondition({ lower: 1, upper: 2 }),
					rangeCondition({ lower: 100, upper: 200 })
				]
			})
		) as CreatedPayload;
		const previewTool = buildPreviewAlertTool({
			repository: deps.repository,
			port: createInMemoryAlertHistoricalData({ instrumentIds: ['inst:A'], fires: () => true }),
			clock
		});
		const result = await previewTool.execute({ alert_id: created.alert_id });
		const payload = jsonOf(result) as PreviewPayload;
		expect(payload.previewable).toBe(false);
		expect(payload.preview_problems.length).toBeGreaterThan(0);
	});

	it('does not mutate the workspace document (AC12)', async () => {
		const previewTool = buildPreviewAlertTool({
			repository: deps.repository,
			port: createInMemoryAlertHistoricalData(),
			clock
		});
		const before = deps.repository.get(WORKSPACE_ID)!.revision;
		await previewTool.execute({ alert_id: alertId });
		expect(deps.repository.get(WORKSPACE_ID)!.revision).toBe(before);
	});

	it('rejects an unknown alert id', async () => {
		const previewTool = buildPreviewAlertTool({
			repository: deps.repository,
			port: createInMemoryAlertHistoricalData(),
			clock
		});
		const result = await previewTool.execute({ alert_id: 'alert_missing' });
		expect(result.isError).toBe(true);
	});
});
