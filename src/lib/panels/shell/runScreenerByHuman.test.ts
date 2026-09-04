// T-0020-11: the filter panel's human "Run" control. runScreenerByHuman is
// pure logic (evaluationPort.execute -> runStore.putRun ->
// bindRunToResultsPanel(actor: 'human')) and gets real unit coverage here
// against createPanelTestHarness(), mirroring panelCloseAndActionLog.test.ts's
// own harness pattern for removePanelByHuman/readActionLog, and
// runScreener.test.ts's own fake-evaluation-port pattern for the
// run-execution path. Per the ticket's own note, this repo has no Svelte
// component-render harness -- so the disabled-when-undefined and
// in-flight-disables-a-second-run ACs are proven at the function level (the
// exact guard FilterBuilderPanel.svelte's button state defers to), not by
// mounting FilterBuilderPanel.svelte and clicking it.
import { describe, expect, it } from 'vitest';
import { createPanelTestHarness } from '../application/testSupport';
import { createPanel, readPanelState, type PanelUseCaseDeps } from '../application';
import { createScreener, emptyFilterTree, type ScreenerDefinition } from '../../screener/definition';
import { writeScreener } from '../../screener/state';
import { createPinnedRunStore } from '../../screener/runStore';
import type { PinnedRunStore, ScreenerEvaluationPort } from '../../screener/ports';
import { makeScreenerRun, type ScreenerMatch, type ScreenerRunOutcome } from '../../screener/run';
import { makeProvenance, type MarketDataProvenance } from '../../workbench/domain/provenance';
import { PROBLEM_CODES } from '../../screener/validation';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createOperationRegistry } from '../../workbench/application/operationRegistry';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { createRunScreenerTool } from '../../webmcp/screener/runScreener';
import type { ToolResult } from '../../webmcp/types';
import { initializeWorkspace, readActionLog, runScreenerByHuman } from './panelController';

interface EvaluationInput {
	definition: ScreenerDefinition;
	runId: string;
}

function jsonOf(result: ToolResult): unknown {
	const first = result.content[0];
	if (!first) {
		throw new Error('ToolResult carried no content.');
	}
	return JSON.parse(first.text);
}

// T-0020-14: run_screener.ts's own execute() needs the six WorkbenchDeps
// fields PanelUseCaseDeps doesn't carry (registry/idempotency/provenance) --
// built fresh here, sharing this harness's repository/revisions/history/
// clock/ids, exactly like the composition root would share one set of
// instances across the panel and screener tool groups (spec.md's "Shared
// composition root").
function toWorkbenchDeps(useCaseDeps: PanelUseCaseDeps): WorkbenchDeps {
	return {
		repository: useCaseDeps.repository,
		revisions: useCaseDeps.revisions,
		history: useCaseDeps.history,
		registry: createOperationRegistry(),
		provenance: { current: () => fixtureProvenance() },
		clock: useCaseDeps.clock,
		ids: useCaseDeps.ids,
		idempotency: createIdempotencyCache()
	};
}

function fixtureProvenance(): MarketDataProvenance {
	return makeProvenance({
		asOf: '2026-09-04T14:30:00.000Z',
		sourceId: 'src.screener.engine.fixture',
		sourceLabel: 'Fixture screener engine',
		liveness: 'end_of_day',
		timezone: 'America/New_York'
	});
}

function testMatch(instrumentId: string): ScreenerMatch {
	return {
		instrumentId,
		symbol: instrumentId,
		exchange: 'XNAS',
		assetType: 'equity',
		name: instrumentId,
		rank: 1,
		compositeScore: null,
		rankingValues: {},
		nodeEvaluations: { filter_1: { nodeId: 'filter_1', passed: true, value: null } }
	};
}

function completeRunFor(input: EvaluationInput): ScreenerRunOutcome {
	return makeScreenerRun({
		runId: input.runId,
		screenerId: input.definition.screenerId,
		screenerRevision: input.definition.revision,
		status: 'complete',
		universeCount: 5,
		matchedCount: 1,
		returnedCount: 1,
		truncated: false,
		rankingApplied: false,
		normalization: null,
		warnings: [],
		provenance: fixtureProvenance(),
		matches: [testMatch('inst:XNAS:AAPL')],
		rejectedEvaluations: {},
		filterTree: emptyFilterTree('filter_root'),
		rankingSpec: null,
		createdAt: '2026-09-04T14:30:05.000Z'
	});
}

