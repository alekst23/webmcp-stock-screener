# T-1008-8: Make instrument-search unavailability detection structural, not string-matched

**Epic:** EPIC-1008
**Status:** Open

## Goal

`src/lib/webmcp/discovery/searchInstruments.ts` currently decides whether the
instrument directory has no source configured by comparing
`envelope.provenance.sourceId === UNCONFIGURED_SOURCE_ID`, importing that
constant directly from the one shipped adapter,
`src/lib/discovery/unavailableDirectory.ts`. Two independent epic-review
passes (`[ARCHITECTURE]` and `[ORCHESTRATION]`) flagged this as fragile: when
a real `InstrumentDirectory` implementation replaces `UnavailableDirectory`
(T-1008-3's whole stated purpose), nothing forces it to reuse this sourceId,
so the unavailable-detection check silently stops firing with no compiler
error. Fix by adding a structural signal to the `InstrumentDirectory` port
contract or `DiscoveryEnvelope` itself (e.g. an explicit `unavailable: boolean`
or a `delivery: 'static' | 'live' | 'unconfigured'` field), and have
`searchInstruments.ts` branch on that instead of a named adapter's constant.

## Acceptance criteria

- `searchInstruments.ts` no longer imports `UNCONFIGURED_SOURCE_ID` (or any
  other adapter-specific constant) from `unavailableDirectory.ts` to decide
  `outcome: 'source_unavailable'`.
- The "no source configured" signal is declared on the `InstrumentDirectory`
  port contract or `DiscoveryEnvelope` type, so any future adapter that wants
  to report unavailability must satisfy the type, not match a magic string.
- Existing tests covering the unconfigured-source path in
  `searchInstruments.test.ts` and `ports.test.ts` continue to pass unmodified
  in behavior (result shape for the caller is unchanged), only the detection
  mechanism changes.
