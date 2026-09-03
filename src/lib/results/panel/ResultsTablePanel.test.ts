// T-1010-7: end-to-end component tests for the real results_table panel
// body. Builds its own registry harness (like resultsTablePanelKind.test.ts
// and tableRendererContract.test.ts) rather than
// panels/application/testSupport.ts's createPanelTestHarness(), which seeds
// the PLACEHOLDER 'results_table'/'table' registrations -- this file needs
// the real ones so a panel's config actually round-trips through the real
// wire schema.
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import { createLayoutTemplateRegistry } from '../../panels/domain/layoutTemplates';
import { createPanelRegistry } from '../../panels/registry/panelKindRegistry';
import { registerDefaultPanelKinds } from '../../panels/registry/defaultPanelKinds';
import { createSourceRendererRegistry } from '../../panels/registry/sourceRendererRegistry';
import { registerDefaultSourceRendererTypes } from '../../panels/registry/defaultSourceRendererTypes';
import {
	createPanel,
	bindPanelSource,
	linkPanels,
	readPanelState,
	type PanelUseCaseDeps
} from '../../panels/application';
import type { Panel } from '../../panels/domain/panel';
import type { PinnedRunStore } from '../../screener/ports';
import { registerResultsTableRendererContract } from '../tools/tableRendererContract';
import { registerResultsTablePanelKind } from '../registry/resultsTablePanelKind';
import { defaultWireResultsTableConfig } from '../application/tableConfigWire';
import { createSpyPinnedRunStore, testMatch, testPinnedRunStore, testRun } from '../testSupport';
import { resetResultsPanelRuntimeDeps } from './resultsPanelContext';
import ResultsTablePanel from './ResultsTablePanel.svelte';

const MARKET_CAP_COLUMN_WIRE = {
	id: 'column_1',
	identity: { source: 'catalog_field', field_id: 'field.market_cap' },
	label: 'Market Cap',
	unit: 'USD',
	value_type: 'number'
};

function harness(runs: PinnedRunStore): PanelUseCaseDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const clock = { now: () => '2026-01-01T00:00:00.000Z' };
	const ids = createIdSequencer();
	const kinds = createPanelRegistry();
	const sourceRenderer = createSourceRendererRegistry();
	const deps: PanelUseCaseDeps = {
		workspaceId: 'workspace_1',
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
		kinds,
		sourceRenderer,
		templates: createLayoutTemplateRegistry()
	};
	registerResultsTableRendererContract(sourceRenderer, { runs });
	registerResultsTablePanelKind(kinds, { useCaseDeps: deps, runs });
	registerDefaultPanelKinds(kinds);
	registerDefaultSourceRendererTypes(sourceRenderer);
	return deps;
}

function createResultsPanel(
	deps: PanelUseCaseDeps,
	options: { runId?: string; config?: Record<string, unknown> } = {}
): Panel {
	const envelope = createPanel(deps, {
		context: { actor: 'agent' },
		kind: 'results_table',
		config: options.config ?? defaultWireResultsTableConfig(),
		source: options.runId ? { type: 'screener_results', ref: { run_id: options.runId } } : null
	});
	const panelId = envelope.affectedIds[0]!;
	return readPanelState(deps.repository.get(deps.workspaceId)!).panels.find(
		(p) => p.id === panelId
	)!;
}

interface Mounted {
	target: HTMLElement;
	instance: object;
}

