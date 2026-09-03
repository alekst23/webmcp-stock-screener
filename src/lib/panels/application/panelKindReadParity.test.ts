// T-1015-11: fixes get_canvas_state's panel-state blind spot. Two closed
// unions used to filter panel kinds out of the read path -- workspace.ts's
// normalizePanel (PANEL_KINDS) and panelState.ts's projectPanels/
// projectLayout (PROJECTABLE_KINDS) -- and both had to widen (see
// T-1015-11's Solution Approach) or a novel-kind panel would survive one
// filter only to be dropped by the other on the next
// WorkspaceRepository.get() round-trip.
import { describe, expect, it } from 'vitest';
import {
	emptyWorkspace,
	normalizeWorkspace,
	type PanelRecord
} from '../../workbench/domain/workspace';
import { createOperationRegistry } from '../../workbench/application/operationRegistry';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import type { MarketDataProvenance } from '../../workbench/domain/provenance';
import { buildWorkbenchTools, type WorkbenchDeps } from '../../workbench/tools/index';
import { makePanel } from '../domain/panel';
import { createPanelRegistry, type PanelKindDefinition } from '../registry/panelKindRegistry';
import { createPanel } from './createPanel';
import { readPanelState, writePanelState, type PanelSystemState } from './panelState';
import { createPanelTestHarness } from './testSupport';

const ORIGINAL_EIGHT_KINDS = [
	'filter_builder',
	'chart',
	'study_library',
	'results_table',
	'similar_opportunities',
	'watchlist',
	'alerts',
	'symbol_details'
];

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

