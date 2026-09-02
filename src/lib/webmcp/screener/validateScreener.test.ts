import { beforeEach, describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../catalog/registry';
import {
	createScreener,
	type FilterNode,
	type ScreenerDefinition
} from '../../screener/definition';
import { readScreener, writeScreener } from '../../screener/state';
import { createIdSequencer } from '../../workbench/domain/ids';
import type { Clock } from '../../workbench/domain/ports';
import type { MarketDataProvenance } from '../../workbench/domain/provenance';
import { emptyWorkspace } from '../../workbench/domain/workspace';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createOperationRegistry } from '../../workbench/application/operationRegistry';
import { createRevisionService } from '../../workbench/application/revisionService';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import type { ToolResult } from '../types';
import { createValidateScreenerTool } from './validateScreener';

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

const FIXED_PROVENANCE: MarketDataProvenance = {
	asOf: '2026-09-02T14:00:00.000Z',
	sourceId: 'eodhd',
	sourceLabel: 'EOD Historical Data',
	liveness: 'delayed',
	delaySeconds: 900,
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted',
	engineVersion: '1.0.0'
};

function jsonOf(result: ToolResult): unknown {
	const first = result.content[0];
	if (!first) {
		throw new Error('ToolResult carried no content.');
	}
	return JSON.parse(first.text);
}

