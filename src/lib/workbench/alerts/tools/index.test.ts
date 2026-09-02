import { beforeEach, describe, expect, it } from 'vitest';
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
import { ALERT_OPERATION_KINDS, buildAlertTools, type AlertToolsDeps } from './index';

const NOW = '2026-09-02T00:00:00.000Z';
const clock: Clock = { now: () => NOW };

function buildDeps(): AlertToolsDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	repository.put(emptyWorkspace('workspace_1', 'Test', NOW));
	repository.setActiveId('workspace_1');
	const ids = createIdSequencer();
	return {
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
		ids,
		historicalData: createInMemoryAlertHistoricalData()
	};
}

describe('buildAlertTools', () => {
	it('builds exactly the three tools this ticket delivers', () => {
		const tools = buildAlertTools(buildDeps());
		expect(tools.map((t) => t.name).sort()).toEqual([
			'create_alert_draft',
			'edit_alert_draft',
			'preview_alert'
		]);
	});

	it('registers both operations, and registering twice against a fresh set of tools does not throw', () => {
		const deps = buildDeps();
		buildAlertTools(deps);
		expect(() => buildAlertTools(deps)).not.toThrow();
		for (const kind of ALERT_OPERATION_KINDS) {
			expect(deps.registry.get(kind)).not.toBeNull();
		}
	});

	it("none of the three tools' names suggest arming or confirming an alert", () => {
		const tools = buildAlertTools(buildDeps());
		for (const tool of tools) {
			expect(tool.name).not.toMatch(/arm|confirm|activat/i);
		}
	});
});
