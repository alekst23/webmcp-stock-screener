<script lang="ts">
	// The real results_table panel body (T-1010-7): reads the bound run's
	// current page (T-1010-4), renders it with the configured columns, sort,
	// grouping and formatting, drives paging and row selection through the
	// exact same use cases the agent calls, and opens a per-row explanation
	// (T-1010-5) on demand. See resultsPanelContext.ts for why its
	// dependencies arrive via a registration-time singleton rather than a
	// prop, and renderState.ts for the non-happy-path state machine (AC10,
	// AC11) this component only renders, never computes inline.
	import type { Panel } from '../../panels/domain/panel';
	import type { PanelBodyProps } from '../../panels/shell/panelController';
	import { readPanelState, setPanelSelection } from '../../panels/application';
	import { getResultsPanelRuntimeDeps, type ResultsPanelRuntimeDeps } from './resultsPanelContext';
	import {
		getScreenerResults,
		type GetScreenerResultsOutcome
	} from '../application/getScreenerResults';
	import { explainResult, type ExplainResultOutcome } from '../application/explainResult';
	import { parseWireResultsTableConfig } from '../application/tableConfigWire';
	import { defaultResultsTableConfig } from '../domain/projection';
	import { toggleSelection } from './selection';
	import { renderColumnsFor } from './defaultColumns';
	import { formatColumnValue } from './formatColumnValue';
	import { groupRowsByAdjacentValue } from './rowGrouping';
	import { computeRenderState } from './renderState';
	import {
		currentCursor,
		goToNextPage,
		goToPreviousPage,
		initialPagination,
		type PaginationState
	} from './pagination';
	import ResultsTableHeader from './ResultsTableHeader.svelte';
	import ResultsTableRow from './ResultsTableRow.svelte';
	import ResultsTablePager from './ResultsTablePager.svelte';
	import ResultsProvenance from './ResultsProvenance.svelte';
	import ResultsExplainView from './ResultsExplainView.svelte';

	// `deps` is not part of PanelBodyProps (PanelFrame never passes it) --
	// it exists purely so a test can mount this component with an explicit,
	// isolated dependency set instead of the module-global registration
	// singleton.
	let { panel, deps: depsOverride }: PanelBodyProps & { deps?: ResultsPanelRuntimeDeps } = $props();

	// Deliberately a one-time snapshot, not a reactive read: a panel's
	// runtime dependency set (which run store, which use-case deps) does not
	// change for the lifetime of a mounted panel instance, so freezing it at
	// first evaluation is correct here, not a missed reactivity case.
	// svelte-ignore state_referenced_locally
	const deps = depsOverride ?? getResultsPanelRuntimeDeps();

	function runIdOf(p: Panel): string | null {
		if (!p.source || p.source.type !== 'screener_results') {
			return null;
		}
		const runId = p.source.ref.run_id;
		return typeof runId === 'string' ? runId : null;
	}

	let pagination = $state<PaginationState>(initialPagination());
	let lastRunId = $state<string | null>(null);
	let outcome = $state<GetScreenerResultsOutcome | null>(null);
	let readFailed = $state<string | null>(null);
	let selectedIds = $state<string[]>([]);
	let explainInstrumentId = $state<string | null>(null);

	let config = $derived.by(() => {
		const parsed = parseWireResultsTableConfig(panel.config);
		return parsed.ok ? parsed.config : defaultResultsTableConfig();
	});

	function readCurrentSelection(): string[] {
		const doc = deps.useCaseDeps.repository.get(deps.useCaseDeps.workspaceId);
		if (!doc) {
			return [];
		}
		return readPanelState(doc).selections[panel.id] ?? [];
	}

	// Resets paging to the first page whenever the bound run changes -- a
	// self-limiting effect (the second run of any given `runId` always finds
	// `lastRunId` already equal, so it writes nothing) kept isolated from the
	// load effect below so writing `pagination` here cannot re-trigger this
	// same effect.
	$effect(() => {
		const runId = runIdOf(panel);
		if (runId !== lastRunId) {
			lastRunId = runId;
			pagination = initialPagination();
		}
	});

	// The only place getScreenerResults (a pure, synchronous read over
	// PinnedRunStore) is called -- paging (nextPage/prevPage below) only ever
	// changes `pagination`, which this effect reacts to; neither path calls
	// anything screener-execution-shaped (AC5). Runs once after the initial
	// render (Svelte's own effect timing), so `outcome === null` is a real,
	// observable "loading" frame (AC11), not a state this branch can never
	// reach.
	$effect(() => {
		const runId = runIdOf(panel);
		readFailed = null;
		if (runId === null) {
			outcome = null;
		} else {
			try {
				outcome = getScreenerResults(
					deps.runs,
					{
						runId,
						cursor: currentCursor(pagination),
						// The config's own page size (already validated/normalized to a
						// definite number by whichever mutation stored it) governs how
						// many rows this panel actually requests -- getScreenerResults'
						// own `pageSize` field is a separate request parameter from
						// `tableConfig.pageSize`, so it must be forwarded explicitly.
						pageSize: config.pageSize ?? undefined,
						tableConfig: config
					},
					{ resolveTicker: deps.resolveTicker }
				);
			} catch (err) {
				readFailed = err instanceof Error ? err.message : String(err);
				outcome = null;
			}
		}
		selectedIds = readCurrentSelection();
	});

	let renderState = $derived(computeRenderState({ runId: runIdOf(panel), outcome, readFailed }));
	let columns = $derived(renderColumnsFor(config.columns));
	let grouped = $derived(config.grouping !== null);
	let groups = $derived(
		renderState.kind === 'ready' || renderState.kind === 'empty'
			? groupRowsByAdjacentValue(renderState.page.rows)
			: []
	);

	function toggleRow(resultId: string): void {
		const next = toggleSelection(selectedIds, resultId);
		selectedIds = next;
		// AC7/AC8: the exact same mutation the agent's set_panel_selection
		// tool calls -- 'human' matches this codebase's existing convention
		// for a UI-triggered actor (src/lib/workspace/ChartToolbar.svelte's
		// own recordAction calls). Propagation to linked panels is already
		// this use case's own job (propagationTargets); nothing else to do.
		setPanelSelection(deps.useCaseDeps, {
			context: { actor: 'human' },
			panelId: panel.id,
			selectedIds: next
		});
	}

	function nextPage(): void {
		if (renderState.kind !== 'ready') {
			return;
		}
		pagination = goToNextPage(pagination, renderState.page.nextCursor);
	}

	function prevPage(): void {
		pagination = goToPreviousPage(pagination);
	}

	function openExplain(instrumentId: string): void {
		explainInstrumentId = instrumentId;
	}

	function closeExplain(): void {
		explainInstrumentId = null;
	}

	let explainOutcome = $derived.by((): ExplainResultOutcome | null => {
		const id = explainInstrumentId;
		const runId = runIdOf(panel);
		if (id === null || runId === null) {
			return null;
		}
		return explainResult(deps.runs, runId, id);
	});