describe('validate_screener', () => {
	let deps: WorkbenchDeps;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const clock = fixedClock('2026-01-01T00:00:00.000Z');
		const ids = createIdSequencer();
		const idempotency = createIdempotencyCache();
		deps = {
			repository,
			revisions: createRevisionService({ repository, clock, ids, idempotency }),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			provenance: { current: () => FIXED_PROVENANCE },
			clock,
			ids,
			idempotency
		};
	});

	function seedScreener(): { workspaceId: string; screenerId: string } {
		const workspaceId = deps.ids.next('workspace');
		const doc = emptyWorkspace(workspaceId, 'Test Workspace', deps.clock.now());
		const screener = createScreener(deps.ids, workspaceId, 'Test Screener');
		deps.repository.put(writeScreener(doc, screener));
		deps.repository.setActiveId(workspaceId);
		return { workspaceId, screenerId: screener.screenerId };
	}

	function seedScreenerWithCondition(): { workspaceId: string; screenerId: string } {
		const { workspaceId, screenerId } = seedScreener();
		const doc = deps.repository.get(workspaceId);
		if (!doc) throw new Error(`Workspace not found: ${workspaceId}`);
		const screener = readScreener(doc, screenerId);
		if (!screener) throw new Error(`Screener not found: ${screenerId}`);
		const nextTree: FilterNode = {
			nodeId: screener.filterTree.nodeId,
			kind: 'group',
			op: 'and',
			enabled: true,
			children: [
				{
					nodeId: 'node_1',
					kind: 'condition',
					enabled: true,
					condition: {
						type: 'scalar',
						fieldId: 'field.price.close',
						operator: 'op.greater_than',
						value: 10,
						unit: null
					}
				}
			]
		};
		deps.repository.put(writeScreener(doc, { ...screener, filterTree: nextTree }));
		return { workspaceId, screenerId };
	}

	function storedScreener(workspaceId: string, screenerId: string): ScreenerDefinition {
		const doc = deps.repository.get(workspaceId);
		if (!doc) throw new Error(`Workspace not found: ${workspaceId}`);
		const screener = readScreener(doc, screenerId);
		if (!screener) throw new Error(`Screener not found: ${screenerId}`);
		return screener;
	}

	function tool() {
		return createValidateScreenerTool(deps, { registry: builtinCatalogRegistry });
	}

	it('test_wellFormedScreener_reportsValid_statingScreenerRevision', async () => {
		const { workspaceId, screenerId } = seedScreenerWithCondition();
		const result = await tool().execute({ workspace_id: workspaceId, screener_id: screenerId });
		expect(
			result.isError,
			`Expected success, got ${JSON.stringify(jsonOf(result))}`
		).toBeUndefined();
		const body = jsonOf(result) as {
			valid: boolean;
			screener_id: string;
			screener_revision: number;
			detection_exhaustive: boolean;
		};
		expect(body.valid, 'a well-formed screener must validate cleanly').toBe(true);
		expect(body.screener_id, 'the screener id must be echoed back').toBe(screenerId);
		expect(body.screener_revision, 'the validated revision must be stated').toBe(
			storedScreener(workspaceId, screenerId).revision
		);
		expect(body.detection_exhaustive, 'contradiction detection is never exhaustive').toBe(false);
	});

	it('test_wireReport_usesSnakeCaseKeys_forProblemsAndCostEstimate', async () => {
		const { workspaceId, screenerId } = seedScreenerWithCondition();
		const result = await tool().execute({ workspace_id: workspaceId, screener_id: screenerId });
		const body = jsonOf(result) as {
			skipped_node_ids: unknown;
			cost_estimate: { estimated_instrument_days: number; budget: number; driver: string } | null;
		};
		expect(body.skipped_node_ids, 'skipped_node_ids must be present on the wire').toEqual([]);
		expect(body.cost_estimate, 'a cost estimate must always be present').not.toBeNull();
		expect(
			typeof body.cost_estimate?.estimated_instrument_days,
			'the estimate must be numeric'
		).toBe('number');
		expect(typeof body.cost_estimate?.budget, 'the budget must be numeric').toBe('number');
		expect(typeof body.cost_estimate?.driver, 'the driver must be a string').toBe('string');
	});

	it('test_unknownScreenerId_isRejected', async () => {
		const { workspaceId } = seedScreener();
		const result = await tool().execute({ workspace_id: workspaceId, screener_id: 'screener_404' });
		expect(result.isError, 'an unknown screener_id must be rejected').toBe(true);
	});

	it('test_missingScreenerId_isRejected', async () => {
		const { workspaceId } = seedScreener();
		const result = await tool().execute({ workspace_id: workspaceId });
		expect(result.isError, 'a call with no screener_id must be rejected').toBe(true);
	});

	it('test_noActiveWorkspace_isRejected', async () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const clock = fixedClock('2026-01-01T00:00:00.000Z');
		const ids = createIdSequencer();
		const idempotency = createIdempotencyCache();
		const bareDeps: WorkbenchDeps = {
			repository,
			revisions: createRevisionService({ repository, clock, ids, idempotency }),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			provenance: { current: () => FIXED_PROVENANCE },
			clock,
			ids,
			idempotency
		};
		const result = await createValidateScreenerTool(bareDeps).execute({
			screener_id: 'screener_1'
		});
		expect(result.isError, 'a call with no active workspace must be rejected').toBe(true);
	});

	it('test_validation_doesNotAdvanceTheWorkspaceRevision', async () => {
		const { workspaceId, screenerId } = seedScreenerWithCondition();
		const before = deps.repository.get(workspaceId);
		if (!before) throw new Error('workspace vanished');
		const revisionBefore = before.revision;
		const screenerRevisionBefore = storedScreener(workspaceId, screenerId).revision;

		await tool().execute({ workspace_id: workspaceId, screener_id: screenerId });

		const after = deps.repository.get(workspaceId);
		if (!after) throw new Error('workspace vanished');
		expect(after.revision, 'the workspace revision must not advance on validation').toBe(
			revisionBefore
		);
		expect(
			storedScreener(workspaceId, screenerId).revision,
			"the screener's own revision must not advance on validation"
		).toBe(screenerRevisionBefore);
		expect(after, 'the stored document must be otherwise unchanged').toEqual(before);
	});

	it('test_validation_producesNoChangeHistoryEntry', async () => {
		const { workspaceId, screenerId } = seedScreenerWithCondition();
		await tool().execute({ workspace_id: workspaceId, screener_id: screenerId });
		expect(
			deps.history.list(workspaceId, {}),
			'a read-only validation call must not append to change history'
		).toEqual([]);
	});
});
