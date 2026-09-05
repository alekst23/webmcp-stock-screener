# Discovery & Catalog — Product Spec

## Intent

An agent operating a stock screener cannot do anything until it can name
things the way the app names them: which instrument, which field, which
operator, which study, which interval, which universe. Without a discovery
surface an agent guesses — and a plausible guess ("AAPL", "RSI14",
"above") is indistinguishable, to the agent, from a correct one. Every
wrong guess becomes a rejected call, a retry loop, or worse, a confident
answer built on a misread identifier.

This feature gives the agent three read-only lookups — resolve an
instrument, search the catalog, describe a catalog item — over a declared
inventory of everything the app knows how to name. Done looks like: an
agent goes from the user's words to canonical IDs with declared
parameters, units, ranges, defaults, outputs, and data availability, in one
or two calls, and can always tell the difference between "the app does not
support that" and "that data is not wired up yet".

Derived from `docs/reference/tool-spec.md`. No design interview was
conducted; where the tool spec is silent, an assumption is stated in Open
Questions below and implemented as stated.

## Preconditions

- A WebMCP bridge is present in the browser (same precondition as the rest
  of the tool surface).
- The catalog registry ships with the application; it needs no external
  source and is always present.
- An instrument directory may or may not be configured. When it is not, the
  instrument-resolution behavior below still applies — it reports
  unavailability rather than failing.

## Features

1. **Resolve an instrument**: turn free text naming a company or ticker
   into canonical instrument IDs with exchange, asset type, country,
   currency, and listing status.
2. **Search the catalog**: find the app's fields, operators, studies,
   indicators, patterns, intervals, universes, and templates by free text
   and by kind.
3. **Describe a catalog item**: get one item's parameters, units, valid
   ranges, defaults, outputs, and data availability.
4. **Provenance on every result**: every discovery result states when it is
   as of, where it came from, and under what conditions it holds.
5. **Honest unavailability**: anything depending on reference data this
   project has no source for is reported as unavailable with a reason,
   never omitted and never faked.
6. **5-session price-change field**: `field.price.change_pct_5` is
   registered in the catalog alongside the existing 1- and 2-session
   lookbacks, giving the agent a 5-trading-session proxy for "last week"
   style ranking and filter queries. True calendar-week (holiday-aware)
   resampling stays out of scope — `interval.1w` remains unavailable for
   resampling; this field names its window as sessions, not a calendar
   week.

## Behavioral Specifications

### Resolve an instrument

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Exact ticker | a configured instrument directory | the agent searches for a ticker that exists | the matching instrument is returned with its canonical ID, symbol, name, exchange and MIC, asset type, country, currency, primary-listing flag, and listing status |
| Company name | a configured instrument directory | the agent searches for a company name | instruments whose name matches are returned, each stating that the name was what matched |
| Several listings | the same company trades on several venues | the agent searches for it | every matching listing is returned, ranked, with the primary listing flagged — none is silently chosen on the agent's behalf |
| Narrowing | many candidates match the text | the agent narrows by asset type, exchange, or country | only candidates matching the narrowing are returned |
| Delisted | an instrument is delisted | the agent searches without asking for delisted results | it is omitted; asking to include delisted returns it with a delisted status |
| No match | a configured instrument directory | the agent searches for text nothing matches | an explicit empty-match success naming the query is returned, not an error |
| Never a bare ticker | any successful resolution | the agent takes the returned identifier | the identifier is a namespaced canonical ID distinct from the display symbol |
| No source configured | no instrument directory is configured | the agent searches for anything | a well-formed result is returned reporting the data as unavailable, naming the reference-data dependency as the reason, with no instruments invented |
| Source failure | a configured directory that errors | the agent searches | an error result naming what failed is returned |
| Unknown ID | a canonical-looking ID that does not exist | the agent fetches it | an explicit not-found naming the ID is returned |

### Search the catalog

| Scenario | Given | When | Then |
|----------|-------|------|------|
| By label | the catalog registry | the agent searches for an item's name | that item is returned with its stable ID, kind, label, short description, and availability |
| By synonym | an item with aliases | the agent searches using a common synonym | the item is found |
| By kind | the catalog registry | the agent restricts the search to one or more kinds | only items of those kinds are returned |
| Enumerate | the catalog registry | the agent supplies a kind restriction and no search text | every item of those kinds is listed, so the agent can see what exists rather than guess a term |
| Ranked | several items match | the agent searches | results are ordered by relevance, exact identifier and label matches first |
| Unavailable items | items depending on not-yet-supplied reference data | the agent searches | they are included by default, marked unavailable; the agent may opt to exclude them |
| No match | the catalog registry | the agent searches for text nothing matches | an explicit empty-match success naming the query and any kind restriction is returned |
| Bounded | any search | the agent requests a very large result limit | the limit is clamped to a documented maximum and the result says so |

