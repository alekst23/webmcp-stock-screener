# T-0020-15: Post-review fixes for tickets 10-14 (human-run wiring)

**Epic:** EPIC-0020
**Status:** Done

## Goal

EPIC-0020's tickets-10-14 wave (create-if-absent/recycle results panel,
human-triggered Run control) shipped and merged, but an epic review of that
wave (2026-09-04, independent review agents reading the actual code) found
five issues in `panelController.ts`, `FilterBuilderPanel.svelte`, and
`runScreener.ts`. Two are blocking (a dead concurrency guard and a silently
dropped failure outcome); the other three are layering/size/robustness
nits the user asked to fix in the same pass rather than defer.

## Findings and resolutions

### 1 (BLOCKING). Single-flight guard was dead in production

`runScreenerByHuman`'s `humanRunsInFlight` cache was a
`WeakMap<RunScreenerByHumanDeps, ...>` keyed on the caller's deps object
identity. The only production caller, `FilterBuilderPanel.svelte`'s
`handleRun()`, constructs a brand-new object literal on every call, so no
two activations ever shared a key — the guard could never fire from the
real UI. It was masked because Svelte's synchronous `running` `$state`
boolean already blocks a second click before the promise settles.

**Resolution: Option A** (of the two options the review offered) — changed
the single-flight key from the deps object to `deps.useCaseDeps.workspaceId`
(a string), and switched `humanRunsInFlight` from a `WeakMap` to a `Map`
(strings can't be weakly referenced; `.finally()` still deletes the entry
as soon as the run settles, so nothing leaks). Chosen over Option B
(hoisting a stable deps reference in the Svelte component) because
concurrency is semantically a per-workspace property, not a per-call-site
one — a keyboard shortcut, a retry, or any future caller without a stable
object reference now gets the same real protection, without this module
reaching into any component's local state.

`runScreenerByHuman.test.ts`'s in-flight test used to call
`runScreenerByHuman(deps)` twice against the *same* `deps` const — which
would have passed even under the old, dead guard, so it never proved
anything about the real call pattern. Rewritten to construct two
independent `RunScreenerByHumanDeps` object literals (mirroring
`handleRun()`'s actual construction), and the file's header comment now
explains why.

### 2 (BLOCKING). Human-run failures were silently dropped

`FilterBuilderPanel.svelte`'s `handleRun()` discarded
`runScreenerByHuman`'s return value entirely. A refused screener, an
evaluation-port error, or (defensively) a `no_screener` result left the
button reverting from "Running…" to "Run" with zero explanation.

**Resolution:** Added `runOutcomeMessage()`
(`src/lib/screener/panel/runOutcomeMessage.ts`) — a pure function mapping
`RunScreenerByHumanResult` to a human-readable message or `null` (`null`
only for a completed run). `FilterBuilderPanel.svelte` now stores the
result in a local `runMessage` `$state`, cleared at the start of every new
run, and renders it as an inline `<p class="run-message">` styled like
`ResultsTablePanel.svelte`'s existing `.error` banner (checked
`panels/shell/` and `results/panel/` first — no toast system, and that
`.error` banner is the established inline-message precedent in this panel
system, so this reuses it rather than inventing a new pattern).

### 3 (non-blocking, fixed now). Layering violation

`panels/shell/panelController.ts` imported `bindRunToResultsPanel` from
`webmcp/screener/runScreener.ts` — a tool-layer module — even though the
function takes only typed panel/workspace arguments and has zero JSON/wire
concerns.

**Resolution:** Moved `bindRunToResultsPanel` and its `PanelBindingDeps`
type into `src/lib/panels/application/bindRunToResultsPanel.ts`, exported
from `panels/application/index.ts` alongside `createPanel`/`bindPanelSource`.
Both `runScreener.ts` (the agent tool-call path, still always `actor:
'agent'`) and `panelController.ts` (`runScreenerByHuman`, `actor: 'human'`)
now import it from that one place symmetrically. Updated
`runScreener.ts`'s own module-header comment, and the three other importers
of `PanelBindingDeps` (`webmcp/screener/group.ts`,
`webmcp/screener/runScreener.test.ts`,
`workbench/composition/workbenchCompositionRoot.ts`) to import it from
`panels/application` instead.

