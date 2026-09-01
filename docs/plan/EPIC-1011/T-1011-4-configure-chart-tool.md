# T-1011-4: Chart source and view contract (symbol, timeframe, range, display settings)

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Open
**Depends on**: T-1011-1, T-1011-3
**Blocks**: T-1011-8, T-1011-9

## Description

This is how an agent says what a chart shows — no longer as a standalone
`configure_chart` tool, but as two contracts this ticket registers into
EPIC-1007's source/renderer registry under the `chart` renderer name.
The instrument, timeframe, visible range, and comparison instruments are
a **source** concern: they resolve through EPIC-1007's `bind_panel_source`,
which this ticket's source-validation contract backs. The candle type,
price scale, trading session, and price-adjustment policy are a **view**
concern: they resolve through EPIC-1007's `configure_panel_view`, which
this ticket's view-configuration contract backs. Either way, the caller
gets a single revision-checked mutation that can be undone — EPIC-1007's
tool call reaches this ticket's validation and application logic for a
`chart`-rendered panel.

## User Story

As an agent asked to "show me Apple daily for the last six months on a
log scale, unadjusted",
I want one tool call that sets exactly those properties and tells me what
changed,
so that the human sees the chart I meant and I know whether my change
landed on the revision I expected — using the same `bind_panel_source`
and `configure_panel_view` tools I use for every other panel.

## Acceptance Criteria

The following criteria describe the contract's behavior; where they say
"the call" or "the tool", the caller reaches this ticket's logic through
EPIC-1007's `bind_panel_source` (instrument, range, comparisons) or
`configure_panel_view` (candle type, scale, session, adjustment policy).

1. Given a chart panel ID and any subset of configurable properties, the
   named properties are applied and every unnamed property is left
   unchanged.
2. The instrument is accepted only as an instrument ID; a bare ticker
   string is rejected with a message directing the caller to resolve it
   first.
3. The price-adjustment policy is settable to fully adjusted,
   split-only adjusted, or unadjusted, and the chart's state afterwards
   reports which is in effect.
4. Comparison instruments can be added and removed, each with a
   normalization mode; adding a comparison without a normalization mode
   applies the documented default and reports it in the result.
5. The call accepts `expected_revision` and `idempotency_key` and
   returns EPIC-1006's mutation envelope with `change_id`,
   `new_revision`, `affected_ids`, a human-readable `diff_summary`,
   `warnings`, and an `undo_token`, exactly as any other
   `bind_panel_source`/`configure_panel_view` call does.
6. When `expected_revision` does not match the workspace's current
   revision, the call is rejected without mutating anything and the
   result names both the expected and the actual revision.
7. Replaying a call with an `idempotency_key` already seen returns the
   original result and does not apply the change twice.
8. Applying the returned `undo_token` restores the chart configuration
   exactly as it was before the call.
9. An invalid configuration — unknown panel ID, unknown instrument,
   unsupported timeframe or candle type, inverted range, a range with no
   available data for that instrument — is rejected with a message
   naming the offending field and the permitted values, and the chart is
   unchanged.
10. Changing the timeframe, range, session, or adjustment policy
    invalidates any cached bars or study output for that chart, so a
    subsequent read reflects the new configuration.
11. The tool's own description and input schema state that the
    instrument must be an ID and that adjustment policy affects every
    downstream price.

## Design References

- `docs/design/chart-tools/spec.md` — "Configure the chart" scenarios
- `docs/design/chart-tools/technical.md` — chart configuration contract
- `docs/reference/tool-spec.md` — the `bind_panel_source` and
  `configure_panel_view` rows, the "Panels: source and renderer are
  separate" section, and "Common contract for every tool"
- `docs/plan/EPIC-1007/T-1007-7-panel-source-renderer-registry.md` — the
  registry interface this ticket's contracts implement
- `src/lib/webmcp/tools.ts` — existing `ToolSpec` shape, input-schema
  style, and the `ok`/`fail`/`run` result conventions to follow in new
  files

## Technical Considerations

- The mutation envelope, revision check, idempotency handling, and undo
  token are EPIC-1006's; call into them rather than reimplementing.
- This ticket does not register a WebMCP tool of its own — EPIC-1007's
  `bind_panel_source` and `configure_panel_view` are the tools an agent
  calls; they resolve to this ticket's validation and apply logic for a
  `chart`-rendered panel via EPIC-1007's source/renderer registry
  (T-1007-7). If T-1007-7 has not landed when this starts, code against
  the agreed contract shape and use a test double.
- The panel this addresses is EPIC-1007's `chart` panel kind. This
  contract configures an existing chart panel; it does not create one.
- AC9's "range with no available data" is a real case for recently
  listed instruments and is what stops a silently empty chart.

## Out of Scope

- Creating, moving, linking, or removing panels (EPIC-1007).
- Studies (T-1011-5), reads (T-1011-6), annotations (T-1011-7).
- Rendering the configured chart (T-1011-9).
