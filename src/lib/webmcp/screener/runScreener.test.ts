import { beforeEach, describe, expect, it } from 'vitest';
import { emptyFilterTree, type ScreenerDefinition } from '../../screener/definition';
import type { RunRetentionPolicy } from '../../screener/ports';
import type { ScreenerEvaluationPort } from '../../screener/ports';
import {
	makeScreenerRun,
	toWireScreenerRun,
	type ScreenerMatch,
	type ScreenerRun,
	type ScreenerRunOutcome,
	type ScreenerRunRefusal
} from '../../screener/run';
import { createPinnedRunStore } from '../../screener/runStore';
import { PROBLEM_CODES } from '../../screener/validation';
import { createPanel, readPanelState, type PanelUseCaseDeps } from '../../panels/application';
import {
	createLayoutTemplateRegistry,
	registerDefaultLayoutTemplates
} from '../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../panels/registry/panelKindRegistry';
import { registerDefaultPanelKinds } from '../../panels/registry/defaultPanelKinds';
import { createSourceRendererRegistry } from '../../panels/registry/sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from '../../panels/registry/defaultSourceRendererTypes';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createOperationRegistry } from '../../workbench/application/operationRegistry';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import type { Clock } from '../../workbench/domain/ports';
import { makeProvenance, type MarketDataProvenance } from '../../workbench/domain/provenance';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { createCreateScreenerTool } from './createScreener';
import { createRunScreenerTool, type PanelBindingDeps } from './runScreener';
import { createSetScreenerRankingTool } from './setScreenerRanking';
import type { ToolResult } from '../types';

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

function fixtureProvenance(): MarketDataProvenance {
	return makeProvenance({
		asOf: '2026-09-02T14:30:00.000Z',
		sourceId: 'src.screener.engine.fixture',
		sourceLabel: 'Fixture screener engine',
		liveness: 'end_of_day',
		timezone: 'America/New_York'
	});
}

function testMatch(instrumentId: string, rank: number): ScreenerMatch {
	return {
		instrumentId,
		symbol: instrumentId,
		exchange: 'XNAS',
		assetType: 'equity',
		name: instrumentId,
		rank,
		compositeScore: null,
		rankingValues: {},
		nodeEvaluations: {
			filter_1: { nodeId: 'filter_1', passed: true, value: null }
		}
	};
}

interface EvaluationInput {
	definition: ScreenerDefinition;
	runId: string;
}

interface FakePort {
	port: ScreenerEvaluationPort;
	callCount: () => number;
}

// A counting fake standing in for T-1009-7's real engine: this ticket's
// job is proving run_screener orchestrates correctly (mints an id, calls
// execute exactly when it should, stores/shapes what execute returns), not
// re-testing the engine's own evaluation logic (engine.test.ts already
// covers that).
function makeFakePort(buildOutcome: (input: EvaluationInput) => ScreenerRunOutcome): FakePort {
	let calls = 0;
	const port: ScreenerEvaluationPort = {
		async validate(definition) {
			return {
				screenerId: definition.screenerId,
				screenerRevision: definition.revision,
				valid: true,
				problems: [],
				skippedNodeIds: [],
				costEstimate: null,
				detectionExhaustive: false
			};
		},
		async execute(input) {
			calls += 1;
			return buildOutcome(input);
		}
	};
	return { port, callCount: () => calls };
}

function completeRunFor(
	input: EvaluationInput,
	opts: {
		matches?: ScreenerMatch[];
		universeCount?: number;
		matchedCount?: number;
		truncated?: boolean;
		warnings?: ScreenerRun['warnings'];
	} = {}
): ScreenerRun {
	const matches = opts.matches ?? [testMatch('inst:XNAS:AAPL', 1)];
	const matchedCount = opts.matchedCount ?? matches.length;
	return makeScreenerRun({
		runId: input.runId,
		screenerId: input.definition.screenerId,
		screenerRevision: input.definition.revision,
		status: 'complete',
		universeCount: opts.universeCount ?? 100,
		matchedCount,
		returnedCount: matches.length,
		truncated: opts.truncated ?? matches.length < matchedCount,
		rankingApplied: false,
		normalization: null,
		warnings: opts.warnings ?? [],
		provenance: fixtureProvenance(),
		matches,
		rejectedEvaluations: {},
		filterTree: emptyFilterTree('filter_root'),
		rankingSpec: null,
		createdAt: '2026-09-02T14:30:05.000Z'
	});
}

