import { beforeEach, describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../catalog/registry';
import type { ScreenerMarketData, SeriesPoint } from '../../screener/ports';
import { readScreener, writeScreener } from '../../screener/state';
import { createScreener } from '../../screener/definition';
import type { TemporalCondition } from '../../screener/conditions';
import { createChangeHistory, undoChange } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createOperationRegistry } from '../../workbench/application/operationRegistry';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import type { Clock } from '../../workbench/domain/ports';
import type { MarketDataProvenance } from '../../workbench/domain/provenance';
import { emptyWorkspace } from '../../workbench/domain/workspace';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import type { ToolResult } from '../types';
import { createDefineScreenerTool, type DefineScreenerDeps } from './defineScreener';

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

function fakeMarketData(resolvedIds: string[]): ScreenerMarketData {
	return {
		resolveUniverse: async () => resolvedIds,
		getFieldValue: async () => null,
		getSeries: async (): Promise<SeriesPoint[]> => [],
		detectPattern: async () => null,
		getStudyOutput: async () => null,
		getProvenance: async () => {
			throw new Error('not used by these tests');
		}
	};
}

interface DefineResponse {
	screener_id: string;
	screener_revision: number;
	change_id: string;
	new_revision: number;
	undo_token: string | null;
	valid: boolean;
	warnings: string[];
}

interface FailureResponse {
	error: string;
	valid: boolean;
	problems: { severity: string; code: string; message: string }[];
	warnings: string[];
}

function scalarCondition(fieldId = 'field.price.close', value: unknown = 10) {
	return { type: 'scalar', fieldId, operator: 'op.greater_than', value, unit: null };
}

