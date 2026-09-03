// Composition root for the chart surface: wires real infrastructure to
// buildChartTools and registers the three chart tools against
// document.modelContext, alongside the workbench composition root that does
// the same for its seven.
//
// CHART_TOOLS_ENABLED flipped true by T-1015-3: the panel registry that
// creates chart panels (EPIC-1007) is on main now, and T-1015-3's capability
// parity check confirmed this as a surviving capability behind a flag with
// no caller -- workbenchCompositionRoot.ts's registerWorkbenchComposition()
// now calls registerChartTools() unconditionally (this flag decides whether
// that call does anything).
import { ensureModelContext } from '../../../webmcp/bridge';
import { createIdSequencer } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import type { WorkspaceDocument } from '../../domain/workspace';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { operationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { capturedSetupIdSeed } from '../domain/capturedSetup';
import { chartStateIdSeed } from '../domain/chartState';
import { createInMemoryChartSeries } from '../infra/inMemoryChartSeries';
import { buildChartTools, type ChartToolsDeps } from './index';

export const CHART_TOOLS_ENABLED = true;

// Two seeds, one sequencer. Studies and annotations live in the chart
// extension and captured setups live in their own, so a sequencer seeded from
// only one of them would happily re-mint a `setup_1` that already exists after
// a reload. Merged by taking the higher mark per key, which is what the
// sequencer's own contract needs: sequence numbers only ever increment.
export function chartIdSeed(doc: WorkspaceDocument | null): Record<string, number> {
	if (!doc) {
		return {};
	}
	const merged: Record<string, number> = {};
	for (const seed of [chartStateIdSeed(doc), capturedSetupIdSeed(doc)]) {
		for (const [key, value] of Object.entries(seed)) {
			merged[key] = Math.max(merged[key] ?? 0, value);
		}
	}
	return merged;
}

export function createChartIdSequencer(doc: WorkspaceDocument | null): IdSequencer {
	return createIdSequencer(chartIdSeed(doc));
}

// No fixtures: an empty series port answers every request with
// `unknown_instrument`, which is the honest state of a program with no
// market-data feed wired up. It is a real implementation of the port rather
// than a stub, so the refusal an agent gets is the refusal the real path
// produces.
function defaultSeriesPort(clock: { now(): string }) {
	return createInMemoryChartSeries({ clock, series: [] });
}

export function createDefaultChartDeps(): ChartToolsDeps {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const activeId = repository.getActiveId();
	const ids = createChartIdSequencer(activeId ? repository.get(activeId) : null);
	return {
		repository,
		revisions: createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		}),
		history: createChangeHistory(),
		registry: operationRegistry,
		clock,
		ids,
		series: defaultSeriesPort(clock)
	};
}

export async function registerChartTools(
	deps: ChartToolsDeps = createDefaultChartDeps()
): Promise<void> {
	if (!CHART_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	for (const spec of buildChartTools(deps)) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}
