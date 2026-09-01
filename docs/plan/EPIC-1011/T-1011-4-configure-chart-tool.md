# T-1011-4: `configure_chart` tool

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Open
**Depends on**: T-1011-1, T-1011-3
**Blocks**: T-1011-8, T-1011-9

## Description

`configure_chart` is how an agent says what a chart shows. It sets the
instrument, timeframe, visible range, candle type, price scale, trading
session, comparison instruments, and the price-adjustment policy on one
chart panel, as a single revision-checked mutation that can be undone.

## User Story

As an agent asked to "show me Apple daily for the last six months on a
log scale, unadjusted",
I want one tool call that sets exactly those properties and tells me what
changed,
so that the human sees the chart I meant and I know whether my change
landed on the revision I expected.

## Acceptance Criteria

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
   returns the epic's mutation envelope with `change_id`,
   `new_revision`, `affected_ids`, a human-readable `diff_summary`,
   `warnings`, and an `undo_token`.
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
- `.dev/design/tool-spec.md` — the `configure_chart` row and "Common
  contract for every tool"
- `src/lib/webmcp/tools.ts` — existing `ToolSpec` shape, input-schema
  style, and the `ok`/`fail`/`run` result conventions to follow in new
  files

## Technical Considerations

- The mutation envelope, revision check, idempotency handling, and undo
  token are EPIC-1006's; call into them rather than reimplementing.
- The panel this addresses is EPIC-1007's `chart` panel kind. This tool
  configures an existing chart panel; it does not create one.
- AC9's "range with no available data" is a real case for recently
  listed instruments and is what stops a silently empty chart.

## Out of Scope

- Creating, moving, linking, or removing panels (EPIC-1007).
- Studies (T-1011-5), reads (T-1011-6), annotations (T-1011-7).
- Rendering the configured chart (T-1011-9).
