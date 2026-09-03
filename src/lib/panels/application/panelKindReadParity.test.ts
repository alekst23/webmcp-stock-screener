// T-1015-11: failing test stubs for fixing get_canvas_state's panel-state
// blind spot. Two closed unions currently filter panel kinds out of the
// read path -- workspace.ts's normalizePanel (PANEL_KINDS) and
// panelState.ts's projectPanels/projectLayout (PROJECTABLE_KINDS) -- and
// both must widen (see T-1015-11's Solution Approach) or a novel-kind
// panel survives one filter only to be dropped by the other on the next
// WorkspaceRepository.get() round-trip.
//
// Each stub currently throws to fail clearly; the real assertions land
// when T-1015-11 is implemented.

import { describe, it } from 'vitest';

describe('workspace.ts normalizePanel no longer drops a novel panel kind', () => {
	// spec.md "Workspace read parity"; T-1015-11 AC1
	it('keeps a panel record whose kind is outside the original 8-kind PANEL_KINDS set', () => {
		throw new Error(
			'not implemented: T-1015-11 AC1 -- normalizeWorkspace({ panels: [{ id, kind: ' +
				'"a_novel_kind", ... }] }) must retain that panel, not drop it via PANEL_KINDS.has()'
		);
	});

	it('PanelKind is widened from a closed string-literal union to string', () => {
		throw new Error(
			'not implemented: T-1015-11 -- a PanelRecord constructed with an arbitrary string kind ' +
				'type-checks; PanelKind is no longer a fixed 8-member union'
		);
	});
});

describe('panelState.ts projection consults the panel registry, not a hardcoded set', () => {
	// spec.md "Workspace read parity"; T-1015-11 AC1
	it('projectPanels includes a panel whose kind is registered in the PanelRegistry but was ' +
		'outside the old PROJECTABLE_KINDS set', () => {
		throw new Error(
			'not implemented: T-1015-11 AC1 -- register a novel kind on a PanelRegistry, put a ' +
				'panel of that kind in PanelSystemState, call writePanelState(doc, state, registry), ' +
				'and assert doc.panels contains it'
		);
	});

	it('writePanelState takes a PanelRegistry parameter threaded from PanelUseCaseDeps.kinds', () => {
		throw new Error(
			'not implemented: T-1015-11 -- writePanelState/projectPanels/projectLayout accept a ' +
				'PanelRegistry argument; commitPanelChange (support.ts) passes deps.kinds through'
		);
	});
});

describe('a novel panel kind is visible through the actual get_canvas_state read path', () => {
	// spec.md "Workspace read parity"; T-1015-11 AC2, AC4 -- the regression
	// test: this must exercise a real repository round-trip (put then get),
	// since normalizeWorkspace's own filter only manifests on re-read, not
	// on the initial write.
	it('registers a novel panel kind, creates a panel of it, and finds it in getCanvasState ' +
		'after a repository.put/get round-trip', () => {
		throw new Error(
			'not implemented: T-1015-11 AC2/AC4 -- createPanel with a newly-registered kind, ' +
				'commit through recordCommit (which calls repository.put), then call ' +
				'repository.get() and getCanvasState()\'s tool execute; the panel must be present, ' +
				'not silently dropped by a re-normalize'
		);
	});
});

describe('no regression to panel kinds already covered', () => {
	// T-1015-11 AC3
	it('every one of the original 8 panel kinds still round-trips through normalizeWorkspace ' +
		'and projects into doc.panels/doc.layout unchanged', () => {
		throw new Error(
			'not implemented: T-1015-11 AC3 -- filter_builder, chart, study_library, ' +
				'results_table, similar_opportunities, watchlist, alerts, symbol_details all still ' +
				'appear after the widening'
		);
	});
});
