// Composition root for the two backtest tools (T-1014-6): wires real
// infrastructure to createBacktestScreenerTool/createGetBacktestResultsTool
// and registers them against document.modelContext. Mirrors
// similarity/tools/registerSimilarityTools.ts's shape exactly, including
// the flagged-off, not-called-from-app-startup pattern every sibling tool
// group in this program uses (SCREENER_TOOLS_ENABLED, SIMILARITY_TOOLS_ENABLED,
// WATCHLIST_TOOLS_ENABLED, ALERT_TOOLS_ENABLED, CHART_TOOLS_ENABLED,
// WORKBENCH_TOOLS_ENABLED are all false too) -- flipping every surface on
// together is a later, whole-program decision no single ticket makes.
import { ensureModelContext } from '../../../webmcp/bridge';
import { createIdSequencer } from '../../domain/ids';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { DEV_API_BASE_URL } from '../../../workspace/apiConfig';
import { createHttpBacktestApi } from '../infra/httpBacktestApi';
import type { BacktestApiPort } from '../domain/apiPort';
import { createBacktestScreenerTool, type BacktestScreenerDeps } from './backtestScreener';
import { createGetBacktestResultsTool } from './getBacktestResults';

export const BACKTEST_TOOLS_ENABLED = false;

export interface BacktestToolsDeps extends BacktestScreenerDeps {
	api: BacktestApiPort;
}

export function createDefaultBacktestToolsDeps(
	baseUrl: string = DEV_API_BASE_URL
): BacktestToolsDeps {
	return {
		repository: createLocalWorkspaceRepository(),
		ids: createIdSequencer(),
		api: createHttpBacktestApi({ baseUrl })
	};
}

export async function registerBacktestTools(
	deps: BacktestToolsDeps = createDefaultBacktestToolsDeps()
): Promise<void> {
	if (!BACKTEST_TOOLS_ENABLED) {
		return;
	}
	const mc = ensureModelContext();
	const specs = [createBacktestScreenerTool(deps), createGetBacktestResultsTool({ api: deps.api })];
	for (const spec of specs) {
		await mc.registerTool({
			name: spec.name,
			description: spec.description,
			inputSchema: spec.inputSchema,
			execute: spec.execute
		});
	}
}
