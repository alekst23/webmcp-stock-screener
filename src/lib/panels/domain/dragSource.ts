// The drag-and-drop wire format for T-0027-2 ("drag a result onto the
// canvas"): a dragged row carries a JSON-encoded `PanelSourceRef` -- the
// exact `{ type, ref }` shape createPanel/bindPanelSource already accept as
// `request.source` -- on a dedicated MIME type. Keeping this generic (no
// knowledge of "results row" or "instrument" here) is what lets
// PanelContainer.svelte's drop handling stay a panel-system concern: it
// only ever decides WHERE a source lands (an existing panel to rebind, or
// an empty cell to create a chart at), never WHAT the source means --
// bindPanelSource's own validateSource is still the single place that's
// decided, exactly as for every other entry point into these use cases.
//
// Domain layer: no I/O, no Svelte.
import type { PanelSourceRef } from './panel';

export const PANEL_SOURCE_DRAG_MIME = 'application/x-webmcp-panel-source';

export function serializePanelSourceDrag(source: PanelSourceRef): string {
	return JSON.stringify(source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Never throws: a malformed or foreign payload (a drag that didn't
// originate from this app, or JSON that doesn't match the shape) parses to
// null rather than crashing the drop handler.
export function parsePanelSourceDrag(raw: string): PanelSourceRef | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (
		!isRecord(parsed) ||
		typeof parsed.type !== 'string' ||
		parsed.type.length === 0 ||
		!isRecord(parsed.ref)
	) {
		return null;
	}
	return { type: parsed.type, ref: parsed.ref };
}
