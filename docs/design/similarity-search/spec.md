# Similarity Search — Product Spec

## Intent

A researcher finds one chart that looks right — a setup with a shape,
a volume signature, a volatility regime, and a study configuration they
believe means something — and immediately wants to know whether it is a
pattern or a coincidence. This feature answers that: from a captured
setup, find other symbols and other historical windows that resemble it,
explain feature by feature why each match was proposed, and put the
candidates side by side so the researcher can judge the resemblance with
their own eyes.

The defining property is auditability. A similarity match is never a bare
number. Every candidate arrives with the feature families that produced
its score, the weight applied to each, and each family's contribution —
and those contributions reconcile to the score. A researcher must be able
to disagree with the system and see exactly what it was reasoning from.

Done looks like: a captured setup goes in, a ranked set of visible,
explained, visually comparable candidates comes out, entirely through tool
calls, with the data's provenance stated at every step.

## Preconditions

- A captured setup exists — a symbol, a historical window, its studies,
  and its normalization settings, saved under a stable ID. Producing one
  is the `capture_chart_setup` feature's job, not this one's.
- A price panel is loaded and searchable in the backend. This spec's
  behavior is identical whether it serves synthetic or real data.
- A workspace with a panel container exists, so results have somewhere to
  be seen. Without it the tools still return data, but the shared
  human-agent session this feature assumes is not reachable.
- Reference and fundamental data (used by the relative-strength family) is
  reached through the market-data ports. Where it is unavailable, the
  "unavailable feature family" behavior below applies — it is a degraded
  case, not an error case.

## Features

1. **Similarity search**: given a captured setup, search the universe for
   candidate setups that resemble it — other instruments, other historical
   windows of the same instrument, or both — returning a ranked, pinned
   result set.
2. **Feature-weighted scoring**: score resemblance across six feature
   families (price shape, volume, volatility, relative strength, studies,
   pattern structure) under an explicit, inspectable weight set that the
   caller may supply and that every result echoes back.
3. **Match explanation**: for any candidate of a completed search, return
   the per-family weight, measured similarity, and signed contribution
   behind its score, reconciling to that score.
4. **Candidate presentation**: show a search's candidates in a panel,
   ranked, with each one's score and the features that drove it.
5. **Comparative visualization**: display selected candidates against the
   reference setup as normalized overlays, synchronized charts, or small
   multiples, aligned on a common anchor.
6. **Stated comparability**: carry the captured setup's normalization
   settings through search, explanation, and comparison, and state the
   settings actually applied wherever results are shown.
7. **Stated provenance**: attach full market-data provenance — `as_of`,
   source, live/delayed status, timezone, currency, adjusted/unadjusted
   price basis, and calculation-engine version — to every result and view.

## Behavioral Specifications

### Similarity search

| Scenario | Given | When | Then |
| --- | --- | --- | --- |
| Happy path | a captured setup and a search scope | a similarity search is run | a pinned run is returned with candidates ranked by descending score, each carrying a stable candidate ID, its instrument and historical window, its overall score, and its per-family measured similarities |
| Scope is explicit | a captured setup | a search is run with a scope of other instruments, other windows of the same instrument, or both | only candidates from the requested scope are returned, and the run states the scope that was applied |
| Self-exclusion | a captured setup | a search including the setup's own instrument is run | the reference window itself and windows overlapping it are excluded — a setup is never returned as a match for itself |
| Identity by ID | any search result | candidates are returned | every candidate is identified by a stable candidate ID; a ticker may appear as a label but is never the identifier |
| Pinned results | a completed search | the same run ID is read again | the identical candidates in the identical order are returned without the search being re-run |
| Nothing clears the bar | a minimum score above every candidate's score | a search is run | an empty ranked list is returned with a warning stating why; the threshold is never relaxed and weaker matches are never substituted |
| Empty universe | a universe with no eligible candidates | a search is run | an empty run with a warning naming the cause (empty universe, insufficient history, or all candidates below the minimum) is returned — not an error, and not a silently widened search |
| Missing reference | a setup ID that does not exist | a search is run | an actionable error naming the missing setup is returned, never an empty result that would read as "nothing resembles this" |

