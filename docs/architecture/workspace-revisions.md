# Workspace, Revisions & the Common Tool Contract

The new WebMCP surface (`docs/reference/tool-spec.md`, ~33 tools) requires
every mutating tool to obey one contract: stable resource IDs, optimistic
concurrency via `expected_revision`, idempotent retries via
`idempotency_key`, a fixed mutation-result envelope, and explicit provenance
on market-data results. This doc describes that contract as shared
infrastructure, for engineers implementing sibling epics against it. It does
not cover any specific tool group (panels, screeners, charts, etc.) — those
live in their own docs as they land.

## Layering

The contract lives under `src/lib/workbench/`, split by the project's usual
domain/application/infra shape:

| Layer | Owns |
|-------|------|
| `domain/` | Stable-ID scheme, mutation draft/envelope shapes, typed errors, market-data provenance shape, the `WorkspaceRepository`/`Clock`/`ProvenanceSource` ports |
| `application/` | The revision service (the single write path), idempotency replay cache, change history/undo, the operation registry |
| `infra/` | A `localStorage`-backed `WorkspaceRepository` implementation |
| `tools/` | The seven Context/Workspace/Persistence WebMCP tools, and the composition root that wires everything together |

`domain/` depends on nothing else in this tree; `application/` and `infra/`
depend only on `domain/`; `tools/` is the only layer that sees all three.

## The mutation envelope

Every mutating tool call returns the same envelope shape: a change ID, the
new revision, the IDs a change affected, a human-readable diff summary, a
warnings list, and an undo token (or `null` if the change isn't undoable).
Internally the envelope is camelCase; the agent-facing wire format is
snake_case via a single serializer — nothing else in the tree emits
snake_case. (One known gap: three read-only tools currently bypass that
serializer — see Known gaps below.)

## The single write path

`RevisionService.commit` is the only place a revision is incremented.
Given a workspace ID, a mutation context (actor, optional
`expected_revision`, optional `idempotency_key`), and a function that
produces the next document plus its inverse, it:

1. Replays a repeated `idempotency_key` by returning the original envelope
   unchanged, before touching storage — a genuine retry must look identical
   regardless of how far the revision has moved since.
2. Rejects a mismatched `expected_revision` without any state change,
   reporting the actual current revision. Omitting `expected_revision`
   applies the change but adds a warning, so careless callers are visible
   rather than blocked.
3. Stamps the next revision and timestamp, writes it, and records a change
   history entry.
4. Mints an undo token when the caller supplied an inverse.

A batch of operations applied together (via the operation registry, below)
folds entirely in memory before this path ever writes — a validation
failure partway through a batch produces no partial write.

One tool, `save_workspace`, deliberately does not go through this path: it
attaches a name to the *current* revision rather than opening a second
numbering scheme, so it has no new revision to stamp. It still replays
`idempotency_key` (against the same cache `RevisionService` uses) and still
appends to change history directly, so it behaves like every other
enveloped tool from a caller's perspective despite the different internal
path.

## Change history, undo, and restore

Every commit appends a record: change ID, revision, actor, diff summary,
affected IDs, and — if the change was undoable — an undo token. Only the
*newest* record for a workspace is redeemable; appending a new record marks
the previous newest as superseded, which is also what lets history stay
bounded (older, non-redeemable records are pruned once a workspace exceeds
its per-workspace cap). Undo and restore-to-an-earlier-revision both go
back through the same commit path, so reversing a change is itself a
recorded, undoable change — history only ever grows forward, never rewrites.

## The operation registry

Sibling epics register their own mutating operations (an operation kind, a
validator, and an apply function) against a single registry rather than each
building their own commit plumbing. The registry supports preview (validate
and compute a diff without writing) and apply (commit for real), and
multiple registered operations can be applied together as one atomic batch —
one revision, one change ID, one undo token, or nothing writes at all.

## Market-data provenance

Any result carrying market data can attach a provenance record: as-of time,
source, live/delayed status, timezone, currency, price-adjustment basis,
fundamentals reporting period, and calculation-engine version. This epic
defines the contract and a port; it does not supply a real market-data
provider — that is a separate workstream, and the current provenance source
is a fixed placeholder value until one lands.

## Coexistence with the shipping surface

This tree is entirely new files alongside the shipping 11-tool
pattern-research surface (`src/lib/webmcp/tools.ts`,
`src/lib/workspace/store.ts`), which it does not modify. The seven tools
built here are registered behind a feature flag that defaults off and isn't
called from app startup yet — flipping it is the activation step a later
cutover epic owns, once sibling epics have registered their own operations
against this epic's registry.

## Known gaps

- Three read-only tools (`get_app_context`, `get_canvas_state`,
  `get_change_history`) return camelCase rather than the contract's
  snake_case wire format — a documented follow-up, not yet fixed.
- Revision checks are not atomic across two browser tabs sharing the same
  `localStorage` — a documented, not-yet-mitigated gap.

## References

- `docs/design/workspace-revisions/spec.md` — behavioral spec.
- `docs/design/workspace-revisions/technical.md` — full exported contract
  surface (types, function signatures) for sibling epics to import.
- `docs/reference/tool-spec.md` — the program's source of truth for the
  common contract and the seven tools this epic delivers.
