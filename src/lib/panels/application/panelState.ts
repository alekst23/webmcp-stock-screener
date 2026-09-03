// The panel system's actual source of truth, and the write-only
// projection that keeps EPIC-1006's `get_canvas_state` truthful.
//
// WHY the extension, not `doc.panels`: even now that both `normalizeWorkspace`
// (workbench/domain/workspace.ts) and the projection below have widened to
// accept any registered kind (T-1015-11), a panel of a kind nobody has
// registered against a given `PanelRegistry` instance still shouldn't show
// up in `doc.panels` as if it were a real, addressable panel. Storing under
// `doc.extensions['panel_system']` keeps the full, kind-agnostic state
// intact regardless of registration; only the *projection* below decides
// what's addressable, and it does so by skipping (never corrupting)
// whatever isn't registered.
import { emptyLinkGraph, type PanelLinkGraph, type PanelLinkGroup } from '../domain/links';
import { isPanelLinkChannel, type PanelLinkChannel } from '../domain/channels';
import { makePanel, type Panel, type PanelSourceRef } from '../domain/panel';
import type { GridRect } from '../domain/grid';
import { parseId } from '../../workbench/domain/ids';
import type { PanelRegistry } from '../registry/panelKindRegistry';
import type {
	LayoutEntry,
	PanelLink,
	PanelLinkChannel as WorkbenchLinkChannel,
	PanelRecord,
	WorkspaceDocument
} from '../../workbench/domain/workspace';

export interface PanelSystemState {
	panels: Panel[];
	links: PanelLinkGraph;
	// panelId -> selected result ids.
	selections: Record<string, string[]>;
}

const EXTENSION_KEY = 'panel_system';

export function emptyPanelState(): PanelSystemState {
	return { panels: [], links: emptyLinkGraph(), selections: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGridRect(value: unknown): value is GridRect {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.col === 'number' &&
		typeof value.row === 'number' &&
		typeof value.colSpan === 'number' &&
		typeof value.rowSpan === 'number'
	);
}

function normalizeSourceRef(value: unknown): PanelSourceRef | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (!isRecord(value) || typeof value.type !== 'string' || !isRecord(value.ref)) {
		return null;
	}
	return { type: value.type, ref: value.ref };
}

function normalizePanel(value: unknown): Panel | null {
	if (!isRecord(value)) {
		return null;
	}
	const { id, kind, title, config, rect } = value;
	if (typeof id !== 'string' || typeof kind !== 'string' || !isGridRect(rect)) {
		return null;
	}
	return makePanel({
		id,
		kind,
		title: typeof title === 'string' ? title : '',
		config: isRecord(config) ? config : {},
		rect,
		hidden: value.hidden === true,
		collapsed: value.collapsed === true,
		source: normalizeSourceRef(value.source),
		renderer: typeof value.renderer === 'string' ? value.renderer : null
	});
}

function normalizeLinkGroup(value: unknown): PanelLinkGroup | null {
	if (!isRecord(value)) {
		return null;
	}
	const { id, channel, panelIds } = value;
	if (
		typeof id !== 'string' ||
		!isPanelLinkChannel(channel) ||
		!Array.isArray(panelIds) ||
		!panelIds.every((p) => typeof p === 'string')
	) {
		return null;
	}
	return { id, channel, panelIds: panelIds as string[] };
}

function normalizeLinkGraph(value: unknown): PanelLinkGraph {
	if (!isRecord(value) || !Array.isArray(value.groups)) {
		return emptyLinkGraph();
	}
	const groups: PanelLinkGroup[] = [];
	for (const item of value.groups) {
		const normalized = normalizeLinkGroup(item);
		if (normalized !== null) {
			groups.push(normalized);
		}
	}
	return { groups };
}

function normalizeSelections(value: unknown): Record<string, string[]> {
	if (!isRecord(value)) {
		return {};
	}
	const out: Record<string, string[]> = {};
	for (const [panelId, ids] of Object.entries(value)) {
		if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
			out[panelId] = ids as string[];
		}
	}
	return out;
}

// Resilient the way normalizeWorkspace is: malformed or absent extension
// data yields an empty valid state, never a throw. Individual malformed
// entries are dropped rather than failing the whole read.
export function readPanelState(doc: WorkspaceDocument): PanelSystemState {
	const raw = doc.extensions[EXTENSION_KEY];
	if (!isRecord(raw)) {
		return emptyPanelState();
	}
	const panels: Panel[] = [];
	if (Array.isArray(raw.panels)) {
		for (const item of raw.panels) {
			const normalized = normalizePanel(item);
			if (normalized !== null) {
				panels.push(normalized);
			}
		}
	}
	return {
		panels,
		links: normalizeLinkGraph(raw.links),
		selections: normalizeSelections(raw.selections)
	};
}

