// localStorage-backed WorkspaceRepository (T-1006-4). Follows
// src/lib/workspace/store.ts's explicit-Storage-parameter and
// never-throw-on-corrupt-data pattern, and src/lib/workspace/snapshots.ts's
// precedent of a second store under its own keys so neither disturbs the
// shipping app's data.
import { normalizeWorkspace, type WorkspaceDocument } from '../domain/workspace';
import type { ResourceId } from '../domain/ids';
import type { Revision } from '../domain/workspace';
import type { SavedRevision, WorkspaceRepository, WorkspaceSummary } from '../domain/ports';

// Distinct from webmcp-workspace-state and webmcp-workspace-snapshots --
// overlapping them would break the shipping app.
const WORKSPACES_KEY = 'workbench-workspaces';
const REVISIONS_KEY = 'workbench-revisions';
const ACTIVE_KEY = 'workbench-active';

const MAX_UNNAMED_REVISIONS_PER_WORKSPACE = 100;

function readJson<T>(storage: Storage | undefined, key: string, fallback: T): T {
	const raw = storage?.getItem(key);
	if (!raw) {
		return fallback;
	}
	try {
		return JSON.parse(raw) as T;
	} catch {
		// Corrupted or foreign data in the slot must not crash the app.
		return fallback;
	}
}

function writeJson(storage: Storage | undefined, key: string, value: unknown): void {
	try {
		storage?.setItem(key, JSON.stringify(value));
	} catch {
		// A failed write (e.g. quota) leaves the previously stored value in
		// place rather than corrupting the index (T-1006-4 AC9).
	}
}

function readWorkspaces(storage: Storage | undefined): Record<string, unknown> {
	const raw = readJson<Record<string, unknown>>(storage, WORKSPACES_KEY, {});
	return typeof raw === 'object' && raw !== null ? raw : {};
}

function readRevisions(storage: Storage | undefined): Record<string, SavedRevision[]> {
	const raw = readJson<Record<string, unknown>>(storage, REVISIONS_KEY, {});
	const out: Record<string, SavedRevision[]> = {};
	for (const [workspaceId, entries] of Object.entries(raw)) {
		out[workspaceId] = Array.isArray(entries) ? normalizeRevisionList(entries) : [];
	}
	return out;
}

function normalizeRevisionList(entries: unknown[]): SavedRevision[] {
	const out: SavedRevision[] = [];
	for (const entry of entries) {
		const normalized = normalizeRevisionEntry(entry);
		if (normalized) {
			out.push(normalized);
		}
	}
	return out.sort((a, b) => a.revision - b.revision);
}

function normalizeRevisionEntry(entry: unknown): SavedRevision | null {
	if (typeof entry !== 'object' || entry === null) {
		return null;
	}
	const e = entry as Record<string, unknown>;
	if (typeof e.workspaceId !== 'string' || typeof e.revision !== 'number') {
		return null;
	}
	return {
		workspaceId: e.workspaceId,
		revision: e.revision,
		name: typeof e.name === 'string' ? e.name : null,
		savedAt: typeof e.savedAt === 'string' ? e.savedAt : '',
		document: normalizeWorkspace(e.document)
	};
}

// Keeps every named snapshot plus the MAX_UNNAMED_REVISIONS_PER_WORKSPACE
// most recent unnamed ones (T-1006-4 AC8) -- a named save is never pruned.
function pruneRevisions(entries: SavedRevision[]): SavedRevision[] {
	const named = entries.filter((e) => e.name !== null);
	const unnamed = entries
		.filter((e) => e.name === null)
		.sort((a, b) => b.revision - a.revision)
		.slice(0, MAX_UNNAMED_REVISIONS_PER_WORKSPACE);
	return [...named, ...unnamed].sort((a, b) => a.revision - b.revision);
}

export function createLocalWorkspaceRepository(storage?: Storage): WorkspaceRepository {
	const backing = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);

	return {
		list(): WorkspaceSummary[] {
			return Object.values(readWorkspaces(backing)).map((raw) => {
				const doc = normalizeWorkspace(raw);
				return { id: doc.id, name: doc.name, revision: doc.revision, updatedAt: doc.updatedAt };
			});
		},

		get(id: ResourceId): WorkspaceDocument | null {
			const raw = readWorkspaces(backing)[id];
			return raw === undefined ? null : normalizeWorkspace(raw);
		},

		put(doc: WorkspaceDocument): void {
			const workspaces = readWorkspaces(backing);
			workspaces[doc.id] = doc;
			writeJson(backing, WORKSPACES_KEY, workspaces);
		},

		getActiveId(): ResourceId | null {
			return backing?.getItem(ACTIVE_KEY) ?? null;
		},

		setActiveId(id: ResourceId): void {
			try {
				backing?.setItem(ACTIVE_KEY, id);
			} catch {
				// Same fail-gracefully contract as writeJson.
			}
		},

		listRevisions(id: ResourceId): SavedRevision[] {
			return readRevisions(backing)[id] ?? [];
		},

		getRevision(id: ResourceId, revision: Revision): WorkspaceDocument | null {
			const entry = (readRevisions(backing)[id] ?? []).find((e) => e.revision === revision);
			return entry ? entry.document : null;
		},

		putRevision(entry: SavedRevision): void {
			const revisions = readRevisions(backing);
			const existing = (revisions[entry.workspaceId] ?? []).filter(
				(e) => e.revision !== entry.revision
			);
			revisions[entry.workspaceId] = pruneRevisions([...existing, entry]);
			writeJson(backing, REVISIONS_KEY, revisions);
		}
	};
}
