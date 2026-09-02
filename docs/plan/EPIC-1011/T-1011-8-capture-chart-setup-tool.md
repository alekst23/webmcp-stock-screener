# T-1011-8: `capture_chart_setup` tool

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Done
**Depends on**: T-1011-4, T-1011-5, T-1011-7
**Blocks**: T-1011-9

## Description

`capture_chart_setup` freezes what the chart is currently showing — the
instrument, the historical window, the studies, and the normalization and
adjustment settings — into a named, ID-addressable reference setup. This
is the hand-off point of the whole program: EPIC-1012's
`find_similar_setups` takes a captured setup as its input, so the record
this tool writes is a cross-epic contract, not an internal detail.

## User Story

As a researcher who has finally got a chart showing exactly the pattern I
care about,
I want to capture it as a named reference setup,
so that I — or the agent — can search history for other instances of it
without rebuilding the chart from memory.

## Acceptance Criteria

1. Capturing a chart returns a stable setup ID and stores a record that
   states the instrument (by ID), the historical window with its
   timeframe and session, the candle type and scale, the normalization
   settings, the ordered study instances with their resolved parameters,
   the comparison instruments, and the price-adjustment policy in force.
2. The stored record carries a provenance block — `as_of`, source,
   live/delayed status, timezone, currency, effective adjustment policy,
   and calculation-engine version — describing the data it was captured
   from.
3. The record includes the workspace revision and source panel ID it was
   captured at, and the capture timestamp.
4. The record is self-contained: every field needed to reconstruct or
   search for the setup is present in the record, so a consumer never has
   to read the live chart, and deleting or reconfiguring the source panel
   afterwards does not invalidate it.
5. Capturing the same chart twice produces two distinct setup IDs; the
   earlier record is unchanged by the later capture.
6. An optional caller-supplied name and notes are stored and returned
   with the record.
7. Capturing a chart with no instrument configured, or with a window
   containing no bars, is rejected with a message saying what is missing,
   and no partial record is stored.
8. A captured setup can be retrieved by its ID and round-trips
   unchanged through workspace persistence.
9. The call accepts `expected_revision` and `idempotency_key` and
   returns the mutation envelope with the setup ID in `affected_ids` and
   an `undo_token` that discards the capture.
10. The record's shape is documented in
    `docs/design/chart-tools/technical.md` as a cross-epic contract, with
    EPIC-1012 named as its consumer.

## Solution Approach

The record type, its constructor, its serializer, its normalizer and its
workspace store already exist in `chart/domain/capturedSetup.ts`. This
ticket adds only the two layers above them: an application use case and
the tool.

### Why capture needs an async prologue

`buildCapturedSetup` requires a `SetupWindow` carrying a real `barCount`,
and a `MarketDataProvenance` describing the data the capture was taken
from. Neither is knowable from the workspace document — both come from
the bars port, which is async. `OperationDefinition.apply` is
synchronous. So the use case splits in two:

1. **`prepareCapture` (async, application).** Resolves the chart's range
   through `resolveChartRange` from `chartData.ts`, fetches the series
   through `ChartSeriesPort`, and returns the resolved `SetupWindow`
   (bar span, timeframe, session, bar count) plus the series provenance
   and any warnings. It does **not** go through `readChartData`: that
   read is capped at 500 bars and refuses rather than truncates, which is
   right for a data read and wrong for a capture that only needs to count
   bars.
2. **`chart.capture_setup` (sync, EPIC-1006 operation).** Takes the
   already-resolved window and provenance as operation input, calls
   `buildCapturedSetup`, and writes through `writeCapturedSetup`.

Registering the operation is what supplies `expected_revision`,
`idempotency_key`, the envelope and the undo token — none of it is
reimplemented here (AC9).

### The window a setup covers

`window.start` / `window.end` are the span of the bars actually returned,
not the chart's resolved range. A chart configured with `max` resolves to
a range beginning at the epoch; recording that as the setup's window
would tell EPIC-1012 to search decades the instrument never traded.

### `workspace_revision`

The revision whose state was frozen, i.e. the document's revision before
the capture commits. The capture itself lands at `revision + 1`, and the
only difference between the two is the record's own existence.

### AC4 — self-containment

`buildCapturedSetup` already copies every value out of `ChartState`. The
test that earns AC4 is behavioral, not structural: capture, snapshot the
stored record as JSON, then reconfigure the panel's instrument, timeframe
and studies and remove the panel's chart state entirely, and assert the
stored record is byte-identical.

### AC7 — no partial record

Both rejection paths fail in `prepareCapture`, before anything is
committed, and both raise `CaptureSetupError`, so the tool's failure
always carries `error: capture_setup_incomplete` and the `issues` list.
The `chart.capture_setup` operation's own `validate` repeats the same
blockers so a caller reaching the registry directly cannot store a
partial record either.

### AC8 — round trip and retrieval

The tool's success payload is built from `readCapturedSetup(doc, setupId)`
— the record read back out of the workspace through
`normalizeCapturedSetup` — rather than from the in-memory object it just
wrote. The returned payload is therefore itself evidence that the record
survives persistence, and no second retrieval path is invented.

### Files

- `chart/application/captureSetup.ts` — `prepareCapture`, the
  `chart.capture_setup` `OperationDefinition`, its schema and validator.
- `chart/tools/captureChartSetup.ts` — `buildCaptureChartSetupTool`,
  `CAPTURE_CHART_SETUP_TOOL_NAME`, wire translation and error mapping.
  Registers nothing on import; T-1011-9 owns the composition root.
- `docs/design/chart-tools/technical.md` — the `CapturedChartSetup`
  section brought field-for-field into line with the shipped type (AC10).

## Design References

- `docs/design/chart-tools/spec.md` — "Capture a reference setup"
  scenarios
- `docs/design/chart-tools/technical.md` — the `CapturedChartSetup`
  contract table, which this ticket must keep accurate
- `docs/reference/tool-spec.md` — the `capture_chart_setup` and
  `find_similar_setups` rows; the latter is the consumer

## Technical Considerations

- AC4 is what makes the contract usable across epics. A setup that points
  back at a live panel breaks the moment the panel changes, and
  similarity search would then be searching for something that no longer
  exists.
- Coordinate the record's shape with EPIC-1012 before changing it after
  this ticket lands; it is the interface between the two epics.
- The normalization settings matter to the consumer specifically: two
  price series are only comparable after the same normalization, so the
  captured mode has to be explicit rather than defaulted at search time.

## Out of Scope

- Similarity search, similarity explanation, and comparison
  (EPIC-1012).
- Deriving a filter tree from a setup (`derive_filters_from_setup` is a
  follow-up tool).
- A browsing or management UI for saved setups.
