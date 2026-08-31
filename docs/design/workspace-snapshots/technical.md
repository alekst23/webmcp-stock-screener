# Workspace Snapshots — Technical Design

## Contracts

### Snapshot record (new)

| Field | Type | Description |
|----------------|------|-------------|
| `name` | `string` | user-chosen, unique key for overwrite/delete |
| `savedAt` | `string` | ISO timestamp, for display in the picker |
| `state` | `WorkspaceState` | full captured state, same shape `store.ts` already persists |

## Data Flow

The live workspace (`workspaceStore`, `webmcp-workspace-state` key) is
unchanged — reload behavior stays exactly as today. Snapshots are
additional named `localStorage` entries a user explicitly saves into or
loads from; the live store is never implicitly tied to a snapshot. Exact
key scheme (per-snapshot keys vs. a single index) left to ticket design.

---

*Product design: [spec.md](spec.md)*
