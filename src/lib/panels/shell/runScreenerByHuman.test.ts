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
import { initializeWorkspace, readActionLog, runScreenerByHuman } from './panelController';

interface EvaluationInput {
	definition: ScreenerDefinition;
	runId: string;
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