</script>

{#if renderState.kind === 'unbound'}
	<p class="empty">No screener run bound to this panel yet.</p>
{:else if renderState.kind === 'loading'}
	<p class="empty">Loading…</p>
{:else if renderState.kind === 'error'}
	<p class="error">Could not read this run: {renderState.message}</p>
{:else if renderState.kind === 'unavailable'}
	<p class="error">{renderState.message}</p>
{:else if renderState.kind === 'empty'}
	<div class="results-panel">
		<p class="empty">The screener matched no instruments.</p>
		<ResultsProvenance provenance={renderState.page.provenance} />
	</div>
{:else}
	<div class="results-panel">
		<div class="scroll">
			<table>
				<thead>
					<ResultsTableHeader {columns} sort={config.sort} />
				</thead>
				<tbody>
					{#each groups as group, groupIndex (groupIndex)}
						{#if grouped}
							<tr class="group-header">
								<td colspan={columns.length + 2}>{formatColumnValue(group.groupValue, null)}</td>
							</tr>
						{/if}
						{#each group.rows as row (row.resultId)}
							<ResultsTableRow
								{row}
								{columns}
								formattingRules={config.formattingRules}
								selected={selectedIds.includes(row.resultId)}
								onToggle={toggleRow}
								onExplain={openExplain}
							/>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
		<div class="footer">
			<ResultsTablePager
				offset={renderState.page.offset}
				rowCount={renderState.page.rows.length}
				total={renderState.page.total}
				canGoPrevious={pagination.index > 0}
				canGoNext={renderState.page.nextCursor !== null}
				onPrevious={prevPage}
				onNext={nextPage}
			/>
			<ResultsProvenance provenance={renderState.page.provenance} />
		</div>
	</div>
{/if}

{#if explainInstrumentId !== null && explainOutcome}
	<ResultsExplainView outcome={explainOutcome} onClose={closeExplain} />
{/if}

<style>
	.results-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		height: 100%;
		min-height: 0;
	}

	.scroll {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	.group-header td {
		padding: var(--space-xs) var(--space-sm);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
	}

	.footer {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		flex: 0 0 auto;
		padding-top: var(--space-xs);
		border-top: 1px solid var(--separator);
	}

	.empty {
		color: var(--text-muted);
		font-style: italic;
	}

	.error {
		color: var(--error);
		background: var(--error-bg);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		padding: var(--space-xs) var(--space-sm);
	}
</style>