function refusalFor(input: EvaluationInput): ScreenerRunRefusal {
	return {
		status: 'refused',
		screenerId: input.definition.screenerId,
		screenerRevision: input.definition.revision,
		problems: [
			{
				severity: 'blocking',
				code: PROBLEM_CODES.invalidParameter,
				nodeIds: [],
				universeCriteria: [],
				message: 'Fixture blocking problem.'
			}
		]
	};
}

describe('run_screener', () => {
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

	async function seedScreener(): Promise<{ workspaceId: string; screenerId: string }> {
		const workspaceId = deps.ids.next('workspace');
		const created = jsonOf(
			await createCreateScreenerTool(deps).execute({
				workspace_id: workspaceId,
				name: 'Test Screener'
			})
		) as { affected_ids: string[] };
		const screenerId = created.affected_ids[0];
		if (!screenerId) {
			throw new Error('create_screener did not return a screener id.');
		}
		deps.repository.setActiveId(workspaceId);
		return { workspaceId, screenerId };
	}

	// T-0020-12: an agent conflated expected_revision (the workspace's own
	// revision) with screener_revision (the screener definition's own
	// revision) live, 2026-09-04 -- expected_revision's schema description
	// was empty, giving the agent nothing to disambiguate the two from.
	it("test_inputSchema_expectedRevisionDescription_namesItAsTheWorkspaceRevision", () => {
		const tool = createRunScreenerTool(deps);
		const schema = tool.inputSchema as {
			properties: Record<string, { description?: string }>;
		};
		const expectedRevisionDescription = schema.properties.expected_revision?.description ?? '';
		expect(
			expectedRevisionDescription.length,
			'T-0020-12: expected_revision must have a non-empty description distinguishing it from screener_revision'
		).toBeGreaterThan(0);
		expect(
			/workspace/i.test(expectedRevisionDescription),
			`T-0020-12: expected_revision's description must name it as the workspace's own revision, got: "${expectedRevisionDescription}"`
		).toBe(true);
	});

	// A real mutation through the shipped write path -- AC2's "editing the
	// screener afterwards" needs the screener's own revision to actually
	// advance, not a hand-rolled document edit.
	async function bumpScreenerRevision(workspaceId: string, screenerId: string): Promise<void> {
		const result = jsonOf(
			await createSetScreenerRankingTool(deps).execute({
				workspace_id: workspaceId,
				screener_id: screenerId,
				fields: [{ field_id: 'field.volume' }]
			})
		) as { error?: string };
		if (result.error) {
			throw new Error(`set_screener_ranking failed: ${JSON.stringify(result)}`);
		}
	}

	it('test_runScreener_validScreener_createsRunWithSummary', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port });

		const result = await tool.execute({ workspace_id: workspaceId, screener_id: screenerId });
		const json = jsonOf(result) as Record<string, unknown>;

		expect(result.isError, 'a valid run must not be a tool error').toBeFalsy();
		expect(typeof json.run_id, 'AC1: a completed run must carry a run_ id').toBe('string');
		expect(json.screener_id, 'AC1: the run must name the screener it executed').toBe(screenerId);
		expect(json.screener_revision, 'a freshly created screener starts at revision 1').toBe(1);
		expect(json.status, 'a valid run completes').toBe('complete');
		expect(json.universe_count, 'AC1: the universe count must be reported').toBe(100);
		expect(json.matched_count, 'AC1: the matched count must be reported').toBe(1);
		expect(json.returned_count, 'AC1: the returned count must be reported').toBe(1);
		expect(Array.isArray(json.warnings), 'AC1: warnings must be an array, even if empty').toBe(
			true
		);
		expect(json.provenance, 'AC6: every run must carry provenance').toBeTruthy();
	});

	// AC2 (deviation note, T-1009-10): validate_screener and run_screener are
	// browser-side tools over ScreenerEvaluationPort, not HTTP calls -- but a
	// rejected promise from the port (an unavailable data source, a broken
	// adapter) must still surface as a tool error an agent can act on, never
	// an unhandled rejection escaping this async function.
	it('test_runScreener_evaluationPortRejects_surfacesAsToolErrorNotUnhandledRejection', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const rejectingPort: ScreenerEvaluationPort = {
			async validate(definition) {
				return {
					screenerId: definition.screenerId,
					screenerRevision: definition.revision,
					valid: true,
					problems: [],
					skippedNodeIds: [],
					costEstimate: null,
					detectionExhaustive: false
				};
			},
			execute() {
				return Promise.reject(new Error('fixture: market data source unreachable'));
			}
		};
		const tool = createRunScreenerTool(deps, { evaluationPort: rejectingPort });

		const result = await tool.execute({ workspace_id: workspaceId, screener_id: screenerId });

		expect(
			result.isError,
			'a rejected evaluation port must resolve to a tool failure, not reject the promise ' +
				'run_screener itself returns'
		).toBe(true);
		const json = jsonOf(result) as Record<string, unknown>;
		expect(
			json.error,
			'the rejection reason should be readable in the tool error, not swallowed'
		).toContain('fixture: market data source unreachable');
	});

	it('test_runScreener_screenerEditedAfterRun_runStaysPinned', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const fake = makeFakePort((input) => completeRunFor(input));
		const store = createPinnedRunStore();
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, runStore: store });

		const before = jsonOf(
			await tool.execute({ workspace_id: workspaceId, screener_id: screenerId })
		) as { run_id: string; screener_revision: number };
		expect(before.screener_revision, 'the run pins the revision it executed').toBe(1);

		await bumpScreenerRevision(workspaceId, screenerId);

		const stored = store.getRun(before.run_id);
		expect(
			'available' in stored,
			'AC2: the pinned run must still be retrievable after the later edit'
		).toBe(false);
		if (!('available' in stored)) {
			expect(
				toWireScreenerRun(stored),
				'AC2: a later edit must not change anything a previously minted run reports'
			).toEqual(before);
		}
	});

	it('test_runScreener_explicitRetainedRevision_runsThatRevision', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		await bumpScreenerRevision(workspaceId, screenerId); // screener now at revision 2

		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port });

		const result = await tool.execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			screener_revision: 1
		});
		const json = jsonOf(result) as { screener_revision: number };

		expect(result.isError, 'AC3: a retained explicit revision must be accepted').toBeFalsy();
		expect(json.screener_revision, 'AC3: the run must execute exactly the named revision').toBe(1);
		expect(fake.callCount(), 'exactly one evaluation must run').toBe(1);
	});

	it('test_runScreener_explicitUnretainedRevision_isRejected', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port });

		const result = await tool.execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			screener_revision: 999
		});
		const json = jsonOf(result) as { error?: string };

		expect(result.isError, 'AC3: an unretained explicit revision must be rejected').toBe(true);
		expect(json.error, 'the failure must be reported as an operation validation error').toBe(
			'operation_validation_error'
		);
		expect(fake.callCount(), 'AC3: a rejected revision must never reach the evaluation port').toBe(
			0
		);
	});

	it('test_runScreener_readRunAfterExecute_doesNotReexecute', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const nodeEvaluations = {
			filter_1: { nodeId: 'filter_1', passed: true, value: 42, unit: 'usd' }
		};
		const fake = makeFakePort((input) =>
			completeRunFor(input, {
				matches: [{ ...testMatch('inst:XNAS:AAPL', 1), nodeEvaluations }]
			})
		);
		const store = createPinnedRunStore();
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, runStore: store });

		const { run_id: runId } = jsonOf(
			await tool.execute({ workspace_id: workspaceId, screener_id: screenerId })
		) as { run_id: string };

		store.getRun(runId);
		const matches = store.getMatches(runId, 0, 10);

		expect(
			fake.callCount(),
			'AC4/AC5: reading a stored run back must never call the evaluation port again'
		).toBe(1);
		expect('available' in matches, 'the run must be readable by id').toBe(false);
		if (!('available' in matches)) {
			expect(
				matches[0]?.nodeEvaluations,
				'AC4: per-node evaluations must be preserved in the stored match'
			).toEqual(nodeEvaluations);
		}
	});

	it('test_runScreener_evictedRun_reportsRunNotAvailable', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const fake = makeFakePort((input) => completeRunFor(input));
		const alwaysEvict: RunRetentionPolicy = { shouldEvict: () => true };
		const store = createPinnedRunStore({ policy: alwaysEvict });
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, runStore: store });

		const { run_id: runId } = jsonOf(
			await tool.execute({ workspace_id: workspaceId, screener_id: screenerId })
		) as { run_id: string };

		const read = store.getRun(runId);
		expect(
			'available' in read,
			'AC5/AC11: an evicted run must fail explicitly, never fall back to a fresh rerun'
		).toBe(true);
		if ('available' in read) {
			expect(
				read.reason,
				'a run this store held and reclaimed reports "evicted", not "unknown"'
			).toBe('evicted');
		}
	});

	it('test_runScreener_blockingProblems_refusesAndMintsNoRun', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const fake = makeFakePort((input) => refusalFor(input));
		const store = createPinnedRunStore();
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, runStore: store });

		const result = await tool.execute({ workspace_id: workspaceId, screener_id: screenerId });
		const json = jsonOf(result) as Record<string, unknown>;

		expect(
			result.isError,
			'AC7: a refusal is a well-formed answer, not a tool failure'
		).toBeFalsy();
		expect(json.status, 'AC7: blocking problems must refuse the run').toBe('refused');
		expect(json.run_id, 'AC7: a refusal must never carry a run_id').toBeUndefined();
		expect(
			Array.isArray(json.problems) && (json.problems as unknown[]).length > 0,
			'AC7: the blocking problems must be returned'
		).toBe(true);

		// The id run_screener minted internally before the port refused is
		// discarded -- assert the store never received anything under it.
		const probe = store.getRun('run_1');
		expect('available' in probe, 'AC7: nothing may be stored under the discarded run id').toBe(
			true
		);
		if ('available' in probe) {
			expect(probe.reason, 'the store never received this id at all').toBe('unknown');
		}
	});

	it('test_runScreener_nothingMatches_reportsZeroMatchedWithWarning', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const fake = makeFakePort((input) =>
			completeRunFor(input, {
				matches: [],
				matchedCount: 0,
				warnings: [{ code: 'empty_result', message: 'No instrument satisfied the filter tree.' }]
			})
		);
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port });

		const result = await tool.execute({ workspace_id: workspaceId, screener_id: screenerId });
		const json = jsonOf(result) as Record<string, unknown>;

		expect(result.isError, 'AC8: zero matches is a normal result, not an error').toBeFalsy();
		expect(json.matched_count, 'AC8: a normal run may report zero matches').toBe(0);
		expect(
			Array.isArray(json.warnings) && (json.warnings as unknown[]).length > 0,
			'AC8: zero matches must carry a warning'
		).toBe(true);
	});

	it('test_runScreener_overLimit_reportsTruncated', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const returned = [testMatch('inst:A', 1), testMatch('inst:B', 2)];
		const fake = makeFakePort((input) =>
			completeRunFor(input, { matches: returned, matchedCount: 10, truncated: true })
		);
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port });

		const result = await tool.execute({ workspace_id: workspaceId, screener_id: screenerId });
		const json = jsonOf(result) as Record<string, unknown>;

		expect(json.matched_count, 'AC9: the total matched count must be reported').toBe(10);
		expect(json.returned_count, 'AC9: the returned count reflects only what was stored').toBe(2);
		expect(json.truncated, 'AC9: truncation must be explicit').toBe(true);
	});

	it('test_runScreener_replayedIdempotencyKey_returnsOriginalRunWithoutSecondExecution', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port });
		const input = { workspace_id: workspaceId, screener_id: screenerId, idempotency_key: 'key-1' };

		const first = jsonOf(await tool.execute(input)) as { run_id: string };
		const second = jsonOf(await tool.execute(input)) as { run_id: string };

		expect(fake.callCount(), 'AC10: a replayed key must not execute a second query').toBe(1);
		expect(second.run_id, 'AC10: a replay must return the original run_id').toBe(first.run_id);
	});

	it('test_runScreener_staleExpectedRevision_isRejected', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port });

		const result = await tool.execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			expected_revision: 999
		});
		const json = jsonOf(result) as { error?: string };

		expect(result.isError, 'a stale expected_revision must be rejected').toBe(true);
		expect(json.error, 'the failure must be reported as a revision conflict').toBe(
			'revision_conflict'
		);
		expect(fake.callCount(), 'a rejected call must never reach the evaluation port').toBe(0);
	});
});

