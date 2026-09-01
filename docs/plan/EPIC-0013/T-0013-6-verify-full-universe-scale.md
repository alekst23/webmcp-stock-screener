# T-0013-6: Verify at target universe scale on 512 MB

**Epic**: EPIC-0013 (Market Data Storage)
**Status**: Blocked — needs a real (paid) backfill and a deployed instance
**Depends on**: T-0013-3, T-0013-5
**Blocks**: —
**Issue**: #13
**Design**: docs/design/market-data-storage/

Resolves #13

## Description

The epic's claim is that a trimmed liquid universe — on the order of 2,000
US listed common stocks across 10+ years, ~5M ticker-days, ~130 MB resident
— runs comfortably on a 512 MB instance with real headroom. This ticket
proves it end to end against real data rather than fixtures, and records the
measurements so a later regression has a baseline to fail against.

It also fixes the universe itself. The liquidity floor is a product decision
as much as a sizing one — thinly-traded microcaps distort pattern base rates
— so the chosen cut and its rationale are recorded, not left implicit in a
CLI flag someone ran once.

This is also where T-0015-9's deferred AC1 and AC5 finally close: the real
backfill runs, and the spot-check validates results against independently
known real-world facts.

## User Story

As the person shipping this,
I want the full-universe claim demonstrated on the real instance,
so that "it fits" is a measurement rather than a projection.

## Acceptance Criteria

1. A liquidity/market-cap cut is chosen, its rationale recorded, and the
   resulting ticker count stated. A real backfill of that universe over 10+
   years is loaded into object storage and served by the deployed backend.
2. Startup and steady-state memory on the deployed instance are measured and
   recorded, and fall within the 512 MB budget with stated headroom.
3. Peak memory during a whole-universe search is measured and recorded, and
   stays within budget with stated headroom.
4. A complete research session against real data produces plausible results,
   spot-checked against at least three independently known real-world facts
   (e.g. a documented earnings gap in a well-known stock).
5. The panel's as-of date shown to the user matches the real data's latest
   session.
6. Measurements are recorded somewhere durable enough to serve as a
   regression baseline, including the headroom figure that would trigger the
   DuckDB upgrade described in the technical design.

## Out of Scope

Load and latency benchmarking beyond what the memory claim requires.

## Status: blocked, with the sizing question already answered

AC1's backfill, AC4's spot-check, and AC2/AC3's "on the deployed instance"
all need a paid EODHD run and a live Render instance. Neither was in scope
for this pass, so the ticket stays open.

What *could* be measured without them was: the same lifecycle at the target
shape, on a synthetic panel of the same size. Memory is a function of the
row count and the layout, not of the prices in the rows, so those numbers
carry — and they answer the epic's central question early, in the direction
nobody wanted.

### Measurements (synthetic panel, local, 512 MB budget)

`scripts/measure_universe_scale.py`, peak RSS in a fresh process, panel bytes
excluded from the baseline. Search is a two-step setup whose first condition
is a volume spike:

| shape | rows | resident | load peak | steady state | **search peak** |
|---|---|---|---|---|---|
| 100 x 500 | 50k | 1.3 MB | 14.1 MB | 14.3 MB | 19.1 MB |
| 1,000 tickers x 10y | 2.52M | 65.6 MB | 142.3 MB | 162.8 MB | **383.5 MB** |
| 2,000 tickers x 10y | 5.04M | 131.2 MB | 227.2 MB | 267.9 MB | **687.8 MB** |

**The epic's residency claim holds exactly.** 26.0 bytes/row, 131 MB resident
at 2,000 tickers x 10 years — the sizing note's ~130 MB, to three digits.
Loading it peaks at 227 MB and takes 0.14 s.

**The epic's 512 MB claim does not hold at that universe.** A whole-universe
search peaks at 688 MB, 34% over budget, and would be OOM-killed on the
target instance. The cost is not the panel and not the anchors — this
measurement found zero anchors — it is `infra/expression.py` evaluating one
condition series panel-wide: every named field widens to float64 and the
groupby-rolling machinery allocates several multiples of it. Marginal search
cost measures **~121 bytes/row**, against 26 bytes/row resident.

**What does fit.** At ~121 bytes/row marginal plus ~80 MB fixed, a 512 MB
budget with 20% headroom allows roughly **2.7M ticker-days — about 1,000
liquid names over 10 years**, which measures 383 MB peak with ~130 MB spare.
That is the universe this POC can actually serve today, and half the epic's
stated target.

### What this means for the epic

`technical.md` already names the trigger and the answer: *"when resident
memory at the target universe exceeds the instance budget's headroom, adopt
DuckDB rather than trimming further or hand-rolling a scanner."* The trigger
has now fired, one rung earlier than expected — during evaluation rather than
during residency. Two honest options for whoever picks this up:

1. **Halve the universe** to ~1,000 names and ship the POC within budget.
   Cheap, measured, and consistent with the liquidity-floor rationale (the
   names that fall out are the least liquid, which distort base rates
   anyway).
2. **Take rung 2 early** — DuckDB over the partitioned Parquet T-0013-3 now
   writes — which is what removes the evaluator's whole-panel float64
   intermediates rather than shrinking their input.

Trimming the *evaluator's* intermediates (float32 arithmetic, chunked
condition evaluation) is the third option and is exactly the hand-rolled
query engine `technical.md` argues against building.

### Still outstanding for this ticket

- AC1: the liquidity/market-cap cut as a product decision, and a real
  backfill of it into object storage.
- AC2, AC3: the same measurements on the deployed instance rather than a
  laptop.
- AC4: the three real-world spot-checks (needs real data).
- AC5: as-of date against a real backfill's latest session.
- AC6: partially done — the numbers above and
  `scripts/measure_universe_scale.py` are the regression baseline; the
  deployed figures still need recording beside them.
