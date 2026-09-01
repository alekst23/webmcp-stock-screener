# Workspace, Revisions & the Common Tool Contract — Technical Design

**Epic**: EPIC-1006
**Spec**: `docs/design/workspace-revisions/spec.md`

This document is the **contract surface nine sibling epics import**. The
signatures below are the design intent, not shipped code — implementation
tickets own the code. Where a sibling epic needs a shape from here, it
should import it rather than redeclare it.

## Module layout

The new surface lives under `src/lib/workbench/`, alongside — never
replacing — `src/lib/webmcp/` and `src/lib/workspace/`. Dependencies point
inward: `tools → application → infra → domain`. Domain imports nothing but
domain.

```
src/lib/workbench/
  domain/
    ids.ts                  stable-ID scheme (T-1006-1)
    workspace.ts            workspace document model (T-1006-1)
    mutation.ts             mutation envelope + builder (T-1006-2)
    provenance.ts           market-data provenance (T-1006-3)
    errors.ts               typed conflict/validation errors (T-1006-2)
    ports.ts                repository + clock + provenance ports
  infra/
    workspaceRepository.ts  localStorage-backed store (T-1006-4)
  application/
    revisionService.ts      expected_revision + idempotency (T-1006-5)
    idempotency.ts          replay cache (T-1006-5)
    changeHistory.ts        history, undo tokens, restore (T-1006-6)
    operationRegistry.ts    typed operation registry (T-1006-7)
  tools/
    index.ts                buildWorkbenchTools(deps): ToolSpec[] (T-1006-8)
```

Tests sit beside their modules as `*.test.ts` (Vitest), per project
convention.

## Casing: internal vs. wire

Internal TypeScript is camelCase, per project convention. The agent-facing
JSON is snake_case, per `docs/reference/tool-spec.md`. One serializer bridges
them; nothing else in the codebase writes snake_case.

- Tool `inputSchema` property names are snake_case: `expected_revision`,
  `idempotency_key`, `workspace_id`, `undo_token`.
- Tool results are produced by `toWireEnvelope()` / `toWireProvenance()`.

## T-1006-1 — Stable IDs and the workspace document

```ts
export type ResourceKind =
  | 'workspace' | 'panel' | 'screener' | 'run' | 'change'
  | 'undo' | 'link' | 'filter' | 'study' | 'annotation'
  | 'setup' | 'watchlist' | 'alert' | 'preview';

export type ResourceId = string; // '<prefix>_<slug>_<seq>' e.g. 'panel_chart_1'

export interface ParsedId {
  kind: ResourceKind;
  discriminator?: string; // 'chart' in 'panel_chart_1'
  sequence: number;
}

export function mintId(kind: ResourceKind, seq: number, discriminator?: string): ResourceId;
export function parseId(id: string): ParsedId | null;
export function isResourceId(value: unknown, kind?: ResourceKind): value is ResourceId;

export interface IdSequencer { next(kind: ResourceKind, discriminator?: string): ResourceId; }
export function createIdSequencer(seed?: Record<string, number>): IdSequencer;
```

IDs are stable for a resource's lifetime, never reused after deletion, and
never positional. `ResourceKind` is the single place a sibling epic adds a
new prefix.

```ts
export type Revision = number; // per-workspace, monotonic, starts at 1

export interface WorkspaceDocument {
  id: ResourceId;
  name: string;
  revision: Revision;
  createdAt: string;   // ISO 8601
  updatedAt: string;
  panels: PanelRecord[];
  layout: LayoutEntry[];
  links: PanelLink[];
  activeSymbol: string | null;
  activePanelId: ResourceId | null;
  screenerId: ResourceId | null;
  // Sibling epics attach their own state here keyed by their resource kind,
  // so this epic never needs editing to accommodate them.
  extensions: Record<string, unknown>;
}

export interface PanelRecord {
  id: ResourceId;
  kind: 'filter_builder' | 'chart' | 'study_library' | 'results_table'
      | 'similar_opportunities' | 'watchlist' | 'alerts' | 'symbol_details';
  title: string;
  collapsed: boolean;
  visible: boolean;
  boundResourceId: ResourceId | null;
  config: Record<string, unknown>;
}

export interface LayoutEntry { panelId: ResourceId; col: number; row: number; width: number; height: number; }

export interface PanelLink {
  id: ResourceId;
  sourcePanelId: ResourceId;
  targetPanelId: ResourceId;
  channel: 'symbol' | 'timeframe' | 'selection' | 'crosshair' | 'filters';
}

export function emptyWorkspace(id: ResourceId, name: string, now: string): WorkspaceDocument;
export function normalizeWorkspace(doc: unknown): WorkspaceDocument; // never throws
```

`extensions` is the extension point: EPIC-1008's screener state and
EPIC-1009's chart state live there, keyed, without this epic changing.

## T-1006-2 — The mutation envelope

