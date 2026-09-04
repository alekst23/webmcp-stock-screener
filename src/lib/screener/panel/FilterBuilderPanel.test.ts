// T-0027-1: end-to-end component tests for the real filter_builder panel
// body. Mirrors results/panel/ResultsTablePanel.test.ts's own harness
// pattern (mount/unmount/flushSync, `deps` passed as an explicit prop
// override rather than relying on the module-scoped runtime-deps
// singleton).
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import { emptyWorkspace } from '../../workbench/domain/workspace';
import { createLayoutTemplateRegistry } from '../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../panels/registry/sourceRendererRegistry';
import type { PanelUseCaseDeps } from '../../panels/application';
import { createPanelWorkspaceObserver } from '../../panels/shell/panelController';
import { createScreener } from '../definition';
import { writeScreener } from '../state';
import { createPinnedRunStore } from '../runStore';
import type { ScreenerEvaluationPort } from '../ports';
import type { ScreenerRunOutcome } from '../run';
import { PROBLEM_CODES } from '../validation';
import { resetFilterBuilderPanelRuntimeDeps } from './filterBuilderPanelContext';
import type { FilterBuilderPanelRuntimeDeps } from './filterBuilderPanelContext';
import FilterBuilderPanel from './FilterBuilderPanel.svelte';

const WORKSPACE_ID = 'workspace_1';

function harness(): PanelUseCaseDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const clock = { now: () => '2026-01-01T00:00:00.000Z' };
	const ids = createIdSequencer();
	repository.put(emptyWorkspace(WORKSPACE_ID, 'Workbench', clock.now()));
	return {
		workspaceId: WORKSPACE_ID,
		repository,
		revisions: createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		clock,
		ids,
		kinds: createPanelRegistry(),
		sourceRenderer: createSourceRendererRegistry(),
		templates: createLayoutTemplateRegistry()
	};
}

// Sets the workspace's current screener directly on the fixture document --
// per the epic's own note, this ticket is buildable and testable against a
// fixture WorkspaceDocument independently of EPIC-0026's define_screener
// tool landing; only the shape (screenerId pointing at an entry in
// extensions.screener) matters here, not how it got there.
function seedCurrentScreener(deps: PanelUseCaseDeps): string {
	const doc = deps.repository.get(deps.workspaceId)!;
	const screener = createScreener(deps.ids, deps.workspaceId, 'My Screener');
	screener.universe.assetClass = 'equity';
	screener.universe.exchanges = ['XNAS'];
	const withScreener = writeScreener(doc, screener);
	deps.repository.put({ ...withScreener, screenerId: screener.screenerId });
	return screener.screenerId;
}

function samplePanel() {
	return {
		id: 'panel_1',
		kind: 'filter_builder',
		title: 'Filter Builder',
		config: { filterTree: {} },
		rect: { col: 0, row: 0, colSpan: 2, rowSpan: 4 },
		hidden: false,
		collapsed: false,
		source: null,
		renderer: null
	};
}

interface Mounted {
	target: HTMLElement;
	instance: object;
}

function mountPanel(deps: PanelUseCaseDeps): Mounted {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(FilterBuilderPanel, {
		target,
		props: {
			panel: samplePanel(),
			onBroadcast: () => false,
			deps: { useCaseDeps: deps }
		}
	});
	flushSync();
	return { target, instance };
}

// The Run-button variant of mountPanel above: takes the full runtime deps
// (including `run`) rather than bare useCaseDeps, so a test can actually
// click the button instead of only exercising it disabled.
function mountPanelWithRunDeps(deps: FilterBuilderPanelRuntimeDeps): Mounted {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(FilterBuilderPanel, {
		target,
		props: {
			panel: samplePanel(),
			onBroadcast: () => false,
			deps
		}
	});
	flushSync();
	return { target, instance };
}

// A fake evaluation port whose execute() always resolves to the given
// outcome (a refusal, in the test below) -- mirrors runScreenerByHuman.
// test.ts's own makeFakePort pattern.
function makeFakePort(outcome: ScreenerRunOutcome): ScreenerEvaluationPort {
	return {
		async validate() {
			throw new Error('not used by this test');
		},
		async execute() {
			return outcome;
		}
	};
}