interface FakePort {
	port: ScreenerEvaluationPort;
	callCount: () => number;
}

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

// A deferred completion so a test can hold a call "in flight" across two
// runScreenerByHuman() invocations before letting it resolve -- the only way
// to prove the second activation never reaches the evaluation port a second
// time.
function makeDeferredPort(): FakePort & { resolve: (outcome: ScreenerRunOutcome) => void } {
	let calls = 0;
	let release: ((outcome: ScreenerRunOutcome) => void) | null = null;
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
		execute() {
			calls += 1;
			return new Promise<ScreenerRunOutcome>((resolve) => {
				release = resolve;
			});
		}
	};
	return {
		port,
		callCount: () => calls,
		resolve: (outcome) => {
			if (!release) {
				throw new Error('fixture: execute() was never called, nothing to resolve');
			}
			release(outcome);
		}
	};
}

function seedCurrentScreener(deps: PanelUseCaseDeps): string {
	const doc = deps.repository.get(deps.workspaceId)!;
	const screener = createScreener(deps.ids, deps.workspaceId, 'My Screener');
	screener.universe.assetClass = 'equity';
	screener.universe.exchanges = ['XNAS'];
	const withScreener = writeScreener(doc, screener);
	deps.repository.put({ ...withScreener, screenerId: screener.screenerId });
	return screener.screenerId;
}

function setup(): PanelUseCaseDeps {
	const harness = createPanelTestHarness();
	const init = initializeWorkspace(harness);
	return { ...harness, workspaceId: init.workspaceId };
}

describe('runScreenerByHuman: disabled when no screener is defined', () => {
	it('reports no_screener and never calls the evaluation port', async () => {
		const useCaseDeps = setup();
		const fake = makeFakePort(completeRunFor);

		const result = await runScreenerByHuman({
			useCaseDeps,
			evaluationPort: fake.port,
			runStore: createPinnedRunStore()
		});

		expect(
			result.status,
			`expected no_screener when WorkspaceDocument.screenerId is unset, got ${JSON.stringify(result)}`
		).toBe('no_screener');
		expect(fake.callCount(), 'a run with nothing defined must never reach the engine').toBe(0);
	});
});

describe('runScreenerByHuman: a second activation while a run is in flight', () => {
	it('does not trigger a second concurrent evaluation', async () => {
		const useCaseDeps = setup();
		seedCurrentScreener(useCaseDeps);
		const deferred = makeDeferredPort();
		const runStore: PinnedRunStore = createPinnedRunStore();
		const deps = { useCaseDeps, evaluationPort: deferred.port, runStore };

		const first = runScreenerByHuman(deps);
		const second = runScreenerByHuman(deps);

		expect(
			deferred.callCount(),
			'AC: a second activation during an in-flight run must not start a second evaluation'
		).toBe(1);

		deferred.resolve(
			completeRunFor({
				runId: 'run_placeholder',
				definition: createScreener(useCaseDeps.ids, useCaseDeps.workspaceId, 'unused')
			})
		);

		const [firstResult, secondResult] = await Promise.all([first, second]);
		expect(deferred.callCount(), 'still exactly one evaluation after both settle').toBe(1);
		expect(firstResult, 'both activations must observe the same outcome').toEqual(secondResult);
	});
});

