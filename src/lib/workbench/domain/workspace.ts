// Workspace document model (T-1006-1). One document per workspace: its
// panels, layout, links, active symbol/panel/screener and a monotonic
// revision. Nine sibling epics attach their own state under `extensions`
// rather than editing this file. See
// docs/design/workspace-revisions/technical.md's "T-1006-1" section.
import type { ResourceId } from './ids';

export type Revision = number;

// T-1015-11: widened from a closed 8-member string-literal union to
// `string`. The original union hardcoded every panel kind known when this
// read model was first defined, and normalizePanel's `PANEL_KINDS.has(kind)`
// check silently dropped any panel record whose kind fell outside it -- a
// real correctness gap for any panel kind a later epic registers. The panel
// registry (panels/registry/panelKindRegistry.ts) is the actual source of
// truth for which kinds exist; this module no longer maintains its own
// closed copy of that set.
export type PanelKind = string;

export type PanelLinkChannel = 'symbol' | 'timeframe' | 'selection' | 'crosshair' | 'filters';

const PANEL_LINK_CHANNELS: ReadonlySet<string> = new Set<PanelLinkChannel>([
	'symbol',
	'timeframe',
	'selection',
	'crosshair',
	'filters'
]);

export interface PanelRecord {
	id: ResourceId;
	kind: PanelKind;
	title: string;
	collapsed: boolean;
	visible: boolean;
	boundResourceId: ResourceId | null;
	config: Record<string, unknown>;
}

export interface LayoutEntry {
	panelId: ResourceId;
	col: number;
	row: number;
	width: number;
	height: number;
}

export interface PanelLink {
	id: ResourceId;
	sourcePanelId: ResourceId;
	targetPanelId: ResourceId;
	channel: PanelLinkChannel;
}

export interface WorkspaceDocument {
	id: ResourceId;
	name: string;
	revision: Revision;
	createdAt: string;
	updatedAt: string;
	panels: PanelRecord[];
	layout: LayoutEntry[];
	links: PanelLink[];
	activeSymbol: string | null;
	activePanelId: ResourceId | null;
	screenerId: ResourceId | null;
	// Sibling-epic extension point, keyed by their own resource kind. Unknown
	// keys must survive normalization untouched — this module never inspects
	// what's inside.
	extensions: Record<string, unknown>;
}

export function emptyWorkspace(id: ResourceId, name: string, now: string): WorkspaceDocument {
	return {
		id,
		name,
		revision: 1,
		createdAt: now,
		updatedAt: now,
		panels: [],
		layout: [],
		links: [],
		activeSymbol: null,
		activePanelId: null,
		screenerId: null,
		extensions: {}
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePanel(value: unknown): PanelRecord | null {
	if (!isRecord(value)) {
		return null;
	}
	const { id, kind, title, collapsed, visible, boundResourceId, config } = value;
	if (typeof id !== 'string' || typeof kind !== 'string' || kind.length === 0) {
		return null;
	}
	return {
		id,
		kind,
		title: typeof title === 'string' ? title : '',
		collapsed: collapsed === true,
		visible: visible !== false,
		boundResourceId: typeof boundResourceId === 'string' ? boundResourceId : null,
		config: isRecord(config) ? config : {}
	};
}

function normalizeLayoutEntry(value: unknown): LayoutEntry | null {
	if (!isRecord(value)) {
		return null;
	}
	const { panelId, col, row, width, height } = value;
	if (
		typeof panelId !== 'string' ||
		typeof col !== 'number' ||
		typeof row !== 'number' ||
		typeof width !== 'number' ||
		typeof height !== 'number'
	) {
		return null;
	}
	return { panelId, col, row, width, height };
}

function normalizeLink(value: unknown): PanelLink | null {
	if (!isRecord(value)) {
		return null;
	}
	const { id, sourcePanelId, targetPanelId, channel } = value;
	if (
		typeof id !== 'string' ||
		typeof sourcePanelId !== 'string' ||
		typeof targetPanelId !== 'string' ||
		typeof channel !== 'string' ||
		!PANEL_LINK_CHANNELS.has(channel)
	) {
		return null;
	}
	return { id, sourcePanelId, targetPanelId, channel: channel as PanelLinkChannel };
}

function normalizeArray<T>(value: unknown, normalizeOne: (item: unknown) => T | null): T[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: T[] = [];
	for (const item of value) {
		const normalized = normalizeOne(item);
		if (normalized !== null) {
			out.push(normalized);
		}
	}
	return out;
}

// Never throws: malformed, partial or foreign data normalizes to a valid
// WorkspaceDocument, dropping only the individual entries that don't parse
// rather than the whole document. Mirrors src/lib/workspace/store.ts's
// normalizeWorkspace resilience pattern.
export function normalizeWorkspace(doc: unknown): WorkspaceDocument {
	const source = isRecord(doc) ? doc : {};
	return {
		id: typeof source.id === 'string' ? source.id : '',
		name: typeof source.name === 'string' ? source.name : '',
		revision: typeof source.revision === 'number' && source.revision > 0 ? source.revision : 1,
		createdAt: typeof source.createdAt === 'string' ? source.createdAt : '',
		updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
		panels: normalizeArray(source.panels, normalizePanel),
		layout: normalizeArray(source.layout, normalizeLayoutEntry),
		links: normalizeArray(source.links, normalizeLink),
		activeSymbol: typeof source.activeSymbol === 'string' ? source.activeSymbol : null,
		activePanelId: typeof source.activePanelId === 'string' ? source.activePanelId : null,
		screenerId: typeof source.screenerId === 'string' ? source.screenerId : null,
		// Untouched pass-through: a sibling epic's extension keys must
		// round-trip even when this module has no idea what's inside them.
		extensions: isRecord(source.extensions) ? source.extensions : {}
	};
}
