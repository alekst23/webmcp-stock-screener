// T-1015-12: enriching the default workspace layout to the full six-panel
// target composition. Depends on T-1015-9 (shell exists) and T-1015-11
// (read-path widened so all six kinds are visible through get_canvas_state).
//
// createDefaultPanelShellRuntime() always uses the real localStorage-backed
// WorkspaceRepository (it takes no injectable deps), so localStorage is
// cleared before every test -- the same convention registerPanelTools.test.ts
// already established, for the same reason.
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultPanelShellRuntime } from './registerPanelTools';
import { readPanelState } from '../application';
import { rectsOverlap } from '../domain/layout';
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

describe('a brand-new workspace seeds all six intended panels', () => {
	// spec.md "Route migration / Rich default layout"; T-1015-12 AC2
	it('DEFAULT_SEED_PANELS includes filter_builder, results_table, chart, watchlist, alert_draft, and similar_opportunities', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const doc = deps.repository.get(deps.workspaceId);
		expect(doc, 'expected the seeded workspace document to exist').not.toBeNull();
		const kinds = readPanelState(doc!)
			.panels.map((p) => p.kind)
			.sort();
		expect(kinds, `expected all six kinds seeded, got ${JSON.stringify(kinds)}`).toEqual(
			[
				'filter_builder',
				'chart',
				'similar_opportunities',
				'results_table',
				'watchlist',
				'alert_draft'
			].sort()
		);
	});

	it('lays the six panels out per the reference mockup, fully tiling the fixed 6x4 grid with no overlap', () => {
		const { deps } = createDefaultPanelShellRuntime();
		const panels = readPanelState(deps.repository.get(deps.workspaceId)!).panels;
		expect(panels).toHaveLength(6);

		for (const panel of panels) {
			expect(
				panel.rect.col >= 0 &&
					panel.rect.row >= 0 &&
					panel.rect.col + panel.rect.colSpan <= GRID_COLUMNS &&
					panel.rect.row + panel.rect.rowSpan <= GRID_ROWS,
				`expected ${panel.kind}'s rect ${JSON.stringify(panel.rect)} to fit the ${GRID_COLUMNS}x${GRID_ROWS} grid`
			).toBe(true);
		}

		for (let i = 0; i < panels.length; i += 1) {
			for (let j = i + 1; j < panels.length; j += 1) {
				expect(
					rectsOverlap(panels[i]!.rect, panels[j]!.rect),
					`expected ${panels[i]!.kind} and ${panels[j]!.kind} not to overlap`
				).toBe(false);
			}
		}

		const totalCells = panels.reduce((sum, p) => sum + p.rect.colSpan * p.rect.rowSpan, 0);
		expect(
			totalCells,
			'expected the six panels to exactly tile the 24-cell grid, with no gaps'
		).toBe(GRID_COLUMNS * GRID_ROWS);

		// Arrangement, per docs/plan/project.md's 2026-09-02 reference-mockup
		// note: screener logic left, chart with studies center, similar-setups
		// sidebar right, watchlist and alert-draft bottom right, results table
		// bottom.
		const byKind = Object.fromEntries(panels.map((p) => [p.kind, p]));
		expect(byKind.filter_builder!.rect.col, 'filter_builder is the leftmost panel').toBe(0);
		expect(
			byKind.chart!.rect.col,
			'chart sits to the right of filter_builder'
		).toBeGreaterThanOrEqual(byKind.filter_builder!.rect.col + byKind.filter_builder!.rect.colSpan);
		expect(
			byKind.similar_opportunities!.rect.col,
			'similar_opportunities is the rightmost sidebar, right of chart'
		).toBeGreaterThanOrEqual(byKind.chart!.rect.col + byKind.chart!.rect.colSpan);
		expect(
			byKind.watchlist!.rect.row,
			'watchlist sits in the bottom half of the grid'
		).toBeGreaterThanOrEqual(GRID_ROWS / 2);
		expect(
			byKind.alert_draft!.rect.row,
			'alert_draft sits in the bottom half of the grid'
		).toBeGreaterThanOrEqual(GRID_ROWS / 2);
		expect(
			byKind.results_table!.rect.row,
			'results_table sits along the bottom'
		).toBeGreaterThanOrEqual(GRID_ROWS / 2);

		expect(
			panels.every((p) => p.source === null),
			'expected every seeded panel to start unbound'
		).toBe(true);
	});
});

describe('similar_opportunities is included using its existing registered kind', () => {
	// T-1015-12 AC3
	it('the default seed includes a similar_opportunities panel with no new kind registered for it', () => {
		const { deps } = createDefaultPanelShellRuntime();
		// The exact same PanelKindDefinition value T-1012-6 already exports --
		// not a re-implementation, and now wired into the SAME shared registry
		// DEFAULT_SEED_PANELS seeds against (previously only ever registered
		// into registerSimilarityTools.ts's own standalone, disconnected
		// registry; see registerPanelTools.ts's T-1015-12 comment).
		expect(deps.kinds.require('similar_opportunities')).toBe(
			similarOpportunitiesPanelKindDefinition
		);

		const doc = deps.repository.get(deps.workspaceId)!;
		const panel = readPanelState(doc).panels.find((p) => p.kind === 'similar_opportunities');
		expect(panel, 'expected a seeded similar_opportunities panel').toBeDefined();
		expect(panel!.config).toEqual(similarOpportunitiesPanelKindDefinition.defaultConfig());
	});
});

describe('each new panel kind is reachable through the shared workspace-read tool', () => {
	// T-1015-12 AC4 (depends on T-1015-11)
	it('get_canvas_state returns watchlist, alert_draft, and similar_opportunities panels from a fresh workspace', async () => {
		const { deps } = createDefaultPanelShellRuntime();
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

		expect(
			kinds,
			`expected all six seeded kinds readable, got ${JSON.stringify(kinds)}`
		).toHaveLength(6);
		expect(kinds).toContain('watchlist');
		expect(kinds).toContain('alert_draft');
		expect(kinds).toContain('similar_opportunities');
	});
});

describe('production build succeeds and a fresh workspace loads all six panels', () => {
	// T-1015-12 AC5 -- verified via a manual browser check (chrome-devtools
	// MCP against a served production build) at ticket close, per project
	// convention; not an assertion a unit test can make. See the ticket doc's
	// Verification notes for the outcome.
	it.todo(
		'no console errors on first paint of a brand-new workspace -- verified via browser check'
	);
});
