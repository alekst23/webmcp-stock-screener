# Architecture Docs

High-level system design and the relationships between components. Each doc
captures a durable design decision; implementation details and runbooks live
elsewhere (ticket files under `docs/plan/`, behavioral specs under
`docs/design/`).

| Doc | What it covers |
|-----|-----------------|
| [New WebMCP Surface](new-webmcp-surface.md) | The program-wide composition model for the ~33-tool surface rebuild: per-epic tool-group builders, the surface-shared contract modules, and the composition root |
| [Workspace, Revisions & the Common Tool Contract](workspace-revisions.md) | The mutation envelope, stable-ID scheme, optimistic concurrency, idempotency replay, change history/undo, and the extensible operation registry every mutating tool in the new WebMCP surface builds on |
| [Discovery & Catalog](discovery-and-catalog.md) | The catalog registry, instrument resolution, and the three read-only discovery tools |
