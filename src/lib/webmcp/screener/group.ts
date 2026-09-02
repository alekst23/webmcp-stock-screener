// The screener tool group (T-1009-10): one builder composing the six tools
// T-1009-3..9 already built, mirroring webmcp/discovery/group.ts's pattern
// -- explicit dependencies, no module-level singleton, nothing here decides
// whether the group is registered on the live page (that is
// registerScreenerTools.ts's job, this epic's composition root).
//
// Definition-editing (create_screener, set_screener_universe,
// edit_filter_tree, set_screener_ranking) and evaluation (validate_screener,
// run_screener) are built entirely in browser-side TypeScript here -- see
// this ticket's Solution Approach for why AC2's literal "over HTTP" wording
// does not apply to this epic.

import type { CatalogRegistry } from '../../catalog/registry';
import type {
	PinnedRunStore,
	ScreenerEvaluationPort,
	ScreenerMarketData
} from '../../screener/ports';
import type { ToolSpec } from '../types';
import { createCreateScreenerTool } from './createScreener';
import { createEditFilterTreeTool } from './editFilterTree';
import { createRunScreenerTool } from './runScreener';
import { createSetScreenerRankingTool } from './setScreenerRanking';
import { createSetScreenerUniverseTool, type SetScreenerUniverseDeps } from './setScreenerUniverse';
import { createValidateScreenerTool } from './validateScreener';

// Extends set_screener_universe's own deps (WorkbenchDeps + catalog +
// instrumentDirectory) rather than introducing a second CatalogRegistry
// field: every tool in this group that needs a registry shares the one
// `catalog` field.
export interface ScreenerToolDeps extends SetScreenerUniverseDeps {
	// validate_screener and run_screener's evaluation-facing options.
	// Undefined means each tool factory's own honest-unavailability default
	// (createUnavailableMarketData) applies, matching AC2's deviation note.
	marketData?: ScreenerMarketData;
	costBudget?: number;
	// Injectable so a composition root (or a test) can supply a real or fake
	// ScreenerEvaluationPort/PinnedRunStore without run_screener's own default
	// wiring needing to change.
	evaluationPort?: ScreenerEvaluationPort;
	runStore?: PinnedRunStore;
	now?: () => Date;
}

export const SCREENER_TOOL_NAMES = [
	'create_screener',
	'set_screener_universe',
	'edit_filter_tree',
	'set_screener_ranking',
	'validate_screener',
	'run_screener'
] as const;

function evaluationOptions(
	deps: ScreenerToolDeps,
	registry: CatalogRegistry | undefined
): {
	registry: CatalogRegistry | undefined;
	marketData: ScreenerMarketData | undefined;
	costBudget: number | undefined;
} {
	return { registry, marketData: deps.marketData, costBudget: deps.costBudget };
}

export function buildScreenerTools(deps: ScreenerToolDeps): ToolSpec[] {
	return [
		createCreateScreenerTool(deps),
		createSetScreenerUniverseTool(deps),
		createEditFilterTreeTool(deps, deps.catalog),
		createSetScreenerRankingTool(deps, deps.catalog),
		createValidateScreenerTool(deps, evaluationOptions(deps, deps.catalog)),
		createRunScreenerTool(deps, {
			...evaluationOptions(deps, deps.catalog),
			evaluationPort: deps.evaluationPort,
			runStore: deps.runStore,
			now: deps.now
		})
	];
}