```ts
export type Actor = 'human' | 'agent';

export interface MutationEnvelope {
  changeId: ResourceId;
  newRevision: Revision;
  affectedIds: ResourceId[];
  diffSummary: string;      // one human sentence, present tense
  warnings: string[];
  undoToken: ResourceId | null; // null when the change is not reversible
}

export interface MutationContext {
  expectedRevision?: Revision;
  idempotencyKey?: string;
  actor: Actor;
}

export function buildEnvelope(input: {
  changeId: ResourceId;
  newRevision: Revision;
  affectedIds: ResourceId[];
  diffSummary: string;
  warnings?: string[];
  undoToken?: ResourceId | null;
}): MutationEnvelope;

export function toWireEnvelope(envelope: MutationEnvelope): {
  change_id: string; new_revision: number; affected_ids: string[];
  diff_summary: string; warnings: string[]; undo_token: string | null;
};
```

Typed errors (`domain/errors.ts`) so callers branch on type, not message:

```ts
export class RevisionConflictError extends Error {
  readonly expectedRevision: Revision;
  readonly currentRevision: Revision;
  readonly affectedIds: ResourceId[];
}
export class IdempotencyConflictError extends Error { readonly idempotencyKey: string; }
export class UndoTokenError extends Error {
  readonly reason: 'unknown' | 'already_redeemed' | 'superseded';
}
export class OperationValidationError extends Error { readonly issues: string[]; }
```

Every error carries a `toWireError()` shape so tools return consistent
failures.

## T-1006-3 — Market-data provenance

```ts
export interface MarketDataProvenance {
  asOf: string;                 // ISO 8601 instant the data describes
  source: string;               // provider identifier
  liveness: 'live' | 'delayed' | 'end_of_day' | 'historical';
  delaySeconds: number | null;  // set when liveness is 'delayed'
  timezone: string;             // IANA, e.g. 'America/New_York'
  currency: string;             // ISO 4217
  priceAdjustment: 'adjusted' | 'unadjusted' | 'not_applicable';
  fundamentalsPeriod: {
    fiscalYear: number; fiscalPeriod: 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
    periodEnd: string; restated: boolean;
  } | null;
  calcEngineVersion: string;
}

export interface WithProvenance<T> { data: T; provenance: MarketDataProvenance; }
export function withProvenance<T>(data: T, provenance: MarketDataProvenance): WithProvenance<T>;
export function toWireProvenance(p: MarketDataProvenance): Record<string, unknown>; // snake_case
```

Port for the separate reference/fundamental-data workstream — this epic
defines it and does **not** implement a provider:

```ts
// domain/ports.ts
export interface ProvenanceSource { current(scope: 'prices' | 'fundamentals' | 'reference'): MarketDataProvenance; }
```

## T-1006-4 — Repository and named revisions

```ts
// domain/ports.ts
export interface WorkspaceRepository {
  list(): WorkspaceSummary[];
  get(id: ResourceId): WorkspaceDocument | null;
  put(doc: WorkspaceDocument): void;
  getActiveId(): ResourceId | null;
  setActiveId(id: ResourceId): void;
  listRevisions(id: ResourceId): SavedRevision[];
  getRevision(id: ResourceId, revision: Revision): WorkspaceDocument | null;
  putRevision(entry: SavedRevision): void;
}

export interface SavedRevision {
  workspaceId: ResourceId;
  revision: Revision;
  name: string | null;     // set by save_workspace
  savedAt: string;
  document: WorkspaceDocument;
}

export interface WorkspaceSummary { id: ResourceId; name: string; revision: Revision; updatedAt: string; }
```

`infra/workspaceRepository.ts` implements this over `localStorage` with the
existing explicit-`Storage`-parameter pattern from
`src/lib/workspace/store.ts`. Storage keys are new and distinct from
`webmcp-workspace-state` and `webmcp-workspace-snapshots`:
`workbench-workspaces`, `workbench-revisions`, `workbench-active`.
Reads never throw on corrupt data.

Retention: every revision is snapshotted, capped at the most recent 100 per
workspace; named revisions are never pruned.

## T-1006-5 — Concurrency and idempotency

```ts
export interface RevisionService {
  commit(input: {
    workspaceId: ResourceId;
    context: MutationContext;
    mutate(doc: WorkspaceDocument): MutationDraft;
  }): MutationEnvelope;
}

export interface MutationDraft {
  document: WorkspaceDocument;   // the next state
  affectedIds: ResourceId[];
  diffSummary: string;
  warnings?: string[];
  inverse?: MutationDraft | null; // omit/null to make the change non-undoable
}

export function createRevisionService(deps: {
  repository: WorkspaceRepository;
  clock: Clock;
  ids: IdSequencer;
  idempotency: IdempotencyCache;
}): RevisionService;

export interface IdempotencyCache {
  lookup(key: string, fingerprint: string): MutationEnvelope | null; // throws IdempotencyConflictError on fingerprint mismatch
  remember(key: string, fingerprint: string, envelope: MutationEnvelope): void;
}
export function createIdempotencyCache(options?: { maxEntries?: number; ttlMs?: number }): IdempotencyCache;
```