describe('define_screener', () => {
	let deps: DefineScreenerDeps;

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
			idempotency,
			catalog: builtinCatalogRegistry
		};
	});

	function seedWorkspace(): string {
		const workspaceId = deps.ids.next('workspace');
		const doc = emptyWorkspace(workspaceId, 'Test Workspace', deps.clock.now());
		deps.repository.put(doc);
		deps.repository.setActiveId(workspaceId);
		return workspaceId;
	}

	function tool() {
		return createDefineScreenerTool(deps);
	}

	// AC1
	it('createsANewScreenerAtRevision1_andSetsItAsTheWorkspacesCurrentScreener', async () => {
		const workspaceId = seedWorkspace();
		const result = await tool().execute({
			workspace_id: workspaceId,
			universe: { asset_class: 'equity' },
			conditions: scalarCondition(),
			ranking: { fields: [{ field_id: 'field.volume', direction: 'desc' }] },
			limit: 20
		});
		expect(
			result.isError,
			`expected success, got ${JSON.stringify(jsonOf(result))}`
		).toBeUndefined();
		const body = jsonOf(result) as DefineResponse;
		expect(body.screener_revision, 'a freshly created screener starts at revision 1').toBe(1);
		expect(body.valid).toBe(true);

		const doc = deps.repository.get(workspaceId)!;
		expect(doc.screenerId, 'the workspace pointer must be set to the new screener').toBe(
			body.screener_id
		);
		const screener = readScreener(doc, body.screener_id);
		expect(screener?.universe.assetClass).toBe('equity');
		expect(screener?.filterTree.kind).toBe('group');
		expect((screener?.filterTree as { children: unknown[] }).children).toHaveLength(1);
		expect(screener?.ranking?.limit).toBe(20);
		expect(screener?.ranking?.fields).toEqual([
			{ fieldId: 'field.volume', direction: 'desc', weight: 1 }
		]);
	});

	// AC2
	it('redefinesTheCurrentScreener_asANewRevision_fullReplace_omittedFieldsResetRatherThanCarryOver', async () => {
		const workspaceId = seedWorkspace();
		const first = jsonOf(
			await tool().execute({
				workspace_id: workspaceId,
				universe: { asset_class: 'equity' },
				conditions: scalarCondition(),
				ranking: { fields: [{ field_id: 'field.volume', direction: 'desc' }] }
			})
		) as DefineResponse;

		const second = jsonOf(
			await tool().execute({
				workspace_id: workspaceId,
				universe: { asset_class: 'etf' }
				// conditions, ranking omitted -- must reset, not carry over
			})
		) as DefineResponse;

		expect(second.screener_id, 'the same current screener must be targeted, not a new one').toBe(
			first.screener_id
		);
		expect(second.screener_revision, "the screener's own revision must advance by one").toBe(
			first.screener_revision + 1
		);

		const doc = deps.repository.get(workspaceId)!;
		const screener = readScreener(doc, second.screener_id);
		expect(screener?.universe.assetClass).toBe('etf');
		expect(
			(screener?.filterTree as { children: unknown[] }).children,
			'an omitted "conditions" must reset the tree to empty, not keep the prior one'
		).toHaveLength(0);
		expect(
			screener?.ranking,
			'an omitted "ranking" must reset to null, not keep the prior one'
		).toBeNull();
	});

	// AC3
	it('explicitUnknownScreenerId_isRejected_namingIt_nothingCreatedOrChanged', async () => {
		const workspaceId = seedWorkspace();
		const before = deps.repository.get(workspaceId)!;

		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: 'screener_404',
			conditions: scalarCondition()
		});

		expect(result.isError, 'an unrecognized explicit screener_id must be rejected').toBe(true);
		const body = jsonOf(result) as { error: string };
		expect(body.error, 'the rejection must name the unrecognized id').toContain('screener_404');

		const after = deps.repository.get(workspaceId)!;
		expect(after, 'nothing may be created or changed on this workspace').toEqual(before);
	});

	// AC4
	it('collectsEveryProblemInThePayloadTogether_notJustTheFirstOneFound', async () => {
		const workspaceId = seedWorkspace();
		const result = await tool().execute({
			workspace_id: workspaceId,
			universe: { indexes: ['universe.no_such_index'] },
			conditions: [
				scalarCondition('field.no_such_field'),
				scalarCondition('field.price.close', -10) // below field.price.close's declared min of 0
			]
		});
		expect(result.isError, 'a payload with multiple problems must be rejected').toBe(true);
		const body = jsonOf(result) as FailureResponse;
		expect(body.valid).toBe(false);
		const messages = body.problems.map((p) => p.message).join(' | ');
		expect(messages, 'the unknown index must be reported').toContain('universe.no_such_index');
		expect(messages, 'the unknown field must be reported').toContain('field.no_such_field');
		expect(messages, 'the out-of-range value must be reported').toMatch(/range|outside/i);
		expect(
			body.problems.length,
			`expected at least 3 independent problems, got ${JSON.stringify(body.problems)}`
		).toBeGreaterThanOrEqual(3);
	});

	// AC5
	it('approximatesGranularity_whenTheRequestedIntervalCannotBeServed_andStatesTheGranularityUsed', async () => {
		const workspaceId = seedWorkspace();
		const temporal: TemporalCondition = {
			type: 'temporal',
			condition: scalarCondition() as never,
			event: 'became_true',
			withinBars: 5,
			intervalId: 'interval.1h'
		};
		const result = await tool().execute({
			workspace_id: workspaceId,
			conditions: temporal
		});
		expect(
			result.isError,
			`expected success, got ${JSON.stringify(jsonOf(result))}`
		).toBeUndefined();
		const body = jsonOf(result) as DefineResponse;
		expect(
			body.warnings.some((w) => w.includes('interval.1h') && w.includes('interval.1d')),
			`expected a granularity-approximation warning, got ${JSON.stringify(body.warnings)}`
		).toBe(true);

		const doc = deps.repository.get(workspaceId)!;
		const screener = readScreener(doc, body.screener_id)!;
		const stored = (screener.filterTree as { children: { condition: TemporalCondition }[] })
			.children[0]?.condition;
		expect(stored?.intervalId, 'the stored condition must use the granularity actually used').toBe(
			'interval.1d'
		);
	});

	// AC6
	it('doesNotRejectALookbackLongerThanIsKnownToFit_thatIsAnExecutionTimeConcern_notDefinition', async () => {
		const workspaceId = seedWorkspace();
		const temporal: TemporalCondition = {
			type: 'temporal',
			condition: scalarCondition() as never,
			event: 'became_true',
			withinBars: 100_000, // far longer than any real instrument's history
			intervalId: 'interval.1d'
		};
		const result = await tool().execute({ workspace_id: workspaceId, conditions: temporal });
		expect(
			result.isError,
			'define_screener has no per-instrument history to check against; a large lookback is not, ' +
				'by itself, a definition-time problem'
		).toBeUndefined();
	});

	// AC7 (success shape)
	it('onSuccess_returnsTheScreenerIdAndRevision_andValidTrue', async () => {
		const workspaceId = seedWorkspace();
		const result = await tool().execute({
			workspace_id: workspaceId,
			conditions: scalarCondition()
		});
		const body = jsonOf(result) as DefineResponse;
		expect(typeof body.screener_id).toBe('string');
		expect(typeof body.screener_revision).toBe('number');
		expect(body.valid).toBe(true);
	});

	// AC7 (never a partial commit)
	it('onFailure_neverPartiallyCommits_noScreenerCreated_noWorkspaceRevisionAdvance', async () => {
		const workspaceId = seedWorkspace();
		const before = deps.repository.get(workspaceId)!;
		const result = await tool().execute({
			workspace_id: workspaceId,
			conditions: scalarCondition('field.no_such_field')
		});
		expect(result.isError).toBe(true);
		const after = deps.repository.get(workspaceId)!;
		expect(after.revision, 'the workspace revision must not advance on a rejected call').toBe(
			before.revision
		);
		expect(after.screenerId, 'no current screener may be set on a rejected create').toBeNull();
		expect(
			deps.history.list(workspaceId, {}),
			'a rejected call must leave no change history entry'
		).toEqual([]);
	});

	it('limitAlone_setsARankingLimit_withoutRequiringRankingFields_soMakeItTopNWorks', async () => {
		const workspaceId = seedWorkspace();
		const result = await tool().execute({ workspace_id: workspaceId, limit: 20 });
		const body = jsonOf(result) as DefineResponse;
		const doc = deps.repository.get(workspaceId)!;
		const screener = readScreener(doc, body.screener_id);
		expect(
			screener?.ranking?.limit,
			'"make it top 20" must be honored with no ranking fields given'
		).toBe(20);
	});

	it('explicitScreenerId_addressingAnExistingScreener_doesNotRepointTheWorkspacesCurrentScreener', async () => {
		const workspaceId = seedWorkspace();
		const first = jsonOf(
			await tool().execute({ workspace_id: workspaceId, conditions: scalarCondition() })
		) as DefineResponse;

		// A second, concurrent screener injected directly (no tool surfaces
		// creating one; the data model still supports it per the ticket's Out
		// of Scope note).
		const doc = deps.repository.get(workspaceId)!;
		const second = createScreener(deps.ids, workspaceId, 'Second');
		deps.repository.put(writeScreener(doc, second));

		await tool().execute({
			workspace_id: workspaceId,
			screener_id: second.screenerId,
			conditions: scalarCondition('field.volume')
		});

		const after = deps.repository.get(workspaceId)!;
		expect(
			after.screenerId,
			'an explicit screener_id must not repoint the workspace current-screener pointer'
		).toBe(first.screener_id);
	});

	it('isReversibleViaItsUndoToken', async () => {
		const workspaceId = seedWorkspace();
		const created = jsonOf(
			await tool().execute({ workspace_id: workspaceId, conditions: scalarCondition() })
		) as DefineResponse;
		expect(created.undo_token).not.toBeNull();

		undoChange(created.undo_token!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: { actor: 'agent' }
		});

		const doc = deps.repository.get(workspaceId)!;
		expect(
			readScreener(doc, created.screener_id),
			'undo must remove the created screener'
		).toBeNull();
	});

	it('replaysARepeatedIdempotencyKey_insteadOfDefiningTwice', async () => {
		const workspaceId = seedWorkspace();
		const args = {
			workspace_id: workspaceId,
			conditions: scalarCondition(),
			idempotency_key: 'k-1'
		};
		const first = jsonOf(await tool().execute(args)) as DefineResponse;
		const second = jsonOf(await tool().execute(args)) as DefineResponse;
		expect(second.change_id, 'a replayed call must return the original change_id').toBe(
			first.change_id
		);
		expect(second.screener_id).toBe(first.screener_id);

		const doc = deps.repository.get(workspaceId)!;
		const screenerMap = doc.extensions.screener as Record<string, unknown>;
		expect(
			Object.keys(screenerMap),
			'exactly one screener must exist despite the repeated call'
		).toHaveLength(1);
	});

	it('rejectsAStaleExpectedRevision_withoutChangingAnything', async () => {
		const workspaceId = seedWorkspace();
		const result = await tool().execute({
			workspace_id: workspaceId,
			conditions: scalarCondition(),
			expected_revision: 999
		});
		expect(result.isError, 'a stale expected_revision must be rejected').toBe(true);
		const body = jsonOf(result) as { error: string };
		expect(body.error).toBe('revision_conflict');
		const doc = deps.repository.get(workspaceId)!;
		expect(doc.screenerId, 'nothing may be created on a revision conflict').toBeNull();
	});

	it('rawCodeOnACondition_isRejected_theTreeDefinitionIsNeverStoredWithIt', async () => {
		const workspaceId = seedWorkspace();
		const result = await tool().execute({
			workspace_id: workspaceId,
			conditions: { ...scalarCondition(), expression: "1=1 OR 'x'='x'" }
		});
		expect(result.isError, 'a condition carrying a free-form field must be rejected').toBe(true);
		const body = jsonOf(result) as FailureResponse;
		expect(body.problems.some((p) => p.message.includes('expression'))).toBe(true);
	});

	it('storesAndEchoesAnOptionalName_asALabelOnly', async () => {
		const workspaceId = seedWorkspace();
		const result = await tool().execute({ workspace_id: workspaceId, name: 'Momentum Screen' });
		const body = jsonOf(result) as DefineResponse;
		const doc = deps.repository.get(workspaceId)!;
		expect(readScreener(doc, body.screener_id)?.name).toBe('Momentum Screen');
	});

	it('emptyResolvingUniverse_isReportedAsABlockingProblem_whenMarketDataResolvesToZero', async () => {
		const workspaceId = seedWorkspace();
		deps.marketData = fakeMarketData([]);
		const result = await tool().execute({
			workspace_id: workspaceId,
			universe: { asset_class: 'equity' },
			conditions: scalarCondition()
		});
		expect(result.isError, 'a genuinely empty-resolving universe must block the definition').toBe(
			true
		);
		const body = jsonOf(result) as FailureResponse;
		expect(body.problems.some((p) => /zero instruments/i.test(p.message))).toBe(true);
	});
});
