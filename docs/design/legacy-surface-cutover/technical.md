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

### WebMCP status wrapper for the new surface (T-1015-9)

`webmcp/session.ts`'s `startBridgeSession` and `webmcp/register.ts`'s
`connectWebmcp` are legacy-`ResearchEngine`-specific (they internally call
`buildTools(engine)`, the 11-tool builder) and are not reusable for the new
surface's tool groups, each of which registers directly against
`ensureModelContext()` with no connection-state tracking today. T-1015-9
adds a small new wrapper — not a shared domain contract, a local type in
the shell's own module — with this shape:

| Field | Type | Description |
|-------|------|-------------|
| `state` | `WebmcpBridgeState` (kept, from `webmcp/status.ts`) | `'connecting'` before the composition-root registration call resolves, `'connected'` after, `'failed'` if it throws. |
| `toolCount` | `number` | Total `ToolSpec` count across every tool group the composition registers. Reused for both `formatDefinedStatus` and `formatAvailableStatus` — progressive availability is a confirmed drop, so the two numbers are always equal on the new surface. |

`webmcp/bridge.ts` (`ensureModelContext`, `onBridgeReplaced`) and
`webmcp/status.ts` (`WebmcpBridgeState` and the format functions) are
reused as-is — they are generic and already kept per the epic's AC6.

### Action log entry (attribution field)

**Correction (T-1015-10 design pass):** this field already exists, and did
not need adding. `workbench/domain/mutation.ts`'s `Actor = 'human' |
'agent'` and `workbench/application/changeHistory.ts`'s `ChangeRecord.actor:
Actor` are already populated by every `recordCommit` call site, including
existing human-triggered ones (`ResultsTablePanel.svelte`,
`confirmAlertActivation`/`declineAlertActivation`), and `get_change_history`
already serializes it. What T-1015-10 actually adds is the **UI**: a
compact shell icon (hosted in T-1015-9's shell) that expands into a log
view built from `ChangeHistory.list()`, plus a human-clickable panel-close
control that becomes the log's one new `actor: 'human'` call site.

| Field | Type | Description |
|-------|------|-------------|
| `actor` | `'human' \| 'agent'` | Who performed the recorded action. Already present on `ChangeRecord` and already returned by `get_change_history`. |

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
container; it reads WebMCP status via the new wrapper above (the
underlying formatters and `WebmcpBridgeState` type are the same ones the
legacy header used, but the connection wrapper itself is new — see
"WebMCP status wrapper" above), and reads panel/action-log data directly
from the panel/workbench application layer (`ChangeHistory.list`,
`readPanelState`) for the action-log and panel-close affordances, the
same direct-use-case-call convention `panelController.ts` already
establishes for human-triggered UI actions.

---

*Product design: [spec.md](spec.md)*
