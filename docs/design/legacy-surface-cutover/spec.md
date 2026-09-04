# Legacy Surface Cutover — Product Spec

## Intent

The project is replacing its original 11-tool pattern-research workbench
with a ~33-tool WebMCP screener and research surface. The new surface is
built in new files alongside the old one, so `main` stays deployable
throughout; the cost of that choice is that when the new surface is
ready, the codebase carries two overlapping products at once. This
feature is the retirement: a single, audited cutover that removes the
legacy surface, moves the app onto the new one, and proves nothing was
lost.

Done looks like: one tool surface in the codebase and on the wire, no
legacy product-surface files, documentation that describes what actually
ships, and a live deployment verified working on the new surface.

The user-visible product of this feature is not a feature at all — it is
the absence of a second one. Its correctness is judged by what still
works afterwards.

## Preconditions

- The new WebMCP surface (EPIC-1006 through EPIC-1014) is merged and
  working.
- The user has explicitly confirmed the new surface is good. This
  feature is gated on that approval and must not begin without it.
- The legacy surface is currently the deployed hackathon submission,
  running a FastAPI backend and a static frontend build on two hosting
  platforms.

## Features

1. **Retirement inventory**: a file-level classification of every legacy
   artifact as retired, kept, or absorbed, each with a reason.
2. **Capability-parity check**: every legacy capability mapped to a
   new-surface equivalent, a stated partial match, or a deliberate drop
   — before anything is deleted.
3. **Route migration**: the app converges onto one URL running the new
   panel/workspace model, wrapped in a newly-built shared shell — header,
   product identity, and WebMCP status — following the app's existing
   dark, dense visual language rather than reusing the legacy header
   component outright. The interim second route is removed. The shell
   also restores two small affordances the legacy page had: a
   human-clickable close button on each panel, and a compact header icon
   that expands into the human/agent-attributed action log. A brand-new
   workspace is seeded with the full intended composition — not just
   filter/results/chart, but also watchlist, alert-draft, and
   similar-setups panels — so a fresh workspace looks like the target
   design rather than a placeholder subset.
4. **Tool-surface removal**: the 11 legacy tools, their registrations,
   their contracts, and their tests are deleted.
5. **Workspace-model removal**: the legacy store, engine client, and
   components are deleted, with absorbed logic already landed elsewhere.
6. **Backend reconciliation**: backend modules that serve no surface are
   deleted; those that serve the new surface stay.
7. **Documentation cutover**: the readme, tool reference, design docs,
   and deployment reference describe the shipped surface.
8. **Deployment verification**: the live deployment is confirmed working
   on the new surface, with a stated rollback path.

## Behavioral Specifications

### Retirement inventory

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | the legacy and new surfaces both present in the tree | the inventory is produced | every legacy file appears once, classified retire/keep/absorb with a reason, and every named path is verified to exist |
| Infrastructure inside a legacy directory | a transport module sitting alongside product-surface modules | it is classified | it is marked keep, with the reason naming it as transport rather than product |
| Absorb with no destination | logic marked absorb but nothing in the new surface needs it | the classification is reviewed | it is downgraded to retire rather than left as an open move |

### Capability-parity check

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Exact match | a legacy capability with a named new-surface tool that implements it | parity is checked against merged code | it is recorded as an exact match and cleared for deletion |
| Partial match | a legacy capability whose new-surface equivalent covers less | parity is checked | it is recorded as partial, with the reduction stated, and listed for user sign-off |
| Deliberate drop | a legacy capability with no new-surface equivalent | parity is checked | it is recorded as a drop and surfaced to the user for sign-off; it is not deleted silently |
| Doc-only tool | a tool named in a design doc but never implemented | it is offered as the equivalent | it counts as a drop, not a match |
| No-go | one or more drops the user will not accept | the verdict is formed | the verdict is no-go, stating what must change, and no deletion proceeds |

### Route migration

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | routes rendering the legacy workspace model | migration completes | every route renders the new panel/workspace model and reads no legacy state |
| One URL, one surface | the app after migration | any route is visited | the canonical app URL renders the new panel/workspace model; the interim second route no longer exists as a separate surface |
| Shared shell | the migrated app | it loads | a header shows product identity, data-freshness, and WebMCP status (defined/available tool counts, bridge state) — the same information the legacy header showed, in a newly-built component matching the app's existing visual language |
| Status header | the WebMCP status header on the migrated page | an agent connects | it reports defined tool count, available tool count, and bridge state for the new surface |
| Surviving capability | a capability the parity check marked as surviving and UI-observable | the migrated app is used | that capability is reachable from the UI |
| Panel close | a panel a human wants to remove | they use its close affordance | the panel is removed from the layout, the same effect as the agent-side remove-panel action |
| Action log access | a workspace with recorded history | a human expands the header's log icon | every recorded action is visible, each attributed to human or agent |
| Workspace read parity | an agent calls the shared workspace-read tool | any panel kind is present in the workspace, including ones introduced after the read model was first defined | the panel appears in the result — the read path is not silently blind to any panel kind |
| Rich default layout | a brand-new workspace | it is created | ~~the default layout includes filter, results, and chart panels plus watchlist, alert-draft, and similar-setups panels, matching the intended full composition~~ — **superseded by `hotfix/empty-grid-canvas` (2026-09-03).** See `docs/design/panel-system/spec.md`'s "Seed a new workspace with the default layout" (amended): the default is now deliberately minimal — one `filter_builder` panel, full-height on the left column — not the six-panel composition this row originally specified. `docs/plan/EPIC-1015/T-1015-12-rich-default-layout.md` delivered the row as originally written; that delivery is now stale against the current default-layout behavior. |
| Throwaway scaffolding | the spike route left over from the platform spike | migration completes | it is removed and nothing links to it |
| Manual tool harness | the legacy manual tool-testing route | migration completes | it is removed along with the legacy tool surface it exercised |