`commit` is the single write path for the whole program. It checks
`expectedRevision`, replays on a repeated `idempotencyKey`, appends the
warning when `expectedRevision` is absent, increments the revision, records
history, mints the undo token, and returns the envelope. Nothing else in
the codebase increments a revision.

Defaults: idempotency cache holds 200 entries with a 1-hour TTL.

## T-1006-6 — History, undo, restore

```ts
export interface ChangeRecord {
  changeId: ResourceId;
  workspaceId: ResourceId;
  revision: Revision;          // the revision this change produced
  at: string;
  actor: Actor;
  diffSummary: string;
  affectedIds: ResourceId[];
  undoToken: ResourceId | null;
  undoState: 'available' | 'redeemed' | 'superseded' | 'none';
}

export interface ChangeHistory {
  append(record: ChangeRecord): void;
  list(workspaceId: ResourceId, options?: { limit?: number; before?: Revision }): ChangeRecord[];
  findByUndoToken(token: ResourceId): ChangeRecord | null;
  markRedeemed(token: ResourceId): void;
}

export function undoChange(token: ResourceId, deps: {...}): MutationEnvelope;
export function restoreRevision(workspaceId: ResourceId, revision: Revision, context: MutationContext, deps: {...}): MutationEnvelope;
```

Undo applies the stored inverse draft through `RevisionService.commit`, so
the reversal is itself a numbered, recorded, undoable change. A token is
redeemable only while its change is the newest un-redeemed change for that
workspace; otherwise `UndoTokenError` with `reason: 'superseded'`.
`restoreRevision` moves forward to a new revision whose content equals the
target revision's — it never rewrites history.

History is capped at the most recent 200 records per workspace.

## T-1006-7 — Operation registry

The extension point EPIC-1013 and every domain epic build on.

```ts
export interface OperationDefinition<TInput = unknown> {
  kind: string;                 // namespaced, e.g. 'chart.add_study'
  inputSchema: object;          // JSON Schema, snake_case properties
  validate(input: TInput, doc: WorkspaceDocument): string[];   // [] = valid
  describe(input: TInput, doc: WorkspaceDocument): string;     // one diff sentence
  apply(input: TInput, doc: WorkspaceDocument, ids: IdSequencer): MutationDraft;
}

export interface OperationRegistry {
  register<T>(definition: OperationDefinition<T>): void;
  get(kind: string): OperationDefinition | null;
  kinds(): string[];
}
export function createOperationRegistry(): OperationRegistry;
export const operationRegistry: OperationRegistry; // shared instance

export interface OperationRequest { kind: string; input: unknown; }

export interface PreviewResult {
  previewId: ResourceId;
  valid: boolean;
  affectedIds: ResourceId[];
  diffSummary: string;
  perOperation: { kind: string; describe: string; issues: string[] }[];
  warnings: string[];
  resultingRevision: Revision;  // what the revision would become
}

export function previewOperations(ops: OperationRequest[], deps: {...}): PreviewResult;
export function applyOperations(ops: OperationRequest[], context: MutationContext, deps: {...}): MutationEnvelope;
```

`applyOperations` folds every operation over an in-memory copy and commits
once, so a failure anywhere leaves the stored workspace untouched and a
success produces exactly one revision, one change ID and one undo token.
Sibling epics call `operationRegistry.register(...)` from their own
modules; this epic's files never learn their names.

## T-1006-8 — The tool surface

```ts
export interface WorkbenchDeps {
  repository: WorkspaceRepository;
  revisions: RevisionService;
  history: ChangeHistory;
  registry: OperationRegistry;
  provenance: ProvenanceSource;
  clock: Clock;
  ids: IdSequencer;
}
export function buildWorkbenchTools(deps: WorkbenchDeps): ToolSpec[];
```

`ToolSpec` is the existing contract in `src/lib/webmcp/types.ts`, so the new
tools register through the existing `register.ts` path. Sibling epics
export their own `build<Area>Tools(deps)` and the composition root
concatenates them.

Agent-facing tool names and their snake_case inputs:

| Tool | Inputs |
|------|--------|
| `get_app_context` | — |
| `get_workspace` | `workspace_id?` |
| `create_workspace` | `name`, `template_id?`, `idempotency_key?` |
| `save_workspace` | `workspace_id?`, `name`, `expected_revision?`, `idempotency_key?` |
| `undo_change` | `undo_token` |
| `get_change_history` | `workspace_id?`, `limit?`, `before_revision?` |
| `restore_workspace_revision` | `workspace_id?`, `revision`, `expected_revision?`, `idempotency_key?` |

Read tools return plain JSON; mutating tools return `toWireEnvelope(...)`.
Errors return the typed `toWireError()` shape with `isError: true`.

## Coexistence with the shipping surface

Nothing here imports from `src/lib/webmcp/tools.ts` or
`src/lib/workspace/store.ts` except the `ToolSpec` / `ToolResult` types.
Storage keys do not overlap. The current UI is untouched. EPIC-1015 removes
the old surface once the new one is complete.
