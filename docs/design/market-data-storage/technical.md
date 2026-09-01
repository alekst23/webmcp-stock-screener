# Market Data Storage — Technical Design

## Why this exists

The mock panel is 25 tickers / 19,550 rows / 776 KB. The real one is
~6,268 tickers / ~12M rows. That 600x gap hid three separate sizing
faults, each measured on this codebase rather than estimated:

| Structure | Measured | At 12M rows |
|---|---|---|
| `list[PriceBar]` at the I/O boundary (`panel_io.py`) | 1,081 B/row | **~13 GB** transient, every load |
| `(ticker, date)` dicts (pre-T-1001-9 `pandas_engine.py`) | 118 B/row | ~1.4 GB — an index larger than its data |
| Compact `PanelFrame` (T-1001-9) | 25.1 B/row | ~310 MB resident |

T-1001-9 fixed the third. The first is untouched and is the hard
blocker: the backend cannot boot on real data at *any* instance size,
including a 2 GB Render Standard.

The deeper problem is that even 25.1 B/row is linear in universe x
history. Panel size is a product input, so residency must not scale
with it at all.

## Decisions

### The domain contract does not belong in the bulk path

`PriceBar` is the right contract for *a bar* — a single instance
crossing a boundary, where per-row Pydantic validation is worth its
cost. It is the wrong contract for *the panel*, where that same
validation costs 43x the compact representation it produces.

Panel I/O therefore moves Parquet <-> compact frame directly, with the
schema gate at column level (presence, dtype, ordering) rather than
per row. `PriceBar` stays exactly as it is and keeps its role at the
single-bar boundary. This is not a weakening of validation: a column
dtype check catches producer drift more reliably than 12M repetitions
of the same field check, and catches it in constant time.

### Parquet already is the index

Per-row-group min/max statistics plus column projection give partition
pruning for free, provided the panel is written sorted by ticker with a
row-group size tuned to the read pattern. A hand-rolled ticker index
would duplicate what the format already maintains and would have to be
kept consistent with it. Use the format.

### Partitioning earns its place; hand-rolled streaming does not

Ticker-partitioned storage pays for itself immediately: a filtered
universe reads fewer partitions and fewer columns, using the format's
own machinery, with no bespoke infrastructure to maintain.

Chunked streaming evaluation is a different proposition and is
deliberately *not* built. It would decouple residency from dataset size
— but `find_instances` scans the whole universe by design, so it buys
no latency, only headroom. And the headroom it buys is exactly what a
database gives you for free.

The reasoning that settles it: this POC accepts that a production
version needs a real store. Given that, a hand-rolled chunked reader is
a query engine built to be discarded at the moment it starts mattering.
The honest ladder is:

1. **Now (POC):** fully resident, trimmed liquid universe (~2,000
   tickers x 10+ years, ~130 MB), with no cost growing faster than the
   data.
2. **When it stops fitting:** DuckDB over the same R2 Parquet —
   out-of-core execution and predicate pushdown, no custom scanner.
3. **Prod:** a real time-series store.

Skipping rung 2 to hand-build rung 1.5 is the trap.

Partitioning (T-1016-3) is on the path to rung 2, not wasted: DuckDB
reads the same partitioned Parquet and benefits from the same layout.

### float32, not scaled int32

Carried forward from T-1001-9 and reaffirmed. Fixed-point at
`PriceBar`'s 4 decimals needs a 10,000x scale, which overflows int32
above $214,748; BRK.A trades near $712,000. float32 is the same 4
bytes, spans the range, and holds ~7 significant digits — worst case
~0.06 on a $700k print, ~2e-10 on a sub-cent stock. Far finer than any
return this engine measures.

### The upgrade path: DuckDB over R2

The designated rung 2, to be taken when the trimmed universe stops
fitting — not before. It requires porting `infra/expression.py`'s
`ExpressionEvaluator` to SQL, which is why it is not a POC task: it
replaces a working, well-tested component to buy headroom this POC
does not yet need.

The trigger is explicit: when resident memory at the target universe
exceeds the instance budget's headroom, adopt DuckDB rather than
trimming further or hand-rolling a scanner.

## Contracts

### Panel I/O — bulk path

Parquet bytes <-> compact frame, no intermediate row objects. Schema
validated at column level. Reading accepts a ticker subset and a column
subset, and reads only the partitions and columns named.

### Delta append

Cost proportional to the delta. Idempotent on `(ticker, date)` with the
incoming row winning, preserving the guarantee `merge_bars` was written
for: a retried cron or a manual catch-up leaves one row per ticker-day.

### `PanelStatus` — extended

T-1001-9 introduced `as_of`, `first_date`, `ticker_count`, `row_count`,
`source`. This feature adds the degradation the product spec requires
to be disclosed: whether the panel is stale, whether coverage is
partial, and what is missing. Serve-and-disclose is the rule — hard
failure only when nothing is loadable.

## Migration

Each ticket is independently shippable and behavior-preserving. The
engine's public surface and every existing test stay unchanged
throughout; the mock panel keeps working at every step, which is what
makes the change safe to land incrementally.

Ordering is forced: the vectorized I/O and delta work (T-1016-1,
T-1016-2) must land before partitioning, because until row objects
leave the bulk path their transient peak dominates every other
measurement and no amount of partitioning helps.
