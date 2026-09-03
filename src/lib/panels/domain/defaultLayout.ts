// The canonical six-panel default arrangement, shared by two callers:
// panelController.ts's seedDefaultWorkspace (applied once, at creation of a
// genuinely new workspace) and application/resetLayout.ts (applied on
// demand, replacing whatever arrangement currently exists). Moved here from
// panelController.ts so the application layer can depend on it without
// reaching into the shell layer -- domain has no dependents to violate.
import type { GridRect } from './grid';

export interface SeedPanelSpec {
	kind: string;
	rect: GridRect;
}

// T-1015-12: the full six-panel target composition, per the user's own
// reference mockup (docs/plan/project.md's 2026-09-02 arrangement note) --
// screener logic left, chart with studies center, similar-setups sidebar
// right, watchlist and alert-draft bottom right, results table bottom. Every
// rect below is >= its kind's own minSize (never its defaultSize, which
// would not fit six panels on one fixed 6x4 grid) and the six exactly tile
// the grid with no gaps or overlaps:
//   col 0-1, row 0-3: filter_builder (full-height, left)
//   col 2-4, row 0-1: chart (center, top)
//   col   5, row 0-1: similar_opportunities (sidebar, right)
//   col 2-4, row 2-3: results_table (center, bottom)
//   col   5, row   2: watchlist (bottom right)
//   col   5, row   3: alert_draft (bottom right)
export const DEFAULT_SEED_PANELS: readonly SeedPanelSpec[] = [
	{ kind: 'filter_builder', rect: { col: 0, row: 0, colSpan: 2, rowSpan: 4 } },
	{ kind: 'chart', rect: { col: 2, row: 0, colSpan: 3, rowSpan: 2 } },
	{ kind: 'similar_opportunities', rect: { col: 5, row: 0, colSpan: 1, rowSpan: 2 } },
	{ kind: 'results_table', rect: { col: 2, row: 2, colSpan: 3, rowSpan: 2 } },
	{ kind: 'watchlist', rect: { col: 5, row: 2, colSpan: 1, rowSpan: 1 } },
	{ kind: 'alert_draft', rect: { col: 5, row: 3, colSpan: 1, rowSpan: 1 } }
];
