// Reading and writing screeners inside WorkspaceDocument.extensions
// (T-1009-1). Pure functions over the document only -- no store, no
// persistence, no mutation-envelope machinery. Wave-2 tickets route actual
// edits through EPIC-1006's RevisionService.commit; this module just defines
// where a screener lives inside the document and how to get one in or out.

import type { ResourceId } from '../workbench/domain/ids';
import type { WorkspaceDocument } from '../workbench/domain/workspace';
import { normalizeScreener, type ScreenerDefinition } from './definition';

export const SCREENER_EXTENSION_KEY = 'screener';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function screenerMap(doc: WorkspaceDocument): Record<string, unknown> {
	const raw = doc.extensions[SCREENER_EXTENSION_KEY];
	return isRecord(raw) ? raw : {};
}

// Every entry is normalized on read, so one corrupt persisted screener never
// breaks the rest of the workspace's screeners.
export function readScreeners(doc: WorkspaceDocument): ScreenerDefinition[] {
	return Object.values(screenerMap(doc)).map((entry) => normalizeScreener(entry));
}

export function readScreener(
	doc: WorkspaceDocument,
	screenerId: ResourceId
): ScreenerDefinition | null {
	const raw = screenerMap(doc)[screenerId];
	if (raw === undefined) {
		return null;
	}
	const normalized = normalizeScreener(raw);
	// A stored entry whose own ID no longer matches its map key is corrupt --
	// treat it as absent rather than returning a screener under the wrong ID.
	return normalized.screenerId === screenerId ? normalized : null;
}

// Pure: never mutates `doc`, its `extensions` object, or the screener map
// inside it -- each is shallow-cloned before the new entry is added.
export function writeScreener(
	doc: WorkspaceDocument,
	screener: ScreenerDefinition
): WorkspaceDocument {
	const normalized = normalizeScreener(screener);
	const map = { ...screenerMap(doc), [normalized.screenerId]: normalized };
	return { ...doc, extensions: { ...doc.extensions, [SCREENER_EXTENSION_KEY]: map } };
}

// Pure: a no-op copy when the ID was never present.
export function removeScreener(doc: WorkspaceDocument, screenerId: ResourceId): WorkspaceDocument {
	const map = { ...screenerMap(doc) };
	delete map[screenerId];
	return { ...doc, extensions: { ...doc.extensions, [SCREENER_EXTENSION_KEY]: map } };
}
