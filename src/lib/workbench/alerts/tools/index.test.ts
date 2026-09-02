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
	it('builds exactly the five tools T-1014-8 and T-1014-9 together deliver', () => {
		const tools = buildAlertTools(buildDeps());
		expect(tools.map((t) => t.name).sort()).toEqual([
			'create_alert_draft',
			'disable_alert',
			'edit_alert_draft',
			'enable_alert',
			'preview_alert'
		]);
	});

	it('registers all four operations; building twice against fresh tools does not throw', () => {
		const deps = buildDeps();
		buildAlertTools(deps);
		expect(() => buildAlertTools(deps)).not.toThrow();
		for (const kind of ALERT_OPERATION_KINDS) {
			expect(deps.registry.get(kind)).not.toBeNull();
		}
	});

	// enable_alert/disable_alert legitimately mention activation by name --
	// that is not the property being guarded. What matters is that no tool's
	// name suggests it can itself perform the confirm/arm step (e.g. no
	// `arm_alert` or `confirm_activation`).
	it('no tool name is (or suggests) arm_alert or confirm/decline_activation', () => {
		const tools = buildAlertTools(buildDeps());
		const names = tools.map((t) => t.name);
		expect(names).not.toContain('arm_alert');
		expect(names).not.toContain('confirm_activation');
		expect(names).not.toContain('decline_activation');
		for (const name of names) {
			expect(name).not.toMatch(/^arm_|^confirm_|^decline_/);
		}
	});
});
