// The screener tool group (T-1009-10, narrowed to the MVP two-tool surface
// by T-0026-5): one builder composing define_screener (T-0026-1) and
// run_screener (T-1009-9), mirroring webmcp/discovery/group.ts's pattern --
// explicit dependencies, no module-level singleton, nothing here decides
// whether the group is registered on the live page (that is
// registerScreenerTools.ts's job, this epic's composition root).
//
// T-0026-5: this used to also build create_screener, set_screener_universe,
// edit_filter_tree, set_screener_ranking and validate_screener --
// define_screener (T-0026-1) absorbs their domain logic behind one
// full-replace call (see tool-surface-mvp.md #3). Those five tool modules
// are not all deleted, though: createScreener.ts, setScreenerUniverse.ts and
// setScreenerRanking.ts are still imported directly by out-of-scope test
// fixtures (backtest/tools/backtestScreener.test.ts,
// followup/tools/testFixtures.ts, runScreener.test.ts's own fixtures), and
// editFilterTree.ts by followup/tools/followupAuthoringFlow.e2e.test.ts --
// this ticket's scope is registration, not deleting code other groups still
// exercise. Only validateScreener.ts had no importer left once removed here,
// so that module (and its test) was deleted outright.
//
// Evaluation (run_screener) is built entirely in browser-side TypeScript
// here -- see this ticket's Solution Approach for why AC2's literal "over
// HTTP" wording does not apply to this epic.

import type {
	PinnedRunStore,
	ScreenerEvaluationPort,
	ScreenerMarketData
} from '../../screener/ports';
import type { ToolSpec } from '../types';
import { createDefineScreenerTool } from './defineScreener';
import { createRunScreenerTool } from './runScreener';
import type { PanelBindingDeps } from '../../panels/application';
import type { SetScreenerUniverseDeps } from './setScreenerUniverse';

// Extends set_screener_universe's own deps (WorkbenchDeps + catalog +
// instrumentDirectory) rather than introducing a second CatalogRegistry
// field: every tool in this group that needs a registry shares the one
// `catalog` field.
export interface ScreenerToolDeps extends SetScreenerUniverseDeps {
	// define_screener and run_screener's evaluation-facing options.
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
	// T-0020-2: when supplied, a completed run_screener call auto-binds the
	// workspace's first results_table panel to it. Undefined means no
	// binding is attempted (registerScreenerTools.ts's own default deps
	// build no panel registries, matching this group's pre-T-0020-2
	// behavior).
	panelBinding?: PanelBindingDeps;
}

export const SCREENER_TOOL_NAMES = ['define_screener', 'run_screener'] as const;

export function buildScreenerTools(deps: ScreenerToolDeps): ToolSpec[] {
	return [
		createDefineScreenerTool(deps),
		createRunScreenerTool(deps, {
			registry: deps.catalog,
			marketData: deps.marketData,
			costBudget: deps.costBudget,
			evaluationPort: deps.evaluationPort,
			runStore: deps.runStore,
			now: deps.now,
			panelBinding: deps.panelBinding
		})
	];
}
