# Legacy Surface Cutover — Technical Design

## Contracts

### Panel-state read model (widened)

The shared workspace-read path's panel projection is built against a
closed union of panel kinds. Widening it to project every registered
kind — not just the ones known when the read model was first defined —
is what makes the "Workspace read parity" scenario true. The panel
registry itself already tracks arbitrary registered kinds; the read
model's projection is what needs to stop assuming a fixed list.

**T-1015-11's actual fix touches two places**, both in
`src/lib/workbench/domain/workspace.ts` and
`src/lib/panels/application/panelState.ts` respectively:

| Location | Was | Becomes |
|----------|-----|---------|
| `workspace.ts`'s `normalizePanel` (runs on every `WorkspaceRepository.get`/`list`/`getRevision`) | `PANEL_KINDS.has(kind)`, an 8-entry closed set | any non-empty string; `PanelKind` widens from a closed union to `string` |
| `panelState.ts`'s `projectPanels`/`projectLayout` (runs in `writePanelState`, the only writer of `doc.panels`/`doc.layout`) | a second, independently-hardcoded `PROJECTABLE_KINDS` set of the same 8 kinds | `PanelRegistry.has(kind)`, via a `PanelRegistry` parameter threaded through `writePanelState`/`projectPanels`/`projectLayout` |

Both must change together: widening only the projection lets a novel-kind
panel into `doc.panels` once, but the next `repository.get()` (a real
localStorage-backed read re-parses JSON and re-normalizes) drops it again
via the first, unwidened filter.

### Action log entry (attribution field)

| Field | Type | Description |
|-------|------|-------------|
| `actor` | `'human' \| 'agent'` | Who performed the recorded action — the field the legacy log already had and the new history model does not yet. |

### New panel kinds for the default layout

Three panel kinds are needed in a fresh workspace's seed, beyond the
current filter/results/chart set:

| Kind | Status |
|------|--------|
| `similar_opportunities` | Already registered (EPIC-1012) — reuse, don't rebuild. |
| `watchlist` | No panel kind exists yet — EPIC-1014 shipped the underlying tools, tool-only. |
| `alert_draft` | No panel kind exists yet — EPIC-1014 shipped the underlying tools, tool-only. |

## Data Flow

The shared shell is a presentation-layer component wrapping the panel
container; it reads WebMCP bridge/tool-registration state the same way
the legacy header did, and reads panel data through the widened
workspace-read model above for the action-log and panel-close
affordances.

---

*Product design: [spec.md](spec.md)*
