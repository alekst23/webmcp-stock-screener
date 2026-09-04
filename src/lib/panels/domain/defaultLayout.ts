// The canonical default arrangement, shared by two callers:
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

// hotfix/empty-grid-canvas: reverses T-1015-12's six-panel full-tile seed
// (filter_builder, chart, similar_opportunities, results_table, watchlist,
// alert_draft) back down to a single panel. The default layout is now
// deliberately minimal -- filter_builder, full-height on the left column --
// so a fresh workspace starts with one working control and an obviously
// empty grid, rather than a pre-populated research layout. See spec.md's
// amended "Seed a new workspace with the default layout" for the product
// intent behind the change. resetLayout.ts applies this same constant, so
// "reset to default" always reproduces exactly this seed, not the six-panel
// arrangement T-1015-12 originally shipped.
export const DEFAULT_SEED_PANELS: readonly SeedPanelSpec[] = [
	{ kind: 'filter_builder', rect: { col: 0, row: 0, colSpan: 2, rowSpan: 4 } }
];
