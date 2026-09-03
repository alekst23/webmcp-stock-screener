# Legacy Surface Cutover — Technical Design

## Contracts

### Panel-state read model (widened)

The shared workspace-read path's panel projection is built against a
closed union of panel kinds. Widening it to project every registered
kind — not just the ones known when the read model was first defined —
is what makes the "Workspace read parity" scenario true. The panel
registry itself already tracks arbitrary registered kinds; the read
model's projection is what needs to stop assuming a fixed list.

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
