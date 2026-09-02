import { beforeEach, describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../catalog/registry';
import { createScreener, type ScreenerDefinition } from '../../screener/definition';
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
import { createSetScreenerRankingTool } from './setScreenerRanking';

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

describe('set_screener_ranking', () => {
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

	function storedScreener(workspaceId: string, screenerId: string): ScreenerDefinition {
		const doc = deps.repository.get(workspaceId);
		if (!doc) throw new Error(`Workspace not found: ${workspaceId}`);
		const screener = readScreener(doc, screenerId);
		if (!screener) throw new Error(`Screener not found: ${screenerId}`);
		return screener;
	}

	function tool() {
		return createSetScreenerRankingTool(deps, builtinCatalogRegistry);
	}

	it('test_singleFieldRanking_isAcceptedAndStoredAndEchoedBack', async () => {
		const { workspaceId, screenerId } = seedScreener();
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [{ field_id: 'field.price.close', direction: 'desc' }]
		});
		expect(
			result.isError,
			`Expected success, got ${JSON.stringify(jsonOf(result))}`
		).toBeUndefined();
		const body = jsonOf(result) as { ranking: { fields: unknown[] } };
		expect(body.ranking.fields, 'Single-field ranking must be echoed back in full').toEqual([
			{ field_id: 'field.price.close', direction: 'desc', weight: 1 }
		]);
		const stored = storedScreener(workspaceId, screenerId);
		expect(stored.ranking?.fields, 'The stored screener must carry the same ranking').toEqual([
			{ fieldId: 'field.price.close', direction: 'desc', weight: 1 }
		]);
	});

	it('test_weightedRanking_isAccepted_andNormalizationIsStatedInResult', async () => {
		const { workspaceId, screenerId } = seedScreener();
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [
				{ field_id: 'field.price.close', direction: 'desc', weight: 0.6 },
				{ field_id: 'field.volume', direction: 'desc', weight: 0.4 }
			]
		});
		expect(
			result.isError,
			`Expected success, got ${JSON.stringify(jsonOf(result))}`
		).toBeUndefined();
		const body = jsonOf(result) as {
			ranking: { fields: { weight: number }[]; normalization: string };
		};
		expect(
			body.ranking.fields.map((f) => f.weight),
			'Weights must be stored exactly as given'
		).toEqual([0.6, 0.4]);
		expect(
			body.ranking.normalization,
			'The normalization used must be stated in the stored ranking'
		).toBe('percentile_rank');
	});

	it('test_tieBreakAndLimit_areStoredAsPartOfTheRanking', async () => {
		const { workspaceId, screenerId } = seedScreener();
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [{ field_id: 'field.price.close' }],
			tie_break: { field_id: 'field.volume', direction: 'asc' },
			limit: 25
		});
		expect(
			result.isError,
			`Expected success, got ${JSON.stringify(jsonOf(result))}`
		).toBeUndefined();
		const body = jsonOf(result) as {
			ranking: { tie_break: { field_id: string; direction: string }; limit: number };
		};
		expect(body.ranking.tie_break, 'Tie-break field and direction must be stored').toEqual({
			field_id: 'field.volume',
			direction: 'asc'
		});
		expect(body.ranking.limit, 'The result limit must be stored').toBe(25);
	});

	it('test_unknownCatalogField_isRejected_andPriorRankingIsUnchanged', async () => {
		const { workspaceId, screenerId } = seedScreener();
		await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [{ field_id: 'field.price.close' }]
		});

		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [{ field_id: 'field.totally.unknown' }]
		});
		expect(result.isError, 'A ranking naming an unknown field must be rejected').toBe(true);
		const body = jsonOf(result) as { error: string; message: string };
		expect(body.error, 'The rejection code must identify the problem class').toBe(
			'unknown_catalog_item'
		);
		expect(body.message, 'The rejection must name the unknown field').toContain(
			'field.totally.unknown'
		);

		const stored = storedScreener(workspaceId, screenerId);
		expect(
			stored.ranking?.fields[0]?.fieldId,
			'The previously stored ranking must be left unchanged'
		).toBe('field.price.close');
	});

	it('test_nonNumericField_isRejected', async () => {
		const { workspaceId, screenerId } = seedScreener();
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [{ field_id: 'field.symbol' }]
		});
		expect(result.isError, 'A non-numeric ranking field must be rejected').toBe(true);
		const body = jsonOf(result) as { message: string };
		expect(body.message, 'The rejection must explain the field is not numeric').toMatch(/numeric/i);
	});

	it('test_nonPositiveLimit_isRejected_withExplanation', async () => {
		const { workspaceId, screenerId } = seedScreener();
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [{ field_id: 'field.price.close' }],
			limit: 0
		});
		expect(result.isError, 'A non-positive limit must be rejected').toBe(true);
		const body = jsonOf(result) as { message: string };
		expect(body.message, 'The rejection must explain the limit problem').toMatch(/limit/i);
	});

	it('test_unnormalizableWeights_isRejected_withExplanation', async () => {
		const { workspaceId, screenerId } = seedScreener();
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [
				{ field_id: 'field.price.close', weight: 0 },
				{ field_id: 'field.volume', weight: 0 }
			]
		});
		expect(result.isError, 'All-zero weights cannot be normalized and must be rejected').toBe(true);
		const body = jsonOf(result) as { message: string };
		expect(body.message, 'The rejection must explain the weight problem').toMatch(/weight/i);
	});

	it('test_clearingTheRanking_setsRankingToNull', async () => {
		const { workspaceId, screenerId } = seedScreener();
		await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [{ field_id: 'field.price.close' }]
		});

		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: []
		});
		expect(
			result.isError,
			`Expected clearing to succeed, got ${JSON.stringify(jsonOf(result))}`
		).toBeUndefined();
		const body = jsonOf(result) as { ranking: unknown };
		expect(body.ranking, 'The response must echo the cleared ranking as null').toBeNull();

		const stored = storedScreener(workspaceId, screenerId);
		expect(
			stored.ranking,
			'The stored screener must be in the documented "no ranking set" state'
		).toBeNull();
	});

	it('test_staleExpectedRevision_isRejected_withoutMutating', async () => {
		const { workspaceId, screenerId } = seedScreener();
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [{ field_id: 'field.price.close' }],
			expected_revision: 999
		});
		expect(result.isError, 'A stale expected_revision must be rejected').toBe(true);
		const body = jsonOf(result) as { error: string };
		expect(body.error, 'The rejection must be a structured revision conflict').toBe(
			'revision_conflict'
		);

		const stored = storedScreener(workspaceId, screenerId);
		expect(
			stored.ranking,
			'A rejected revision-conflict call must not mutate the screener'
		).toBeNull();
	});

	it('test_repeatedIdempotencyKey_replaysTheOriginalResult', async () => {
		const { workspaceId, screenerId } = seedScreener();
		const args = {
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [{ field_id: 'field.price.close' }],
			idempotency_key: 'set-ranking-1'
		};
		const first = jsonOf(await tool().execute(args)) as { change_id: string };
		const second = jsonOf(await tool().execute(args)) as { change_id: string };
		expect(second.change_id, 'A replayed idempotency_key must return the original change_id').toBe(
			first.change_id
		);
	});

	it('test_acceptedChange_advancesScreenerRevision_andReturnsUndoToken', async () => {
		const { workspaceId, screenerId } = seedScreener();
		const before = storedScreener(workspaceId, screenerId).revision;
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			fields: [{ field_id: 'field.price.close' }]
		});
		const body = jsonOf(result) as { undo_token: string | null; new_revision: number };
		expect(
			body.undo_token,
			'An accepted mutation must return a redeemable undo token'
		).not.toBeNull();

		const after = storedScreener(workspaceId, screenerId).revision;
		expect(after, "The screener's own revision must advance on acceptance").toBe(before + 1);
	});

	it('test_unknownScreenerId_isRejected', async () => {
		const { workspaceId } = seedScreener();
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: 'screener_404',
			fields: [{ field_id: 'field.price.close' }]
		});
		expect(result.isError, 'An unknown screener_id must be rejected').toBe(true);
	});
});