// T-0020-2: auto-binding a completed run to the workspace's first
// results_table panel. Builds real panel registries (not fakes) so
// bindPanelSource's own validateSource path actually runs, matching AC1's
// "the existing bind_panel_source application logic ... not a
// parallel/duplicate binding path".
describe('run_screener: auto-bind to the results_table panel (T-0020-2)', () => {
	let deps: WorkbenchDeps;
	let panelBinding: PanelBindingDeps;

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

		const kinds = createPanelRegistry();
		registerDefaultPanelKinds(kinds);
		const sourceRenderer = createSourceRendererRegistry();
		registerDefaultSourceRendererTypes(sourceRenderer);
		const templates = createLayoutTemplateRegistry();
		registerDefaultLayoutTemplates(templates);
		panelBinding = { kinds, sourceRenderer, templates };
	});

	async function seedScreener(): Promise<{ workspaceId: string; screenerId: string }> {
		const workspaceId = deps.ids.next('workspace');
		const created = jsonOf(
			await createCreateScreenerTool(deps).execute({
				workspace_id: workspaceId,
				name: 'Test Screener'
			})
		) as { affected_ids: string[] };
		const screenerId = created.affected_ids[0];
		if (!screenerId) {
			throw new Error('create_screener did not return a screener id.');
		}
		deps.repository.setActiveId(workspaceId);
		return { workspaceId, screenerId };
	}

	function panelUseCaseDeps(workspaceId: string): PanelUseCaseDeps {
		return {
			workspaceId,
			repository: deps.repository,
			revisions: deps.revisions,
			history: deps.history,
			clock: deps.clock,
			ids: deps.ids,
			kinds: panelBinding.kinds,
			sourceRenderer: panelBinding.sourceRenderer,
			templates: panelBinding.templates
		};
	}

	function resultsTablePanelSource(workspaceId: string): unknown {
		const doc = deps.repository.get(workspaceId);
		if (!doc) {
			throw new Error(`Workspace not found: ${workspaceId}`);
		}
		const panel = readPanelState(doc).panels.find((p) => p.kind === 'results_table');
		return panel?.source ?? null;
	}

	it('test_runScreener_seededResultsTablePanel_bindsPanelSourceToNewRun', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		createPanel(panelUseCaseDeps(workspaceId), {
			context: { actor: 'agent' },
			kind: 'results_table'
		});
		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, panelBinding });

		const result = await tool.execute({ workspace_id: workspaceId, screener_id: screenerId });
		const json = jsonOf(result) as { run_id: string };

		expect(result.isError, 'AC2: the run itself must still succeed').toBeFalsy();
		expect(
			resultsTablePanelSource(workspaceId),
			'AC1: the panel source resolves to the new run'
		).toEqual({
			type: 'screener_results',
			ref: { run_id: json.run_id }
		});
	});

	it('test_runScreener_noResultsTablePanel_stillSucceedsAndReturnsRunId', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		// No results_table panel created at all -- AC2's "seeded one was closed".
		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, panelBinding });

		const result = await tool.execute({ workspace_id: workspaceId, screener_id: screenerId });
		const json = jsonOf(result) as { run_id: string };

		expect(result.isError, 'AC2: binding is best-effort, never a precondition').toBeFalsy();
		expect(typeof json.run_id, 'AC2: the run must still return its run_id').toBe('string');
	});

	// T-0020-10: previously bindRunToResultsPanel silently no-oped when no
	// results_table panel existed (test above), leaving nothing for a user
	// to see. Now it creates one via the same createPanel() path an agent's
	// create_panel call would use, then binds it -- see
	// docs/design/workbench-composition-root/spec.md's "Create-if-absent
	// results panel".
	it('test_runScreener_noResultsTablePanel_createsOneAndBindsIt', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, panelBinding });

		const result = await tool.execute({ workspace_id: workspaceId, screener_id: screenerId });
		const json = jsonOf(result) as { run_id: string };

		expect(result.isError, 'the run itself must still succeed').toBeFalsy();
		const doc = deps.repository.get(workspaceId);
		const resultsPanels = doc
			? readPanelState(doc).panels.filter((p) => p.kind === 'results_table')
			: [];
		expect(
			resultsPanels,
			'T-0020-10: exactly one results_table panel must be auto-created'
		).toHaveLength(1);
		const panel = resultsPanels[0];
		expect(panel?.rect.colSpan, 'T-0020-10: the auto-created panel is 2 columns wide').toBe(2);
		expect(panel?.rect.rowSpan, 'T-0020-10: the auto-created panel is 1 row tall').toBe(1);
		expect(
			panel?.source,
			"T-0020-10: the new panel's source resolves to the new run"
		).toEqual({
			type: 'screener_results',
			ref: { run_id: json.run_id }
		});
	});

	it('test_runScreener_rerunAfterAutoCreate_recyclesSamePanelRatherThanCreatingAnother', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, panelBinding });

		await tool.execute({ workspace_id: workspaceId, screener_id: screenerId });
		const docAfterFirst = deps.repository.get(workspaceId);
		const firstPanelId = docAfterFirst
			? readPanelState(docAfterFirst).panels.find((p) => p.kind === 'results_table')?.id
			: undefined;
		expect(firstPanelId, 'T-0020-10: the first run must have auto-created a panel').toBeTruthy();

		const second = jsonOf(
			await tool.execute({ workspace_id: workspaceId, screener_id: screenerId })
		) as { run_id: string };

		const docAfterSecond = deps.repository.get(workspaceId);
		const resultsPanels = docAfterSecond
			? readPanelState(docAfterSecond).panels.filter((p) => p.kind === 'results_table')
			: [];
		expect(resultsPanels, 'T-0020-10: rerunning must never create a second panel').toHaveLength(1);
		expect(resultsPanels[0]?.id, 'T-0020-10: the same panel id is recycled').toBe(firstPanelId);
		expect(
			resultsPanels[0]?.source,
			'T-0020-10: the recycled panel is rebound to the new run'
		).toEqual({
			type: 'screener_results',
			ref: { run_id: second.run_id }
		});
	});

	it('test_runScreener_secondRunAgainstBoundPanel_replacesBindingRatherThanDuplicating', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		createPanel(panelUseCaseDeps(workspaceId), {
			context: { actor: 'agent' },
			kind: 'results_table'
		});
		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, panelBinding });

		const first = jsonOf(
			await tool.execute({ workspace_id: workspaceId, screener_id: screenerId })
		) as { run_id: string };
		const second = jsonOf(
			await tool.execute({ workspace_id: workspaceId, screener_id: screenerId })
		) as { run_id: string };

		expect(second.run_id, 'two separate runs must mint two separate run ids').not.toBe(
			first.run_id
		);
		expect(
			resultsTablePanelSource(workspaceId),
			'AC4: the binding points at the second run only, not both'
		).toEqual({ type: 'screener_results', ref: { run_id: second.run_id } });

		const doc = deps.repository.get(workspaceId);
		const resultsPanels = doc
			? readPanelState(doc).panels.filter((p) => p.kind === 'results_table')
			: [];
		expect(resultsPanels, 'AC4: no duplicate panel was created by the second bind').toHaveLength(1);
	});

	// T-0020-4: the spec's "Multiple results panels present" scenario -- the
	// first results_table panel found (by workspace panel order) is bound,
	// the rest are left untouched. Implemented correctly by construction
	// (bindRunToResultsPanel's Array.find()), but nothing seeded two
	// results_table panels and asserted on the second one before this test.
	it('test_runScreener_twoResultsTablePanels_bindsOnlyTheFirstOne', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		const firstPanel = createPanel(panelUseCaseDeps(workspaceId), {
			context: { actor: 'agent' },
			kind: 'results_table',
			rect: { col: 0, row: 0, colSpan: 2, rowSpan: 4 }
		});
		const secondPanel = createPanel(panelUseCaseDeps(workspaceId), {
			context: { actor: 'agent' },
			kind: 'results_table',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 4 }
		});
		const firstPanelId = firstPanel.affectedIds[0]!;
		const secondPanelId = secondPanel.affectedIds[0]!;

		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, panelBinding });
		const result = await tool.execute({ workspace_id: workspaceId, screener_id: screenerId });
		const json = jsonOf(result) as { run_id: string };

		expect(result.isError, 'AC2: the run itself must still succeed').toBeFalsy();

		const doc = deps.repository.get(workspaceId);
		if (!doc) {
			throw new Error(`Workspace not found: ${workspaceId}`);
		}
		const panels = readPanelState(doc).panels;
		const firstSource = panels.find((p) => p.id === firstPanelId)?.source;
		const secondSource = panels.find((p) => p.id === secondPanelId)?.source;

		expect(
			firstSource,
			'the first results_table panel by workspace panel order must be bound to the new run'
		).toEqual({ type: 'screener_results', ref: { run_id: json.run_id } });
		expect(
			secondSource,
			'the second results_table panel must be left unaffected -- binding only ever touches the first'
		).toBeNull();
	});

	// T-0020-8: by code inspection, replayCache.lookup() returns before a
	// runId is even minted, so a replay can never reach
	// bindRunToResultsPanel -- but nothing in the suite proved it, and a
	// future refactor reordering the replay check relative to the binding
	// call could silently introduce a double-bind with zero test signal.
	// The workspace's own revision counter is the proof: bindPanelSource
	// commits through RevisionService, so a second bind would advance the
	// revision a second time even if the bound value ends up looking
	// identical.
	it('test_runScreener_replayedIdempotencyKey_doesNotRebindPanel', async () => {
		const { workspaceId, screenerId } = await seedScreener();
		createPanel(panelUseCaseDeps(workspaceId), {
			context: { actor: 'agent' },
			kind: 'results_table'
		});
		const fake = makeFakePort((input) => completeRunFor(input));
		const tool = createRunScreenerTool(deps, { evaluationPort: fake.port, panelBinding });
		const input = {
			workspace_id: workspaceId,
			screener_id: screenerId,
			idempotency_key: 'bind-replay-key'
		};

		const first = jsonOf(await tool.execute(input)) as { run_id: string };
		const revisionAfterFirst = deps.repository.get(workspaceId)?.revision;

		const second = jsonOf(await tool.execute(input)) as { run_id: string };
		const revisionAfterReplay = deps.repository.get(workspaceId)?.revision;

		expect(
			second.run_id,
			'AC10: a replayed key must return the original run_id, not mint a new one'
		).toBe(first.run_id);
		expect(fake.callCount(), 'a replayed key must not execute a second evaluation').toBe(1);
		expect(
			revisionAfterReplay,
			'a replay must not re-run the panel-binding side effect -- the workspace revision must not advance a second time'
		).toBe(revisionAfterFirst);
		expect(
			resultsTablePanelSource(workspaceId),
			'the panel must still resolve to the original run after a replay, not be double-processed'
		).toEqual({ type: 'screener_results', ref: { run_id: first.run_id } });
	});
});