function mountPanel(
	panel: Panel,
	deps: PanelUseCaseDeps,
	runs: PinnedRunStore,
	resolveTicker?: (instrumentId: string) => string | null
): Mounted {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ResultsTablePanel, {
		target,
		props: {
			panel,
			onBroadcast: () => false,
			deps: { useCaseDeps: deps, runs, resolveTicker }
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	resetResultsPanelRuntimeDeps();
});

describe('ResultsTablePanel: non-happy-path states (AC10, AC11)', () => {
	it('renders an explicit "not bound" message when the panel has no source', () => {
		const runs = testPinnedRunStore();
		const deps = harness(runs);
		const panel = createResultsPanel(deps);
		const { target, instance } = mountPanel(panel, deps, runs);
		expect(target.textContent).toContain('No screener run bound');
		unmount(instance);
	});

	it('renders an explicit empty state for a run that matched nothing, not an empty table', () => {
		const runs = testPinnedRunStore(testRun('run_1', 0));
		const deps = harness(runs);
		const panel = createResultsPanel(deps, { runId: 'run_1' });
		const { target, instance } = mountPanel(panel, deps, runs);
		expect(target.textContent).toContain('matched no instruments');
		expect(
			target.querySelector('table'),
			'must not render a (misleadingly empty) table'
		).toBeNull();
		unmount(instance);
	});

	it('renders the "run again" message for an unknown run id, not a blank/empty table', () => {
		const runs = testPinnedRunStore();
		const deps = harness(runs);
		const panel = createResultsPanel(deps, { runId: 'run_missing' });
		const { target, instance } = mountPanel(panel, deps, runs);
		expect(target.textContent).toContain('Run the screener again');
		unmount(instance);
	});

	it('renders a distinguishable "read failed" state when the read throws', () => {
		const runs = testPinnedRunStore(testRun('run_1', 1));
		const deps = harness(runs);
		const panel = createResultsPanel(deps, { runId: 'run_1' });
		const { target, instance } = mountPanel(panel, deps, runs, () => {
			throw new Error('ticker resolution boom');
		});
		expect(target.textContent).toContain('ticker resolution boom');
		unmount(instance);
	});
});

describe('ResultsTablePanel: rendering configured columns, sort order, and grouping (AC2, AC3)', () => {
	// testRun(runId, matchCount, overrides)'s own `matches` is always the
	// freshly-generated array of `matchCount` default matches -- overrides
	// cannot supply `matches` through the third argument (it is spread
	// before `matches` in that helper's return, deliberately, so a caller
	// who only wants N generic matches never has to build them by hand).
	// Building the real matches here and overriding the base run's own
	// `matches` afterward is the correct way to get specific ranking values.
	function threeRowRun(): ReturnType<typeof testRun> {
		return {
			...testRun('run_1', 3),
			matches: [
				testMatch(1, { rankingValues: { 'field.market_cap': 100 } }),
				testMatch(2, { rankingValues: { 'field.market_cap': 100 } }),
				testMatch(3, { rankingValues: { 'field.market_cap': 50 } })
			],
			returnedCount: 3,
			matchedCount: 3
		};
	}

	it('shows the configured column label and unit in the header', () => {
		const runs = testPinnedRunStore(threeRowRun());
		const deps = harness(runs);
		const panel = createResultsPanel(deps, {
			runId: 'run_1',
			config: { ...defaultWireResultsTableConfig(), columns: [MARKET_CAP_COLUMN_WIRE] }
		});
		const { target, instance } = mountPanel(panel, deps, runs);
		const header = target.querySelector('thead');
		expect(header?.textContent).toContain('Market Cap');
		expect(header?.textContent).toContain('USD');
		unmount(instance);
	});

	it('renders rows in the order the projection already sorted them, without re-sorting', () => {
		const runs = testPinnedRunStore(threeRowRun());
		const deps = harness(runs);
		const panel = createResultsPanel(deps, {
			runId: 'run_1',
			config: {
				...defaultWireResultsTableConfig(),
				columns: [MARKET_CAP_COLUMN_WIRE],
				sort: { key: MARKET_CAP_COLUMN_WIRE.identity, direction: 'asc' }
			}
		});
		const { target, instance } = mountPanel(panel, deps, runs);
		const rows = [...target.querySelectorAll('tbody tr:not(.group-header)')];
		// ascending by market_cap: 50, 100, 100 -> instrument ranks 3, then 1
		// and 2 (stable tie-break by result_id/rank). Identified via the
		// selection checkbox's own aria-label, since the only configured
		// column here is Market Cap itself.
		const instrumentOrder = rows.map((r) =>
			r.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')
		);
		expect(instrumentOrder).toEqual(['Select inst_3', 'Select inst_1', 'Select inst_2']);
		unmount(instance);
	});

	it('renders configured grouping as contiguous visible group headers', () => {
		const runs = testPinnedRunStore(threeRowRun());
		const deps = harness(runs);
		const panel = createResultsPanel(deps, {
			runId: 'run_1',
			config: {
				...defaultWireResultsTableConfig(),
				columns: [MARKET_CAP_COLUMN_WIRE],
				sort: { key: MARKET_CAP_COLUMN_WIRE.identity, direction: 'desc' },
				grouping: { key: MARKET_CAP_COLUMN_WIRE.identity }
			}
		});
		const { target, instance } = mountPanel(panel, deps, runs);
		const groupHeaders = [...target.querySelectorAll('tr.group-header')];
		expect(groupHeaders, 'expected two groups: 100 and 50').toHaveLength(2);
		expect(groupHeaders[0]?.textContent).toContain('100');
		expect(groupHeaders[1]?.textContent).toContain('50');
		unmount(instance);
	});

	it('falls back to identity columns (rank/instrument/score) when no columns are configured', () => {
		const runs = testPinnedRunStore(threeRowRun());
		const deps = harness(runs);
		const panel = createResultsPanel(deps, { runId: 'run_1' });
		const { target, instance } = mountPanel(panel, deps, runs);
		const header = target.querySelector('thead');
		expect(header?.textContent).toContain('Rank');
		expect(header?.textContent).toContain('Instrument');
		expect(header?.textContent).toContain('Score');
		unmount(instance);
	});
});

describe('ResultsTablePanel: conditional formatting (AC4)', () => {
	it("applies a matching rule's style only to the cells it actually matches", () => {
		const runs = testPinnedRunStore({
			...testRun('run_1', 2),
			matches: [
				testMatch(1, { rankingValues: { 'field.market_cap': 100 } }),
				testMatch(2, { rankingValues: { 'field.market_cap': 50 } })
			],
			returnedCount: 2,
			matchedCount: 2
		});
		const deps = harness(runs);
		const panel = createResultsPanel(deps, {
			runId: 'run_1',
			config: {
				...defaultWireResultsTableConfig(),
				columns: [MARKET_CAP_COLUMN_WIRE],
				formatting_rules: [
					{
						id: 'rule_1',
						predicate: { column_id: 'column_1', comparator: 'gte', value: 80 },
						style: { background_color: 'rgb(255, 0, 0)' }
					}
				]
			}
		});
		const { target, instance } = mountPanel(panel, deps, runs);
		const rows = [...target.querySelectorAll('tbody tr')];
		const marketCapCells = rows.map((r) => (r.querySelectorAll('td')[1] as HTMLElement) ?? null);
		expect(marketCapCells[0]?.style.backgroundColor, 'row with 100 must match gte 80').toBe(
			'rgb(255, 0, 0)'
		);
		expect(
			marketCapCells[1]?.style.backgroundColor,
			'row with 50 must not match gte 80 -- the table stays unchanged for it'
		).toBe('');
		unmount(instance);
	});
});

describe('ResultsTablePanel: paging (AC5)', () => {
	it('shows the total count and never calls anything but the read use case while paging', () => {
		const baseRuns = testPinnedRunStore({
			...testRun('run_1', 3),
			returnedCount: 3,
			matchedCount: 3
		});
		const spyRuns = createSpyPinnedRunStore(baseRuns);
		const deps = harness(spyRuns);
		const panel = createResultsPanel(deps, {
			runId: 'run_1',
			config: { ...defaultWireResultsTableConfig(), page_size: 2 }
		});
		const { target, instance } = mountPanel(panel, deps, spyRuns);

		expect(target.textContent).toContain('1–2 of 3');
		const nextButton = [...target.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Next')
		)!;
		nextButton.click();
		flushSync();
		expect(target.textContent).toContain('3–3 of 3');

		const prevButton = [...target.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Previous')
		)!;
		prevButton.click();
		flushSync();
		expect(target.textContent).toContain('1–2 of 3');

		expect(spyRuns.putRunCalls, 'paging must never write a run back to the store').toBe(0);
		unmount(instance);
	});
});

describe('ResultsTablePanel: selection through the shared mutation (AC7, AC8)', () => {
	it('toggling a row calls the same setPanelSelection mutation and propagates to a linked panel', () => {
		const runs = testPinnedRunStore({ ...testRun('run_1', 2), returnedCount: 2, matchedCount: 2 });
		const deps = harness(runs);
		const panel = createResultsPanel(deps, { runId: 'run_1' });

		const watchlistEnvelope = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'watchlist'
		});
		const watchlistId = watchlistEnvelope.affectedIds[0]!;
		linkPanels(deps, {
			context: { actor: 'agent' },
			channel: 'result_selection',
			panelIds: [panel.id, watchlistId]
		});

		const { target, instance } = mountPanel(panel, deps, runs);
		const checkbox = target.querySelector('tbody input[type="checkbox"]') as HTMLInputElement;
		expect(checkbox, 'expected a selection checkbox on the first row').toBeTruthy();
		checkbox.click();
		flushSync();

		const state = readPanelState(deps.repository.get(deps.workspaceId)!);
		const resultId = 'result_run_1_1';
		expect(
			state.selections[panel.id],
			"the click must go through setPanelSelection, updating this panel's own selection"
		).toEqual([resultId]);
		expect(
			state.selections[watchlistId],
			'AC8: the same selection must propagate to the linked panel'
		).toEqual([resultId]);
		expect(checkbox.checked, 're-render must reflect the now-selected row').toBe(true);

		unmount(instance);
	});
});