### Feature-weighted scoring

| Scenario | Given | When | Then |
| --- | --- | --- | --- |
| Default weights are visible | no weights supplied | a search is run | documented default weights are applied and echoed in the result, so the caller can see what was used rather than inferring it |
| Caller weights change ranking | two searches over the same setup and universe differing only in their weight set | both are run | the two produce different candidate orderings, and each states the weight set it applied |
| Weights round-trip | a completed search | its reported weight set is supplied back to a new search unchanged | the new search produces the same ranking as the original — so a later refinement pass can adjust weights without any contract change |
| Invalid weights | a weight set naming an unknown feature family, or carrying a negative weight | a search is run | the search is rejected with an error naming the offending entry; the weights are never silently coerced or dropped |
| Unavailable family | a reference or candidate window with insufficient data for one feature family | a search is run | that family is reported unavailable and named, and excluded from the weighted score — never scored as zero, which would read as "dissimilar" rather than "unknown" |
| Normalization invariance | two windows of identical shape at different absolute price levels and different bar counts | they are compared under the same normalization settings | their price-shape similarity is high — the normalization removes level and length, which is what makes the comparison meaningful |

### Match explanation

| Scenario | Given | When | Then |
| --- | --- | --- | --- |
| Happy path | a candidate from a completed search | its explanation is requested | each of the six feature families is returned with the weight applied, the measured per-family similarity, and that family's signed contribution to the overall score |
| Contributions reconcile | any candidate and its explanation, under any weight set | the contributions are summed | they reconcile to the candidate's reported overall score within a stated tolerance, and the response states that score so the check is visible to the reader |
| Explanation matches the search | a candidate that a search ranked at a given score | its explanation is requested | the score explained is identical to the score the search returned for that candidate |
| Served from the pinned run | a completed search | an explanation is requested | it is derived from the pinned run; the search is never re-run to produce it |
| Unavailable family in an explanation | a candidate whose relative-strength data was unavailable | its explanation is requested | that family is reported unavailable and its exclusion from the score is stated, rather than appearing as a zero contribution |
| Wrong run | a candidate ID that belongs to a different run | its explanation is requested within the named run | an actionable error identifying the mismatch is returned — never an explanation for some other candidate |
| Expired run | a run ID that no longer exists | an explanation is requested | an actionable error stating the run is unavailable and a new search is required is returned; no search is silently started |
| Read-only | any workspace state | an explanation is requested | the workspace is unchanged and no mutation is recorded |

### Candidate presentation

| Scenario | Given | When | Then |
| --- | --- | --- | --- |
| Happy path | a completed similarity run | it is shown in a panel | candidates appear ranked by score, each showing its instrument, its historical window, its score, and the feature families that contributed most to it |
| Never a bare score | any candidate in the panel | it is displayed | it is displayed with its driving feature context, never as a score alone |
| Selection is shared state | a panel of candidates | a candidate is selected in the UI | the selection is readable as workspace state, so an agent reading the workspace can act on "this one" |
| Empty run | a run with zero candidates | it is shown in a panel | an explicit empty state carrying the run's warning is shown, distinguishable from a panel that has not yet been given a run |
| Ordinary panel behavior | a candidates panel in the container | it is added, retitled, laid out, linked, or removed | it behaves like every other panel kind, with no special-casing |

### Comparative visualization

