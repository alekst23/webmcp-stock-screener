// T-1015-12 grew the default seed from three panels to the full six-panel
// target composition. hotfix/empty-grid-canvas reverses that: the default
// seed is now just filter_builder, full-height on the left column, so a
// fresh workspace starts minimal instead of pre-populated. See spec.md's
// amended "Seed a new workspace with the default layout" for the product
// intent. Kind-registration tests (watchlist, alert_draft,
// similar_opportunities exist as real, non-placeholder kinds) are
// unaffected by the seed change and are left as they were -- those kinds
// remain fully usable via create_panel, they are just no longer part of
// the default seed.
//
// createDefaultPanelShellRuntime() always uses the real localStorage-backed
// WorkspaceRepository (it takes no injectable deps), so localStorage is
// cleared before every test -- the same convention registerPanelTools.test.ts
// already established, for the same reason.
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultPanelShellRuntime } from './registerPanelTools';
import { readPanelState } from '../application';
import { createPanel } from '../application';
import { GRID_COLUMNS, GRID_ROWS } from '../domain/grid';
import { createOperationRegistry } from '../../workbench/application/operationRegistry';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import type { MarketDataProvenance } from '../../workbench/domain/provenance';
import { buildWorkbenchTools, type WorkbenchDeps } from '../../workbench/tools/index';
import { similarOpportunitiesPanelKindDefinition } from '../../workbench/similarity/panel/domain/panelKind';

const FIXED_PROVENANCE: MarketDataProvenance = {
	asOf: '2026-09-02T14:00:00.000Z',
	sourceId: 'eodhd',
	sourceLabel: 'EOD Historical Data',
	liveness: 'delayed',
	delaySeconds: 900,
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted',
	engineVersion: '1.0.0'
};

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

beforeEach(() => {
	localStorage.clear();
});

describe('two new real panel kinds render EPIC-1014 tool state', () => {
	// spec.md "Route migration / Rich default layout"; T-1015-12 AC1
	it('registers watchlist as a real kind (bound-source rendering, not the placeholder) in the shared composition registry', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const kind = deps.kinds.require('watchlist');
		expect(kind.bindingTypes).toEqual(['watchlist', 'symbol_list']);
		expect(kind.defaultConfig()).toEqual({ sortBy: 'symbol' });
	});

	it("registers alert_draft as a real, NEW kind distinct from the untouched 'alerts' placeholder", () => {
		const { deps } = createDefaultPanelShellRuntime();
		expect(
			deps.kinds.has('alert_draft'),
			'expected the new alert_draft kind to be registered'
		).toBe(true);
		expect(
			deps.kinds.has('alerts'),
			"expected the pre-existing 'alerts' (plural) placeholder to remain, untouched"
		).toBe(true);
		expect(deps.kinds.require('alert_draft').defaultTitle).toBe('Alert Draft');
	});
});

describe('a brand-new workspace seeds only filter_builder', () => {
	// spec.md "Seed a new workspace with the default layout", amended by
	// hotfix/empty-grid-canvas
	it('DEFAULT_SEED_PANELS includes only filter_builder', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const doc = deps.repository.get(deps.workspaceId);
		expect(doc, 'expected the seeded workspace document to exist').not.toBeNull();
		const kinds = readPanelState(doc!).panels.map((p) => p.kind);
		expect(kinds, `expected only filter_builder seeded, got ${JSON.stringify(kinds)}`).toEqual([
			'filter_builder'
		]);
	});

	it('seeds filter_builder full-height on the left column, leaving the rest of the grid empty', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const panels = readPanelState(deps.repository.get(deps.workspaceId)!).panels;
		expect(panels).toHaveLength(1);

		const filterBuilder = panels[0]!;
		expect(filterBuilder.kind).toBe('filter_builder');
		expect(filterBuilder.rect).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 4 });

		const occupiedCells = filterBuilder.rect.colSpan * filterBuilder.rect.rowSpan;
		expect(occupiedCells, 'expected filter_builder to occupy 8 of the 24 cells').toBe(8);
		expect(
			GRID_COLUMNS * GRID_ROWS - occupiedCells,
			'expected the remaining 16 cells to start empty'
		).toBe(16);

		expect(filterBuilder.source, 'expected the seeded panel to start unbound').toBeNull();
	});
});

describe('similar_opportunities remains a real, addable kind even though it is no longer seeded', () => {
	// Was T-1015-12 AC3 ("the default seed includes similar_opportunities
	// with no new kind registered"); the seed no longer includes it under
	// hotfix/empty-grid-canvas, but the kind-identity guarantee still holds.
	it('is registered as the exact same PanelKindDefinition T-1012-6 exports, and is absent from the default seed', () => {
		const { deps } = createDefaultPanelShellRuntime();
		expect(deps.kinds.require('similar_opportunities')).toBe(
			similarOpportunitiesPanelKindDefinition
		);

		const doc = deps.repository.get(deps.workspaceId)!;
		const seeded = readPanelState(doc).panels.find((p) => p.kind === 'similar_opportunities');
		expect(seeded, 'expected no similar_opportunities panel in the default seed').toBeUndefined();
	});

	it('can still be added explicitly via create_panel after the fact', () => {
		const { deps } = createDefaultPanelShellRuntime();
		createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'similar_opportunities',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 2 }
		});

		const doc = deps.repository.get(deps.workspaceId)!;
		const panel = readPanelState(doc).panels.find((p) => p.kind === 'similar_opportunities');
		expect(panel, 'expected create_panel to add a similar_opportunities panel').toBeDefined();
		expect(panel!.config).toEqual(similarOpportunitiesPanelKindDefinition.defaultConfig());
	});
});

describe('watchlist and alert_draft remain reachable through the shared workspace-read tool', () => {
	// Was T-1015-12 AC4, against the (then) six-panel default seed. Rewritten
	// under hotfix/empty-grid-canvas to add the panels explicitly, since the
	// default seed is now just filter_builder -- this test is about
	// get_canvas_state's read path covering these kinds, not about the seed.
	it('get_canvas_state returns explicitly-added watchlist and alert_draft panels alongside the seeded filter_builder', async () => {
		const { deps } = createDefaultPanelShellRuntime();
		createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'watchlist',
			rect: { col: 2, row: 0, colSpan: 2, rowSpan: 2 }
		});
		createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'alert_draft',
			rect: { col: 4, row: 0, colSpan: 2, rowSpan: 2 }
		});

		const workbenchDeps: WorkbenchDeps = {
			repository: deps.repository,
			revisions: deps.revisions,
			history: deps.history,
			registry: createOperationRegistry(),
			provenance: { current: () => FIXED_PROVENANCE },
			clock: deps.clock,
			ids: deps.ids,
			idempotency: createIdempotencyCache()
		};
		const tools = buildWorkbenchTools(workbenchDeps);
		const getCanvasState = tools.find((t) => t.name === 'get_canvas_state');
		expect(getCanvasState, 'expected get_canvas_state to be registered').toBeDefined();

		const result = await getCanvasState!.execute({ workspace_id: deps.workspaceId });
		const body = jsonOf(result) as { panels: { kind: string }[] };
		const kinds = body.panels.map((p) => p.kind);

		expect(kinds, `expected 3 panels readable, got ${JSON.stringify(kinds)}`).toHaveLength(3);
		expect(kinds).toContain('filter_builder');
		expect(kinds).toContain('watchlist');
		expect(kinds).toContain('alert_draft');
	});
});