describe('ResultsTablePanel: explain view (AC9)', () => {
	it('opens an explanation showing the condition restatement and pass/fail outcome on demand', () => {
		const condition = {
			type: 'scalar' as const,
			fieldId: 'field.market_cap',
			operator: 'op.greater_than' as const,
			value: 10,
			unit: null
		};
		const run = {
			...testRun('run_1', 1),
			matches: [
				{
					instrumentId: 'inst_1',
					rank: 1,
					compositeScore: 1,
					rankingValues: {},
					nodeEvaluations: {
						filter_cond_1: { nodeId: 'filter_cond_1', passed: true, value: 42 }
					}
				}
			],
			returnedCount: 1,
			matchedCount: 1,
			filterTree: {
				nodeId: 'filter_group_1',
				kind: 'group' as const,
				op: 'and' as const,
				enabled: true,
				children: [
					{ nodeId: 'filter_cond_1', kind: 'condition' as const, condition, enabled: true }
				]
			}
		};
		const runs = testPinnedRunStore(run);
		const deps = harness(runs);
		const panel = createResultsPanel(deps, { runId: 'run_1' });
		const { target, instance } = mountPanel(panel, deps, runs);

		const explainButton = [...target.querySelectorAll<HTMLButtonElement>('tbody button')].find(
			(b) => b.textContent?.includes('Explain')
		)!;
		explainButton.click();
		flushSync();

		expect(target.textContent).toContain('AND');
		expect(target.textContent).toContain('field.market_cap');
		expect(target.textContent).toContain('pass');

		const closeButton = target.querySelector('button[aria-label="Close explanation"]');
		expect(closeButton, 'expected the backdrop close control').toBeTruthy();
		(closeButton as HTMLElement).click();
		flushSync();
		expect(target.querySelector('[role="dialog"]')).toBeNull();

		unmount(instance);
	});
});