| Scenario | Given | When | Then |
| --- | --- | --- | --- |
| Happy path | a run and a selected subset of its candidates | a comparison is requested in one of the three forms | the candidates are displayed as normalized overlays, synchronized charts, or small multiples, as requested |
| Reference is present | any comparison | it is displayed | the reference setup is included and visually distinguished as the baseline the candidates are compared against |
| Common anchor | candidates whose windows differ in absolute dates | a comparison is displayed | all candidates and the reference are aligned on a common anchor, so corresponding points line up rather than being compared at unrelated offsets |
| Synchronized movement | a synchronized-charts comparison | the time axis or crosshair is moved on one chart | every chart in the comparison moves with it |
| Too many candidates | more candidates than a form can legibly display | a comparison is requested | an explicit warning states the cap applied and which candidates were shown; the view is never silently truncated or rendered illegibly |
| Wrong candidate | a candidate ID not belonging to the named run | a comparison is requested | an actionable error is returned and no view change occurs |

### Stated comparability

| Scenario | Given | When | Then |
| --- | --- | --- | --- |
| Settings flow through | a captured setup carrying normalization settings | a search, explanation, or comparison derived from it is shown | the settings applied are the captured setup's, and the settings actually applied are stated in the result — comparability is asserted, never assumed |
| Settings are auditable | any displayed comparison | it is read | the normalization basis under which the candidates were compared is visible to the reader, not only present in the underlying data |

### Stated provenance

| Scenario | Given | When | Then |
| --- | --- | --- | --- |
| Every result | any similarity result, explanation, or comparison view | it is returned or displayed | it states `as_of`, source, live/delayed status, timezone, currency, adjusted/unadjusted price basis, and calculation-engine version |
| Provenance survives the hops | a run whose provenance the backend reported | the panel and comparison view for that run are read | the provenance they show matches what the backend reported for that run |

### Workspace safety

| Scenario | Given | When | Then |
| --- | --- | --- | --- |
| Mutations follow the common contract | a search or comparison that changes the workspace | it is invoked | it honors `expected_revision` and `idempotency_key` and returns the common mutation envelope with `change_id`, `new_revision`, `affected_ids`, `diff_summary`, `warnings`, and `undo_token` |
| Repeat is not duplicate | a mutating similarity call | it is invoked twice with the same `idempotency_key` | exactly one change occurs, and the second call reports the first call's result |
| Stale revision | a mutating similarity call carrying an out-of-date `expected_revision` | it is invoked | it is rejected with a conflict the caller can act on, and the workspace is left unchanged |
| Undo | a similarity call that changed the workspace | its undo token is applied | the workspace returns to its prior state, including removal of any panel the call bound |
| Backend unavailable | the backend is unreachable | a search is run | an actionable tool error is returned and the workspace is unchanged — no partially applied change, and no panel bound to a run that does not exist |

## Open Questions

Not settled by `.dev/design/tool-spec.md`; each carries the assumption this
spec is written against.

1. **Candidate universe bounds.** No default universe or result cap is
   specified. *Assumption*: when a screener is bound to the workspace, its
   universe scopes the search; otherwise a bounded default applies, with
   results capped and paged from the pinned run.
2. **Default weights.** Not specified. *Assumption*: equal weight across
   the six families, always echoed so the default is visible.
3. **Similarity metric.** Not specified. *Assumption*: each family yields a
   normalized per-family similarity and the overall score is their weighted
   combination — chosen so contributions reconcile to the score, which is
   what makes the explanation checkable.
4. **Comparison target.** Whether `compare_setups` creates a panel or
   reconfigures one is unstated. *Assumption*: it targets an explicit panel
   ID, defaulting to the candidates panel bound to the run.

## Out of Scope

- Capturing a setup in the first place — a separate feature.
- Refining feature weights from accepted and rejected matches. This spec
  guarantees only that weights are an explicit, round-trippable input, so
  that refinement needs no change here.
- Deriving an editable filter tree from a setup.
- Measuring forward returns, backtesting, or otherwise evaluating whether
  the matched setups were profitable — resemblance is not performance.
- Sourcing reference and fundamental market data.
- Exporting or sharing a comparison view.
