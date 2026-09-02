// The panel system's actual source of truth, and the write-only
// projection that keeps EPIC-1006's `get_canvas_state` truthful.
//
// WHY the extension, not `doc.panels`: EPIC-1006's `PanelKind` union is
// closed to eight kinds, and `normalizeWorkspace` silently *drops* any
// panel record whose kind isn't in that union (workbench/domain/
// workspace.ts). If this epic's panels lived in `doc.panels` directly, a
// sibling epic registering a ninth panel kind would see its panels
// vanish on the next normalize -- a workspace load, a revision restore,
// anything that round-trips through `normalizeWorkspace`. Storing under
// `doc.extensions['panel_system']` sidesteps that union entirely; only
// the *projection* below has to respect it, and it does so by skipping
// (never corrupting) whatever it can't represent.
import { emptyLinkGraph, type PanelLinkGraph, type PanelLinkGroup } from '../domain/links';
import { isPanelLinkChannel, type PanelLinkChannel } from '../domain/channels';
import { makePanel, type Panel, type PanelSourceRef } from '../domain/panel';
import type { GridRect } from '../domain/grid';
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

// EPIC-1006's PanelKind union, reproduced here because workbench/domain/
// workspace.ts keeps its own copy private. Kept in sync with
// docs/design/panel-system/technical.md's "kind -> link channel matrix",
// which happens to be the same eight kinds EPIC-1006 already knows about.
const PROJECTABLE_KINDS: ReadonlySet<string> = new Set([
	'filter_builder',
	'chart',
	'study_library',
	'results_table',
	'similar_opportunities',
	'watchlist',
	'alerts',
	'symbol_details'
]);

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

function projectPanels(panels: Panel[]): PanelRecord[] {
	return panels
		.filter((panel) => PROJECTABLE_KINDS.has(panel.kind))
		.map((panel) => ({
			id: panel.id,
			kind: panel.kind as PanelRecord['kind'],
			title: panel.title,
			collapsed: panel.collapsed,
			visible: !panel.hidden,
			boundResourceId: boundResourceIdOf(panel.source),
			config: panel.config
		}));
}

function projectLayout(panels: Panel[]): LayoutEntry[] {
	return panels
		.filter((panel) => PROJECTABLE_KINDS.has(panel.kind))
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
// every call -- never patched incrementally, never read back as state.
// A panel whose kind falls outside EPIC-1006's eight-kind union is
// skipped from the projection rather than corrupting the document.
export function writePanelState(
	doc: WorkspaceDocument,
	state: PanelSystemState
): WorkspaceDocument {
	return {
		...doc,
		panels: projectPanels(state.panels),
		layout: projectLayout(state.panels),
		links: projectLinks(state.links),
		extensions: { ...doc.extensions, [EXTENSION_KEY]: state }
	};
}