### Tool-surface removal

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | the 11 legacy tools registered against the bridge | removal completes | none of them is registered or present in the codebase |
| Shared module | product types and transport types sharing one module | the product types are removed | the transport types survive and remain importable |
| Transport preserved | the bridge, registration, session, and status modules | the legacy tools are removed | they still serve the new surface and their tests pass unweakened |
| Legacy-only test | a test that existed only to cover a retired tool | removal completes | the test is deleted, not skipped |

### Workspace-model removal

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | the legacy store, engine client, and components | removal completes | all are deleted and nothing imports them |
| Absorbed logic | pure logic marked absorb in the inventory | its legacy source file is deleted | the logic already exists in the new surface, verified by test or browser check, with equivalent coverage |
| Returning user | a browser holding legacy state under the old storage keys | the app is opened after cutover | it loads and works; stale state is migrated, cleaned up, or deliberately abandoned with the decision recorded |

### Backend reconciliation

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Dead module | a backend module serving no surface | reconciliation completes | it and its tests and route registration are deleted |
| Surviving module | a backend module serving the new surface | reconciliation completes | it remains and its tests pass |
| Health check on retired endpoint | the platform health check pointing at a retiring endpoint | that endpoint is retired | the health check is repointed at an endpoint that exists and reports genuine service health, in the same change |
| Layering | the layered backend architecture | modules are deleted or moved | the domain layer still imports nothing from infrastructure |

### Documentation cutover

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | docs describing the retired surface | the cutover completes | every doc describes the shipped surface, and every path, route, endpoint, and command named in them exists |
| Superseded spec | a behavioral spec for retired behavior | docs are updated | it is removed or clearly marked superseded, and the design index has no dangling entry |
| Recorded drop | a capability drop accepted during the parity check | docs are updated | the drop is documented where a reader would look for the capability, not only inside the plan folder |

### Deployment verification

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | the cutover merged and deployed | verification runs against the live deployment | health check passes, the frontend loads without console errors, and a representative new-surface flow succeeds end to end from the browser |
| CORS | the deployed frontend calling the deployed backend | a real browser makes the call with its own origin | the call succeeds |
| Agent reachability | a WebMCP-capable browser on the deployed app | an agent connects | the bridge connects, the header reports connected, and the registered tools are the new surface's |
| Legacy reachability | the live deployment after cutover | legacy routes and endpoints are probed | none is reachable |
| Rollback | the cutover found to be broken in production | rollback is invoked | the stated rollback path restores the previous working deployment |

## Non-Goals

- Building any part of the new surface — that belongs to EPIC-1006
  through EPIC-1014. This feature only removes and re-points.
- Adding capabilities neither surface has, with the specific confirmed
  exceptions listed as Features above (shared shell, panel close, action
  log, rich default layout) — those are wiring/UI work exposing tools and
  contracts that already exist, not new product capability.
- Multi-step temporal setup matching with inter-step windows, arbitrary
  outcome-measurement/splitting (the legacy `measure`/`splitInstances`
  shape), progressive tool availability, and instance sampling by
  strategy — all confirmed drops with no new-surface equivalent. Not
  built as part of this cutover.
- A full attribution/audit data model beyond what the action log needs —
  this feature adds actor attribution (human vs. agent) to log entries,
  not a general-purpose audit system.
- A dual-surface coexistence mode, a deprecation period, or feature-
  flagged gradual migration. The standing decision is one cutover at
  the end, gated on user approval.
- Preserving retired code or retired behavior "for reference", in source
  or in prose. Retirement means deletion; version history holds the rest.
- Migrating users' stored legacy workspaces and snapshots into the new
  revision model. If a migration path is needed it belongs to the epic
  that owns persistence; this feature only ensures a returning user is
  not left with a broken app.
- Re-platforming, new deployment targets, or performance work.

## Open Questions

All five original open questions are resolved, against the epic's own
retirement inventory (T-1015-1) and capability-parity check (T-1015-2),
confirmed with the user on 2026-09-03:

1. **Multi-step temporal setup matching does not survive.** Confirmed
   structural gap — the new filter tree's temporal condition is
   single-predicate only, with no inter-step window chaining anywhere in
   the new surface. Accepted as a deliberate drop.
2. **Outcome measurement and instance splitting do not survive.**
   Confirmed — the backtest tools compute a differently-shaped
   walk-forward result, not a metric-vs-base-rate comparison or a
   winner/loser split. Accepted as a deliberate drop.
3. **Named snapshots do not survive as such.** Confirmed — workspace
   revisions (with undo/restore/change-history) supersede them; the
   snapshot module is absorbed, not kept in parallel.
4. **Progressive tool availability does not survive.** Confirmed — every
   tool group in the new surface registers statically; no live
   registration path implements the workflow-gated toolchange
   demonstration. Accepted as a deliberate drop.
5. **Sibling-epic ownership is resolved.** EPIC-1006 through EPIC-1014
   are all merged; the inventory and parity check were built against
   merged code, not plan docs.

Two further items the parity check surfaced beyond the original five,
also resolved:

6. **Instance sampling by strategy does not survive.** No equivalent
   exists, wired or not. `get_screener_results`' bounded, paginated page
   is the closest available primitive. Accepted as a deliberate drop.
7. **The manual tool-testing route is retired, not migrated.** Low
   impact; it existed to exercise the legacy tool surface specifically.