afterEach(() => {
	resetFilterBuilderPanelRuntimeDeps();
});

describe('FilterBuilderPanel', () => {
	it('AC1: shows an explicit empty state when there is no current screener', () => {
		const { target, instance } = mountPanel(harness());
		expect(target.textContent).toContain('No screener yet.');
		unmount(instance);
	});

	it('AC2: renders universe, filter tree, and ranking once a screener exists', () => {
		const deps = harness();
		seedCurrentScreener(deps);
		const { target, instance } = mountPanel(deps);
		expect(target.textContent).toContain('Asset class: equity');
		expect(target.textContent).toContain('Exchanges: XNAS');
		expect(target.textContent, 'the empty root group renders as an explicit AND (empty)').toContain(
			'AND (empty)'
		);
		expect(target.textContent).toContain('Default order (no ranking configured).');
		unmount(instance);
	});

	it('AC3: a fresh mount after the screener changes reflects the new definition', () => {
		const deps = harness();
		seedCurrentScreener(deps);
		const first = mountPanel(deps);
		expect(first.target.textContent).toContain('Asset class: equity');
		unmount(first.instance);

		const doc = deps.repository.get(deps.workspaceId)!;
		const screener = createScreener(deps.ids, deps.workspaceId, 'Redefined');
		screener.universe.assetClass = 'etf';
		const withScreener = writeScreener(doc, screener);
		deps.repository.put({ ...withScreener, screenerId: screener.screenerId });

		const second = mountPanel(deps);
		expect(second.target.textContent).toContain('Asset class: etf');
		expect(second.target.textContent).not.toContain('Asset class: equity');
		unmount(second.instance);
	});

	it('AC4: exposes no controls that mutate the screener definition', () => {
		const deps = harness();
		seedCurrentScreener(deps);
		const { target, instance } = mountPanel(deps);
		// T-0020-11 adds the human "Run" control -- scoped to executing the
		// existing definition, not editing it (see that ticket's own Goal
		// section for why this doesn't touch T-0027-1's own AC4). Everything
		// else -- inputs, selects, textareas, and any OTHER button -- must
		// still be absent.
		const controls = Array.from(target.querySelectorAll('button, input, select, textarea'));
		expect(controls.length, 'expected exactly the Run control and nothing else').toBe(1);
		expect(controls[0]?.classList.contains('run-button'), 'expected the one control to be Run').toBe(
			true
		);
		unmount(instance);
	});

	// Post-review fix (EPIC-0020, finding 2): runScreenerByHuman's result used
	// to be discarded by handleRun() entirely, so a refused run left the
	// button reverting to "Run" with no explanation. This clicks the real
	// button (not just calling runScreenerByHuman directly) so the assertion
	// covers the actual wiring between the DOM event and the message that
	// appears from it.
	it('surfaces a refusal inline after a real button click, from a real handleRun()-shaped call', async () => {
		const deps = harness();
		seedCurrentScreener(deps);
		const port = makeFakePort({
			status: 'refused',
			screenerId: 'unused',
			screenerRevision: 1,
			problems: [
				{
					severity: 'blocking',
					code: PROBLEM_CODES.invalidParameter,
					nodeIds: [],
					universeCriteria: [],
					message: 'Fixture blocking problem.'
				}
			]
		});
		const { target, instance } = mountPanelWithRunDeps({
			useCaseDeps: deps,
			run: {
				evaluationPort: port,
				runStore: createPinnedRunStore(),
				observer: createPanelWorkspaceObserver()
			}
		});

		expect(target.textContent, 'no message before the first run').not.toContain('Fixture blocking');

		const button = target.querySelector('.run-button') as HTMLButtonElement;
		button.click();

		// Draining the microtask queue with a macrotask boundary (see
		// PanelFrame.test.ts's identical comment) is more robust than
		// guessing how many Promise.resolve() hops handleRun's own await
		// chain needs.
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		expect(
			target.textContent,
			'a refused run must explain itself inline, not just revert the button silently'
		).toContain('Fixture blocking problem.');
		unmount(instance);
	});
});