describe('runScreenerByHuman: a successful run', () => {
	it('records an action-log entry attributed to the human actor and creates the results panel', async () => {
		const useCaseDeps = setup();
		seedCurrentScreener(useCaseDeps);
		const fake = makeFakePort(completeRunFor);
		const runStore: PinnedRunStore = createPinnedRunStore();

		const result = await runScreenerByHuman({ useCaseDeps, evaluationPort: fake.port, runStore });

		expect(result.status, `expected a completed run, got ${JSON.stringify(result)}`).toBe('ok');
		expect(fake.callCount()).toBe(1);
		if (result.status !== 'ok' || result.outcome.status !== 'complete') {
			throw new Error('unreachable: asserted above');
		}
		const runId = result.outcome.runId;

		const doc = useCaseDeps.repository.get(useCaseDeps.workspaceId)!;
		const resultsPanels = readPanelState(doc).panels.filter((p) => p.kind === 'results_table');
		expect(
			resultsPanels,
			'T-0020-10: a results_table panel must be auto-created when none existed'
		).toHaveLength(1);
		expect(
			resultsPanels[0]?.source,
			'the new panel must be bound to the run just executed'
		).toEqual({ type: 'screener_results', ref: { run_id: runId } });

		const records = readActionLog(useCaseDeps);
		// Newest-first: the bind, then the create-if-absent, then the
		// initializeWorkspace create_workspace commit underneath both.
		expect(
			records[0]?.actor,
			'AC: a human-triggered run must record the panel bind as actor "human"'
		).toBe('human');
		expect(
			records[1]?.actor,
			'AC: the create-if-absent results panel step must also record actor "human"'
		).toBe('human');
	});

	it('recycles an existing results_table panel rather than creating a second one', async () => {
		const useCaseDeps = setup();
		seedCurrentScreener(useCaseDeps);
		createPanel(useCaseDeps, { context: { actor: 'agent' }, kind: 'results_table' });

		const fake = makeFakePort(completeRunFor);
		const result = await runScreenerByHuman({
			useCaseDeps,
			evaluationPort: fake.port,
			runStore: createPinnedRunStore()
		});

		expect(result.status).toBe('ok');
		const doc = useCaseDeps.repository.get(useCaseDeps.workspaceId)!;
		const resultsPanels = readPanelState(doc).panels.filter((p) => p.kind === 'results_table');
		expect(resultsPanels, 'T-0020-10: rerunning must never create a second panel').toHaveLength(1);

		const records = readActionLog(useCaseDeps);
		expect(
			records[0]?.actor,
			'AC: rebinding the recycled panel must also record actor "human"'
		).toBe('human');
	});
});

// Exercises the same blocking-problems refusal shape run_screener.ts's own
// suite covers (test_runScreener_blockingProblems_refusesAndMintsNoRun) --
// here only to prove the human path forwards a refusal without throwing or
// mis-binding a panel, not to re-test the engine's own validation.
describe('runScreenerByHuman: a refused screener', () => {
	it('reports the refusal without binding any panel', async () => {
		const useCaseDeps = setup();
		seedCurrentScreener(useCaseDeps);
		const fake = makeFakePort((input) => ({
			status: 'refused' as const,
			screenerId: input.definition.screenerId,
			screenerRevision: input.definition.revision,
			problems: [
				{
					severity: 'blocking' as const,
					code: PROBLEM_CODES.invalidParameter,
					nodeIds: [],
					universeCriteria: [],
					message: 'Fixture blocking problem.'
				}
			]
		}));

		const result = await runScreenerByHuman({
			useCaseDeps,
			evaluationPort: fake.port,
			runStore: createPinnedRunStore()
		});

		expect(result.status, 'a refusal is a well-formed answer, not a thrown error').toBe('ok');
		if (result.status === 'ok') {
			expect(result.outcome.status).toBe('refused');
		}
		const doc = useCaseDeps.repository.get(useCaseDeps.workspaceId)!;
		expect(
			readPanelState(doc).panels.some((p) => p.kind === 'results_table'),
			'a refused run must never create or bind a results panel'
		).toBe(false);
	});
});