### Describe a catalog item

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a known catalog item ID | the agent describes it | its ID, kind, label, description, aliases, tags, every parameter (type, unit, default, valid range or allowed values, required), every output (type, unit), and its data availability are returned |
| Kind detail | items of different kinds | the agent describes each | kind-specific detail is present: a field's nullability and fundamentals reporting basis, an operator's arity, operand types and condition family, an interval's bar duration, a universe's membership source, a template's target |
| Availability window | an available item | the agent describes it | the intervals it is available over, and the earliest and latest data where known, are stated |
| Unavailable item | an item depending on not-yet-supplied reference data | the agent describes it | its full declared detail is returned with availability reported as unavailable and a reason naming the dependency — not a not-found |
| Unknown ID | an ID that is not in the registry | the agent describes it | an explicit not-found naming the ID is returned, together with the nearest real catalog IDs so the agent can correct itself in one turn |

### Provenance on every result

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Always present | any of the three tools | the agent receives any successful result | it states `as_of`, the source, live/delayed/end-of-day/static delivery status, the timezone, and the calculation-engine version |
| Delayed data | a delayed source | the agent receives a result | the delay magnitude is stated, not just the fact of delay |
| Monetary payload | a result containing prices or monetary values | the agent receives it | the currency and the price-adjustment policy (adjusted, unadjusted, or not applicable) are stated |
| Fundamentals payload | a result containing fundamentals | the agent receives it | the reporting period — basis, period end, fiscal year and quarter — is stated |
| Not applicable | a result with no monetary, price, or fundamental content | the agent receives it | currency, price-adjustment, and reporting-period are absent rather than defaulted to a guess |

### Read-only guarantee

| Scenario | Given | When | Then |
|----------|-------|------|------|
| No mutation | any of the three tools | the agent calls any of them any number of times | no workspace, screener, or catalog state changes, and no revision, idempotency key, or undo token is required or returned |

## Non-Goals

- **Supplying reference or fundamental market data.** Sectors, industries,
  indexes, exchanges, countries, fundamentals, and earnings calendars have
  no source and no owner yet. This feature defines the port such a source
  would implement against, and reports honest unavailability until one
  lands. No mock pipeline, no fixture dataset presented as real.
- **User-authored catalog entries.** `create_computed_field` and
  `create_custom_study` extend the catalog at runtime; the registry is
  designed to be extensible but this feature ships a read-only, built-in
  inventory.
- **Mutation semantics.** These are read-only tools. The
  `expected_revision` / `idempotency_key` / `undo_token` envelope belongs to
  the safety and persistence tools.
- **Evaluating anything.** The registry declares what a study takes and
  produces; computing it is the chart and screener engines' job.
- **Any UI.** A `study_library` panel that renders the catalog for a human
  belongs to the panel feature, not here.
- **Changing the existing 11-tool pattern-research surface.** It is left
  entirely alone and retired separately.

## Open Questions

1. **Study versus indicator.** The tool spec lists both as distinct catalog
   kinds but never draws the line. *Assumption implemented:* a **study** is
   a parameterized computation that attaches to a chart and produces one or
   more plottable series (MA, RSI, MACD, Bollinger Bands, VWAP, ATR); an
   **indicator** is a named scalar derivable per bar for use in filters and
   ranking without being plotted. The two share a parameter/output shape, so
   the split is cheap to revisit if it proves to be a distinction without a
   difference.
2. **Instrument ID authority.** Whether canonical instrument IDs are minted
   by this application or passed through from the reference-data provider is
   not settled. *Assumption implemented:* the ID is opaque to all callers and
   the port permits either, with a documented default construction the
   application uses when the provider supplies no stable identifier of its
   own.
3. **Availability windows.** The earliest/latest data bounds per catalog
   item can only come from a real data source, and this project has none
   for reference data. *Assumption implemented:* the shape is declared now
   and populated as unknown, so the contract does not change when real
   bounds arrive.
4. **Catalog versioning.** The tool spec requires a calculation-engine
   version on results but says nothing about versioning the catalog itself
   as items are added. *Assumption implemented:* the engine version covers
   both for now; a separate catalog revision is deferred until an epic
   actually needs to detect catalog drift.

---

*Implemented by: EPIC-1008, hotfix/screener-5-session-field*