### 4 (non-blocking, fixed now). Function size

`bindRunToResultsPanel` (~46 lines) and `executeHumanRun` in
`panelController.ts` (~49 lines) modestly exceeded this project's 30-40
line guidance.

**Resolution:**

- `bindRunToResultsPanel`'s create-branch (find-or-create the results
  panel) is now `findOrCreateResultsPanelId()`, a small helper in the same
  file. `bindRunToResultsPanel` itself is now ~26 lines of code (33
  including signature/braces).
- `executeHumanRun` is now split into `resolveCurrentScreenerDefinition()`
  (the doc/screener read) and `pinAndBindCompletedRun()` (the
  `runStore.putRun` + best-effort bind for a `'complete'` outcome).
  `executeHumanRun` itself is now ~13 lines of code (20 including signature/
  braces).

No behavior change in either case — pure extraction, same control flow.

### 5 (nit, fixed). Disabled/tooltip could theoretically drift

The Run button's `disabled` condition included `!deps.run` but the `title`
tooltip was bound only to `disabledReason`, so a (today unreachable) state
where `deps.run` is unset while a screener is defined would disable the
button with no tooltip explaining why.

**Resolution:** Folded `!deps.run` into `disabledReason`'s own derivation
(`'The run control is not available yet.'`) so `disabled` and `title` can
never disagree. The button's `disabled` attribute now reads only
`disabledReason !== null`.

## Testing

- Added `runOutcomeMessage.test.ts` (4 cases: complete/null, refused,
  error, no_screener).
- Added a `FilterBuilderPanel.test.ts` case that mounts the real component
  with a `run` deps override, clicks the real `.run-button` element, and
  asserts the refusal message renders inline — proving the DOM-to-message
  wiring, not just the pure function.
- Rewrote `runScreenerByHuman.test.ts`'s in-flight test to construct two
  independent deps object literals (see Finding 1).
- Full frontend suite green after all changes:
  `npx vitest run src/lib/panels src/lib/screener src/lib/webmcp/screener` —
  83 files / 836 tests passed, 1 todo. `npm test` (full suite) — 265 files /
  3125 tests passed, 1 todo, 0 failures.
- `npm run typecheck` — 785 files, 0 errors, 0 warnings.

## Files touched

- `src/lib/panels/shell/panelController.ts` — single-flight key, extracted
  helpers, import from the new `bindRunToResultsPanel` location.
- `src/lib/panels/application/bindRunToResultsPanel.ts` — new file (moved
  from `webmcp/screener/runScreener.ts`), with `findOrCreateResultsPanelId`
  extracted.
- `src/lib/panels/application/index.ts` — barrel export for
  `bindRunToResultsPanel`/`PanelBindingDeps`/`BindRunToResultsPanelDeps`.
- `src/lib/webmcp/screener/runScreener.ts` — removed the relocated
  definitions, updated header comment, imports from `panels/application`.
- `src/lib/webmcp/screener/group.ts`,
  `src/lib/webmcp/screener/runScreener.test.ts`,
  `src/lib/workbench/composition/workbenchCompositionRoot.ts` — updated
  `PanelBindingDeps` import location.
- `src/lib/screener/panel/FilterBuilderPanel.svelte` — surfaces
  `runMessage`, folds `!deps.run` into `disabledReason`.
- `src/lib/screener/panel/runOutcomeMessage.ts` — new pure helper.
- `src/lib/screener/panel/runOutcomeMessage.test.ts` — new test file.
- `src/lib/screener/panel/FilterBuilderPanel.test.ts` — new click-through
  test for the refusal message.
- `src/lib/panels/shell/runScreenerByHuman.test.ts` — rewrote the in-flight
  test to use realistic per-call deps objects; updated header comment.