function minimalKindDefinition(kind: string): PanelKindDefinition {
	return {
		kind,
		defaultTitle: kind,
		defaultSize: { colSpan: 1, rowSpan: 1 },
		minSize: { colSpan: 1, rowSpan: 1 },
		defaultConfig: () => ({}),
		validateConfig: () => ({ ok: true, value: {} }),
		configSchema: { type: 'object', properties: {} },
		linkChannels: [],
		bindingTypes: [],
		defaultRenderer: null,
		component: async () => ({})
	};
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

describe('workspace.ts normalizePanel no longer drops a novel panel kind', () => {
	// spec.md "Workspace read parity"; T-1015-11 AC1
	it('keeps a panel record whose kind is outside the original 8-kind PANEL_KINDS set', () => {
		const raw = {
			id: 'workspace_1',
			panels: [
				{
					id: 'panel_1',
					kind: 'a_novel_kind',
					title: 'Novel',
					collapsed: false,
					visible: true,
					boundResourceId: null,
					config: {}
				}
			]
		};

		const normalized = normalizeWorkspace(raw);

		expect(
			normalized.panels.map((p) => p.kind),
			`expected the novel-kind panel to survive normalization, got ${JSON.stringify(normalized.panels)}`
		).toContain('a_novel_kind');
	});

	it('PanelKind is widened from a closed string-literal union to string', () => {
		// Type-level assertion: this constructs a PanelRecord with an
		// arbitrary string kind. If PanelKind were still the closed
		// 8-member union, this would fail to type-check under `tsc`.
		const record: PanelRecord = {
			id: 'panel_1',
			kind: 'a_completely_arbitrary_kind_string',
			title: 'Arbitrary',
			collapsed: false,
			visible: true,
			boundResourceId: null,
			config: {}
		};

		expect(record.kind).toBe('a_completely_arbitrary_kind_string');
	});
});

describe('panelState.ts projection consults the panel registry, not a hardcoded set', () => {
	// spec.md "Workspace read parity"; T-1015-11 AC1
	it(
		'projectPanels includes a panel whose kind is registered in the PanelRegistry but was ' +
			'outside the old PROJECTABLE_KINDS set',
		() => {
			const harness = createPanelTestHarness();
			harness.kinds.register(minimalKindDefinition('a_novel_registered_kind'));

			const doc = emptyWorkspace(harness.workspaceId, 'Test', harness.clockValue);
			const panel = makePanel({
				id: 'panel_novel_1',
				kind: 'a_novel_registered_kind',
				title: 'Novel',
				config: {},
				rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
			});
			const state: PanelSystemState = { panels: [panel], links: { groups: [] }, selections: {} };

			const next = writePanelState(doc, state, harness.kinds);

			expect(
				next.panels.map((p) => p.id),
				`expected the novel-kind panel in doc.panels, got ${JSON.stringify(next.panels)}`
			).toContain('panel_novel_1');
			expect(next.layout.map((l) => l.panelId)).toContain('panel_novel_1');
		}
	);

	it('writePanelState takes a PanelRegistry parameter threaded from PanelUseCaseDeps.kinds', () => {
		const harness = createPanelTestHarness();
		harness.kinds.register(minimalKindDefinition('another_novel_kind'));

		const envelope = createPanel(harness, {
			context: { actor: 'agent' },
			kind: 'another_novel_kind'
		});

		expect(envelope.affectedIds.length, 'expected createPanel to succeed').toBe(1);
		const doc = harness.repository.get(harness.workspaceId)!;
		expect(
			doc.panels.map((p) => p.kind),
			'expected commitPanelChange to have threaded deps.kinds through writePanelState'
		).toContain('another_novel_kind');
	});
});

describe('a novel panel kind is visible through the actual get_canvas_state read path', () => {
	// spec.md "Workspace read parity"; T-1015-11 AC2, AC4 -- the regression
	// test: this must exercise a real repository round-trip (put then get),
	// since normalizeWorkspace's own filter only manifests on re-read, not
	// on the initial write.
	it(
		'registers a novel panel kind, creates a panel of it, and finds it in getCanvasState ' +
			'after a repository.put/get round-trip',
		async () => {
			const harness = createPanelTestHarness();
			harness.kinds.register(minimalKindDefinition('sibling_epic_kind'));

			createPanel(harness, { context: { actor: 'agent' }, kind: 'sibling_epic_kind' });

			// Force the round-trip explicitly: readPanelState/get() alone would
			// not prove anything, since writePanelState already ran during the
			// commit above. The bug this ticket fixes only manifests on the
			// NEXT read, when normalizeWorkspace re-parses the JSON-serialized
			// document and re-applies its own (formerly closed) filter.
			const roundTripped = harness.repository.get(harness.workspaceId);
			expect(roundTripped).not.toBeNull();
			expect(
				roundTripped!.panels.map((p) => p.kind),
				'expected the novel kind to survive a repository round-trip'
			).toContain('sibling_epic_kind');

			const deps: WorkbenchDeps = {
				repository: harness.repository,
				revisions: harness.revisions,
				history: harness.history,
				registry: createOperationRegistry(),
				provenance: { current: () => FIXED_PROVENANCE },
				clock: harness.clock,
				ids: harness.ids,
				idempotency: createIdempotencyCache()
			};
			const tools = buildWorkbenchTools(deps);
			const getCanvasState = tools.find((t) => t.name === 'get_canvas_state');
			expect(getCanvasState, 'expected get_canvas_state to be registered').toBeDefined();

			const result = await getCanvasState!.execute({ workspace_id: harness.workspaceId });
			const body = jsonOf(result) as { panels: { kind: string }[] };

			expect(
				body.panels.map((p) => p.kind),
				`expected get_canvas_state to report the novel kind, got ${JSON.stringify(body.panels)}`
			).toContain('sibling_epic_kind');
		}
	);
});

describe('no regression to panel kinds already covered', () => {
	// T-1015-11 AC3
	it(
		'every one of the original 8 panel kinds still round-trips through normalizeWorkspace ' +
			'and projects into doc.panels/doc.layout unchanged',
		() => {
			const harness = createPanelTestHarness();
			// createPanelTestHarness already seeds the real default panel kinds
			// (registerDefaultPanelKinds), which cover the original eight.

			const panels = ORIGINAL_EIGHT_KINDS.map((kind, i) =>
				makePanel({
					id: `panel_${kind}`,
					kind,
					title: kind,
					config: {},
					rect: { col: i, row: 0, colSpan: 1, rowSpan: 1 }
				})
			);
			const doc = emptyWorkspace(harness.workspaceId, 'Test', harness.clockValue);
			const state: PanelSystemState = { panels, links: { groups: [] }, selections: {} };

			const projected = writePanelState(doc, state, harness.kinds);
			expect(
				projected.panels.map((p) => p.kind).sort(),
				`expected all 8 original kinds to project, got ${JSON.stringify(projected.panels)}`
			).toEqual([...ORIGINAL_EIGHT_KINDS].sort());
			expect(projected.layout.length).toBe(ORIGINAL_EIGHT_KINDS.length);

			// And they survive a normalizeWorkspace round-trip (the JSON
			// serialize/deserialize a real repository.put/get performs).
			const roundTripped = normalizeWorkspace(JSON.parse(JSON.stringify(projected)));
			expect(
				roundTripped.panels.map((p) => p.kind).sort(),
				`expected all 8 original kinds to survive normalizeWorkspace, got ${JSON.stringify(roundTripped.panels)}`
			).toEqual([...ORIGINAL_EIGHT_KINDS].sort());
		}
	);

	it('readPanelState is unaffected by registry filtering -- the source of truth stays kind-agnostic', () => {
		const harness = createPanelTestHarness();
		const panel = makePanel({
			id: 'panel_unregistered_1',
			kind: 'not_registered_anywhere',
			title: 'Unregistered',
			config: {},
			rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
		});
		const doc = emptyWorkspace(harness.workspaceId, 'Test', harness.clockValue);
		const written = writePanelState(
			doc,
			{ panels: [panel], links: { groups: [] }, selections: {} },
			createPanelRegistry()
		);

		expect(written.panels, 'unregistered kind must not appear in the projection').toEqual([]);
		expect(
			readPanelState(written).panels.map((p) => p.id),
			'but the source of truth under extensions must still carry it'
		).toContain('panel_unregistered_1');
	});
});
