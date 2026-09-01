# Safety Layer (Preview & Apply) — Technical Design

Companion to `spec.md`. Covers the one structural decision the epic turns
on, the surface it consumes from EPIC-1006, and the layering rules.

## The central decision: one evaluation path

The honesty guarantee ("what preview reports is what apply produces") is
easy to state and easy to violate. Any design where preview computes a
predicted diff by one code path and apply mutates by another will drift —
not immediately, but the first time an operation's handler grows a
condition the predictor does not model.

So preview and apply share a single evaluation path:

1. Take the current workspace state as an **immutable value** and its
   revision `N`.
2. Fold the batch's operations over that value using EPIC-1006's
   registered handlers, in order, producing a candidate next state.
   Handlers are pure — no I/O, no in-place mutation — so folding produces
   a new value and leaves the live workspace alone.
3. Diff `before` against `candidate` to produce the structured diff,
   `affected_ids`, and `diff_summary`.
4. **Preview** returns that result and stores `{preview_id, base revision
   N, candidate state, diff, warnings, failures}`.
5. **Apply** re-checks that the live revision is still `N`, then commits
   the *already-computed* candidate state as revision `N+1`.

Because apply commits the state preview computed rather than recomputing
it, honesty is structural, not a promise. It also makes atomicity nearly
free: the commit is a single swap of the workspace's state value and
revision, so there is no window in which half a batch is visible. If the
swap's precondition fails, nothing happened.

The consequence is that **preview must not be skippable** — apply has no
way to produce a candidate state on its own. That is exactly the gate the
epic wants, and it is why `apply_previewed_changes` takes a preview ID.

### Why not auto-rebase a stale preview

A stale preview could, in principle, be re-folded against the new revision
and applied. It is deliberately not, because the diff a human or agent
approved was computed against a state that no longer exists; re-folding
can produce a different diff than the one that was approved, which is the
honesty guarantee failing quietly. Rejecting costs one extra round trip
and preserves the property.

## Surface consumed from EPIC-1006

This epic implements none of the following and must adapt to EPIC-1006's
actual shape rather than fork it. Names below are illustrative of the
*capability* needed, not a demand for those exact identifiers.

| Capability | Why this epic needs it |
|-----------|------------------------|
| Register an operation kind with a validator + handler | The batch is typed and open-ended; kinds arrive from four other epics |
| Look up a handler by kind; enumerate registered kinds | Validation of unknown kinds; tool schema/description generation |
| Handler signature: `(state, op) -> {state, affectedIds, warnings}`, pure | The fold in step 2; without purity, preview mutates |
| Current workspace state as an immutable value + its revision | Steps 1 and 5 |
| Compare-and-swap commit conditioned on `expected_revision` | Atomicity and freshness in one primitive |
| `idempotency_key` store | Idempotent apply retries |
| Undo-token issuance keyed to a change | One token per applied batch |
| The common mutation envelope type | Apply's return value |

If EPIC-1006's handlers turn out **not** to be pure (e.g. they mutate a
store directly), this epic's evaluation must fold over a structurally
cloned state rather than the live one — but that is a fallback, and the
purity requirement should be raised with EPIC-1006 first, since the
non-pure variant makes honesty depend on clone completeness.

## Layering

Dependencies point inward; nothing in the domain layer imports from infra
or from the WebMCP tool layer.

| Concern | Layer | Notes |
|---------|-------|-------|
| Batch, operation reference, preview result, diff, failure/warning types | domain | pure data; no I/O |
| Fold/evaluation over registry handlers | domain | pure function of `(state, batch, registry lookup)` |
| Diff computation and summary rendering | domain | pure function of `(before, after, per-op metadata)` |
| Preview store (IDs, TTL, eviction, clock) | infra | clock and ID generator injected, so tests are deterministic |
| Apply use case (revision check, commit, idempotency, undo) | application | orchestration only; ≤50 lines |
| Tool schemas + registration | webmcp | mirrors `src/lib/webmcp/register.ts`'s ownership pattern |

New files only. Nothing under `src/lib/workspace/` or the existing
`src/lib/webmcp/tools.ts` surface is modified — EPIC-1015 retires those.

## Diff shape

The diff serves two audiences and therefore has two forms in one payload:

- **Structured** — an ordered list of typed changes (added / removed /
  updated, each with the stable ID of the entity and, for updates, the
  changed fields with before and after values). Machine-checkable; this is
  what the honesty tests compare.
- **Summary** — a short human-readable sentence, matching the spec's
  example (`"Added RSI study and RSI 40–70 filter"`). Derived from the
  structured diff plus any summary fragments handlers contribute, so it
  can never disagree with it.

`affected_ids` is the deduplicated set of stable IDs appearing in the
structured diff, preserving first-appearance order for stable output.

## Testing notes

- **Honesty** is a property, not an example: test it by previewing a batch,
  applying it, and asserting the applied envelope's `affected_ids` and
  `diff_summary` equal the preview's, across several batch shapes
  including no-op and multi-entity batches.
- **Non-mutation** is asserted by deep-comparing a snapshot of the
  workspace state and revision taken before and after every preview,
  including previews that fail validation.
- **Extensibility (epic AC8)** is proved by registering a novel operation
  kind inside the test — one the safety layer's source never mentions —
  and driving it through preview and apply. A test that only exercises
  operations existing at write time would pass against a hardcoded switch
  and is therefore not evidence.
- **Atomicity** needs a handler that fails at commit time, not only at
  validation time, to exercise the rollback path rather than the
  reject-early path.
- Fakes must be keyed by identity, not by name, so a duplicate-write
  defect cannot hide behind a coincidentally-equal key.