// T-0020-14: the epic's closing integration test -- the amended pipeline
// (T-0020-10's create-if-absent/recycle, T-0020-11's human-triggered run)
// proven end to end across BOTH actors in one flow, not just within each
// ticket's own unit tests. Mirrors T-0020-3's original role (one test tracing
// the whole path) for this epic's amendment: docs/design/workbench-
// composition-root/spec.md's "Create-if-absent results panel", "Human-
// triggered run", and "Recycled results panel" scenarios, chained together.
describe('runScreenerByHuman + run_screener: cross-actor recycling of the results panel (T-0020-14)', () => {
	it('a human run creates the panel, an agent rerun recycles it, and a second human run recycles it again', async () => {
		const useCaseDeps = setup();
		const screenerId = seedCurrentScreener(useCaseDeps);

		// Given: a workspace with a defined screener and no results_table panel.
		const initialPanels = readPanelState(
			useCaseDeps.repository.get(useCaseDeps.workspaceId)!
		).panels.filter((p) => p.kind === 'results_table');
		expect(initialPanels, 'no results_table panel exists yet').toHaveLength(0);

		// When: a human triggers the first run (T-0020-11) ...
		const humanRun1 = await runScreenerByHuman({
			useCaseDeps,
			evaluationPort: makeFakePort(completeRunFor).port,
			runStore: createPinnedRunStore()
		});
		expect(humanRun1.status, `expected an ok result, got ${JSON.stringify(humanRun1)}`).toBe('ok');
		if (humanRun1.status !== 'ok' || humanRun1.outcome.status !== 'complete') {
			throw new Error('unreachable: asserted status above');
		}

		// Then: a 2x1 results_table panel is auto-created (T-0020-10) and bound
		// to the human's run.
		let doc = useCaseDeps.repository.get(useCaseDeps.workspaceId)!;
		let resultsPanels = readPanelState(doc).panels.filter((p) => p.kind === 'results_table');
		expect(resultsPanels, 'T-0020-10: exactly one panel is auto-created').toHaveLength(1);
		const panelId = resultsPanels[0]!.id;
		expect(resultsPanels[0]!.rect.colSpan, 'the auto-created panel is 2 columns wide').toBe(2);
		expect(resultsPanels[0]!.rect.rowSpan, 'the auto-created panel is 1 row tall').toBe(1);
		expect(resultsPanels[0]!.source, "the panel's source resolves to the human's run").toEqual({
			type: 'screener_results',
			ref: { run_id: humanRun1.outcome.runId }
		});

		// When: an agent reruns the same screener via run_screener, sharing this
		// harness's repository/revisions/history/clock/ids (T-0020-1's shared
		// composition root) so it sees the panel the human just created.
		const agentTool = createRunScreenerTool(toWorkbenchDeps(useCaseDeps), {
			evaluationPort: makeFakePort(completeRunFor).port,
			panelBinding: {
				kinds: useCaseDeps.kinds,
				sourceRenderer: useCaseDeps.sourceRenderer,
				templates: useCaseDeps.templates
			}
		});
		const agentRun = jsonOf(
			await agentTool.execute({ workspace_id: useCaseDeps.workspaceId, screener_id: screenerId })
		) as { run_id: string };

		// Then: the SAME panel is recycled (rebound), not a second one created.
		doc = useCaseDeps.repository.get(useCaseDeps.workspaceId)!;
		resultsPanels = readPanelState(doc).panels.filter((p) => p.kind === 'results_table');
		expect(resultsPanels, "T-0020-14: the agent's rerun must never create a second panel").toHaveLength(
			1
		);
		expect(resultsPanels[0]!.id, 'the same panel id is recycled across actors').toBe(panelId);
		expect(resultsPanels[0]!.source, 'the recycled panel is rebound to the agent run').toEqual({
			type: 'screener_results',
			ref: { run_id: agentRun.run_id }
		});

		// When: the human reruns again (a second click), after an agent's own
		// rerun already touched the panel.
		const humanRun2 = await runScreenerByHuman({
			useCaseDeps,
			evaluationPort: makeFakePort(completeRunFor).port,
			runStore: createPinnedRunStore()
		});
		expect(humanRun2.status, `expected an ok result, got ${JSON.stringify(humanRun2)}`).toBe('ok');
		if (humanRun2.status !== 'ok' || humanRun2.outcome.status !== 'complete') {
			throw new Error('unreachable: asserted status above');
		}

		// Then: the same panel id is recycled a second time, now rebound to the
		// human's second run -- proving recycling works regardless of which
		// actor created the panel or which actor reruns it.
		doc = useCaseDeps.repository.get(useCaseDeps.workspaceId)!;
		resultsPanels = readPanelState(doc).panels.filter((p) => p.kind === 'results_table');
		expect(resultsPanels, "T-0020-14: the human's second run must never create a second panel").toHaveLength(
			1
		);
		expect(resultsPanels[0]!.id, 'the same panel id is recycled once more').toBe(panelId);
		expect(resultsPanels[0]!.source, "the recycled panel is rebound to the human's second run").toEqual(
			{
				type: 'screener_results',
				ref: { run_id: humanRun2.outcome.runId }
			}
		);
	});
});
