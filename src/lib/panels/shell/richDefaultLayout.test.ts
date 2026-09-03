// T-1015-12: failing test stubs for enriching the default workspace
// layout to the full six-panel target composition. Depends on T-1015-9
// (shell exists) and T-1015-11 (read-path widened so all six kinds are
// visible through get_canvas_state).
//
// Each stub currently throws to fail clearly; the real assertions land
// when T-1015-12 is implemented.

import { describe, it } from 'vitest';

describe('two new real panel kinds render EPIC-1014 tool state', () => {
	// spec.md "Route migration / Rich default layout"; T-1015-12 AC1
	it('registers a real watchlist panel kind rendering StaticWatchlist/DynamicWatchlist membership', () => {
		throw new Error(
			'not implemented: T-1015-12 AC1 -- registerWatchlistPanelKind(registry, deps) replaces ' +
				"the defaultPanelKinds.ts placeholder for kind 'watchlist' with a real definition " +
				'rendering workbench/watchlist/domain/watchlist.ts state'
		);
	});

	it('registers a real alert_draft panel kind rendering a drafted alert pending review', () => {
		throw new Error(
			'not implemented: T-1015-12 AC1 -- registerAlertDraftPanelKind(registry, deps) ' +
				"registers a NEW kind named 'alert_draft', distinct from defaultPanelKinds.ts's " +
				"existing 'alerts' placeholder, rendering workbench/alerts/domain/alert.ts / " +
				'alertPreview.ts state'
		);
	});
});

describe('a brand-new workspace seeds all six intended panels', () => {
	// spec.md "Route migration / Rich default layout"; T-1015-12 AC2
	it('DEFAULT_SEED_PANELS includes filter_builder, results_table, chart, watchlist, ' +
		'alert_draft, and similar_opportunities', () => {
		throw new Error(
			'not implemented: T-1015-12 AC2 -- panelController.ts\'s DEFAULT_SEED_PANELS grows ' +
				'from 3 entries to 6; seedDefaultWorkspace still only seeds when justCreated'
		);
	});

	it('lays the six panels out per the reference mockup (screener left, chart center, ' +
		'similar-setups sidebar right, watchlist+alert-draft bottom right, results bottom)', () => {
		throw new Error(
			'not implemented: T-1015-12 AC2 -- each seeded GridRect fits the fixed 6x4 grid ' +
				"without overlap, per docs/plan/project.md's 2026-09-02 arrangement note"
		);
	});
});

describe('similar_opportunities is included using its existing registered kind', () => {
	// T-1015-12 AC3
	it('the default seed includes a similar_opportunities panel with no new kind registered for it', () => {
		throw new Error(
			'not implemented: T-1015-12 AC3 -- verify the real similar_opportunities ' +
				'PanelKindDefinition (workbench/similarity/panel/domain/panelKind.ts, T-1012-6) is ' +
				"registered into the SAME shared registry DEFAULT_SEED_PANELS seeds against -- " +
				"today it only lives in registerSimilarityTools.ts's own standalone registry; " +
				'confirm T-1015-3 already unified this before assuming it is free'
		);
	});
});

describe('each new panel kind is reachable through the shared workspace-read tool', () => {
	// T-1015-12 AC4 (depends on T-1015-11)
	it('get_canvas_state returns watchlist, alert_draft, and similar_opportunities panels from a fresh workspace', () => {
		throw new Error(
			'not implemented: T-1015-12 AC4 -- depends on T-1015-11\'s widened read path; seed a ' +
				'fresh workspace and assert all six panels, including the three new/newly-seeded ' +
				"kinds, appear in getCanvasState()'s panels array"
		);
	});
});

describe('production build succeeds and a fresh workspace loads all six panels', () => {
	// T-1015-12 AC5
	it('no console errors on first paint of a brand-new workspace', () => {
		throw new Error(
			'not implemented: T-1015-12 AC5 -- verified via browser check at ticket close per ' +
				'project convention, not a vitest assertion; this stub tracks that the check happens'
		);
	});
});
