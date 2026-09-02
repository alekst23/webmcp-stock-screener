// Composition root for the alert surface, gated the same way
// chart/tools/registerChartTools.ts gates CHART_TOOLS_ENABLED: the follow-up
// tool surface this belongs to is wired on together by T-1014-11, not by this
// ticket. Not called from app startup here.
import { ensureModelContext } from '../../../webmcp/bridge';
import { createIdSequencer } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import { createChangeHistory } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { operationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { createInMemoryAlertHistoricalData } from '../infra/inMemoryAlertHistoricalData';
import { buildAlertTools, type AlertToolsDeps } from './index';

export const ALERT_TOOLS_ENABLED = false;

export function createDefaultAlertDeps(): AlertToolsDeps {
	const repository = createLocalWorkspaceRepository();
	const clock = { now: () => new Date().toISOString() };
	const ids: IdSequencer = createIdSequencer();
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
		// The safe default (T-1014-8's Solution Approach): a real
		// implementation that honestly reports no historical data rather than
		// fabricating any. A live historical evaluation pipeline is a separate,
		// later workstream.
		historicalData: createInMemoryAlertHistoricalData()
	};
}

export async function registerAlertTools(
	deps: AlertToolsDeps = createDefaultAlertDeps()
): Promise<void> {
	if (!ALERT_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	for (const spec of buildAlertTools(deps)) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}