// High-water mark for `createIdSequencer`, so a reloaded workspace never
// mints a panel ID an existing panel already holds. Reads the panel_system
// extension via readPanelState -- the real source of truth -- rather than
// doc.panels: that top-level field is projectPanels' registry-filtered
// view, which drops any panel whose kind isn't currently registered, and a
// sequencer seeded from it could then re-mint that panel's ID. Panel IDs
// carry their kind as the discriminator (`panel_<kind>_<n>`), so the seed
// is keyed per kind, mirroring watchlistIdSeed/chartIdSeed/filterDraftIdSeed.
export function panelIdSeed(doc: WorkspaceDocument | null): Record<string, number> {
	if (!doc) {
		return {};
	}
	const seed: Record<string, number> = {};
	for (const panel of readPanelState(doc).panels) {
		const parsed = parseId(panel.id);
		if (!parsed || parsed.kind !== 'panel' || !parsed.discriminator) {
			continue;
		}
		const key = `panel:${parsed.discriminator}`;
		seed[key] = Math.max(seed[key] ?? 0, parsed.sequence);
	}
	return seed;
}

// The one place 'result_selection' becomes EPIC-1006's 'selection'.
// Nothing else in this epic uses the wire name 'selection'.
function projectChannel(channel: PanelLinkChannel): WorkbenchLinkChannel {
	return channel === 'result_selection' ? 'selection' : channel;
}

// A source ref's shape is opaque and type-specific (run_id, watchlist_id,
// panel_id, ...) -- this is a best-effort display convenience for
// get_canvas_state, not a contract any code should parse back out.
const REF_ID_FIELDS = ['run_id', 'watchlist_id', 'panel_id'];

function boundResourceIdOf(source: Panel['source']): string | null {
	if (!source) {
		return null;
	}
	for (const field of REF_ID_FIELDS) {
		const value = source.ref[field];
		if (typeof value === 'string') {
			return value;
		}
	}
	return null;
}

function projectPanels(panels: Panel[], registry: PanelRegistry): PanelRecord[] {
	return panels
		.filter((panel) => registry.has(panel.kind))
		.map((panel) => ({
			id: panel.id,
			kind: panel.kind,
			title: panel.title,
			collapsed: panel.collapsed,
			visible: !panel.hidden,
			boundResourceId: boundResourceIdOf(panel.source),
			config: panel.config
		}));
}

function projectLayout(panels: Panel[], registry: PanelRegistry): LayoutEntry[] {
	return panels
		.filter((panel) => registry.has(panel.kind))
		.map((panel) => ({
			panelId: panel.id,
			col: panel.rect.col,
			row: panel.rect.row,
			width: panel.rect.colSpan,
			height: panel.rect.rowSpan
		}));
}

// A group of N panels projects to a chain of N-1 consecutive pairwise
// links -- enough to reconstruct the group's membership and connectivity
// for a display-only projection, without the O(N^2) full pairing.
function projectLinks(graph: PanelLinkGraph): PanelLink[] {
	const links: PanelLink[] = [];
	for (const group of graph.groups) {
		for (let i = 0; i < group.panelIds.length - 1; i++) {
			links.push({
				id: `${group.id}_${i}`,
				sourcePanelId: group.panelIds[i]!,
				targetPanelId: group.panelIds[i + 1]!,
				channel: projectChannel(group.channel)
			});
		}
	}
	return links;
}

// Recomputes doc.panels/doc.layout/doc.links wholesale from `state` on
// every call -- never patched incrementally, never read back as state. A
// panel whose kind isn't registered against `registry` is skipped from the
// projection rather than corrupting the document (T-1015-11: this used to
// check a hardcoded eight-kind set; now it consults the real registry, so
// any registered kind -- placeholder or real, from any epic -- projects).
export function writePanelState(
	doc: WorkspaceDocument,
	state: PanelSystemState,
	registry: PanelRegistry
): WorkspaceDocument {
	return {
		...doc,
		panels: projectPanels(state.panels, registry),
		layout: projectLayout(state.panels, registry),
		links: projectLinks(state.links),
		extensions: { ...doc.extensions, [EXTENSION_KEY]: state }
	};
}
