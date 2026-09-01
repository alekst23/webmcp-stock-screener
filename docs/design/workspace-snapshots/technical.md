# Workspace Snapshots — Technical Design

## Contracts

### `SnapshotSummary` (`src/lib/workspace/snapshots.ts`)

| Field | Type | Description |
|----------------|------|-------------|
| `name` | `string` | user-chosen, unique key for overwrite/delete |
| `savedAt` | `string` | ISO timestamp, for display in the picker |

### `SnapshotRecord` (`src/lib/workspace/snapshots.ts`, extends `SnapshotSummary`)

| Field | Type | Description |
|----------------|------|-------------|
| `name` | `string` | user-chosen, unique key for overwrite/delete |
| `savedAt` | `string` | ISO timestamp, for display in the picker |
| `state` | `WorkspaceState` | full captured state, same shape `store.ts` already persists |

### Functions (`src/lib/workspace/snapshots.ts`, introduced by T-0005-1)

| Function | Signature | Description |
|----------|-----------|--------------|
| `saveSnapshot` | `(name: string, state: WorkspaceState, storage?: Storage) => void` | stores/overwrites the named snapshot with `state` and a fresh `savedAt` |
| `loadSnapshot` | `(name: string, storage?: Storage) => WorkspaceState \| null` | returns the named snapshot's state (normalized via `store.ts`'s `normalizeWorkspace`), or `null` if it doesn't exist |
| `deleteSnapshot` | `(name: string, storage?: Storage) => void` | removes the named snapshot; no-op if it doesn't exist |
| `listSnapshots` | `(storage?: Storage) => SnapshotSummary[]` | every saved snapshot's `name`/`savedAt` |

### `hasUnsavedChanges` (`src/lib/workspace/snapshotGuard.ts`, introduced by T-0005-2)

| Signature | Description |
|-----------|--------------|
| `(current: WorkspaceState, baseline: WorkspaceState \| null) => boolean` | structural (JSON) comparison of the live state against the state as of the last save/load this session; `baseline: null` (nothing saved/loaded yet) is treated as `store.ts`'s `emptyWorkspace()` |

Used by `SnapshotPicker.svelte` (T-0005-2) to decide whether to warn
before replacing the live workspace with a different snapshot (spec.md's
"Recall a snapshot" → "Unsaved changes" scenario).

## Data Flow

The live workspace (`workspaceStore`, `webmcp-workspace-state` key) is
unchanged — reload behavior stays exactly as today. Snapshots are
additional named `localStorage` entries a user explicitly saves into or
loads from; the live store is never implicitly tied to a snapshot.

Key scheme: a single `localStorage` key (`webmcp-workspace-snapshots`)
holding one JSON object keyed by snapshot `name` → `SnapshotRecord`, in
the same explicit-`Storage`-parameter style as `store.ts`'s
`createWorkspaceStore` (default: real `localStorage`; tests pass an
in-memory `Storage`). `store.ts`'s `normalizeWorkspace` is exported so
`loadSnapshot` can reuse it.

---

*Product design: [spec.md](spec.md)*
