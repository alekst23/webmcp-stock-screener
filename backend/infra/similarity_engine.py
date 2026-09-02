"""Pandas-backed `SimilarityEngine` (EPIC-1012 T-1012-2): turns a reference
window into a ranked, pinned `SimilarityRun` drawn from the loaded price
panel.

Reuses `PandasPatternResearchEngine`'s established techniques -- a `PanelFrame`
for compact, positionally-indexed price data, and vectorized panel-wide
computation over per-candidate loops -- without modifying that engine or its
Protocol (T-1012-2 is new files only). Scoring itself is
`domain.models.similarity.score_candidate`, T-1012-1's pure function; this
module's job is producing the two `FeatureVector`s that function compares
and the housekeeping (candidate generation, ranking, pinning, provenance)
around it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone

import pandas as pd

from domain.contracts.similarity_engine import SearchScope
from domain.errors import (
    SimilarityCandidateNotFoundError,
    SimilarityReferenceUnavailableError,
    SimilarityRunNotFoundError,
)
from domain.models.panel import PanelStatus
from domain.models.similarity import (
    FeatureWeightSet,
    InstrumentRef,
    MarketDataProvenance,
    NormalizationRef,
    SimilarityCandidate,
    SimilarityExplanation,
    SimilarityRun,
    SimilarityScore,
    WindowRef,
    score_candidate,
    to_explanation,
)
from infra.panel_frame import PanelFrame
from infra.similarity_features import SimilarityFeatureExtractor

SIMILARITY_ENGINE_VERSION = "0.1.0"

# Stride between candidate anchors within one ticker's own row range, and the
# cap on raw candidates generated per scope before scoring/ranking. An
# explicit, documented bound rather than an unstrided walk of a
# multi-million-row real panel per search -- the ticket's Technical
# Considerations ask for vectorized computation and to cover the cost in
# tests, not for full-scale tuning in this ticket.
_CANDIDATE_STRIDE = 5
_MAX_RAW_CANDIDATES_PER_SCOPE = 500

_CandidateWindow = tuple[str, int, int]  # (ticker, start row, end row)


@dataclass
class _StoredRun:
    """A pinned run plus the full `SimilarityScore` behind each of its
    candidates -- `SimilarityCandidate` itself only carries the trimmed
    fields a search result needs (AC8), but `explain()` (AC9) needs the
    weight-applied and per-family-contribution detail too, so that is kept
    here rather than recomputed."""

    run: SimilarityRun
    scores_by_candidate: dict[str, SimilarityScore]


class PandasSimilarityEngine:
    """Infra-layer adapter implementing
    `domain.contracts.similarity_engine.SimilarityEngine` over an in-memory
    OHLCV panel -- the same `PanelFrame` shape `PandasPatternResearchEngine`
    reads, constructed and held independently (no shared mutable state with
    that engine)."""

    def __init__(self, panel: PanelFrame, panel_status: PanelStatus) -> None:
        self._panel = panel
        self._panel_status = panel_status
        self._features = SimilarityFeatureExtractor(panel.frame)
        self._all_tickers: list[str] = [str(t) for t in pd.unique(panel.frame["ticker"])]
        self._runs: dict[str, _StoredRun] = {}
        self._next_run_seq = 1

    # ---- SimilarityEngine ----

    def search(
        self,
        *,
        instrument_id: str,
        window: WindowRef,
        scope: SearchScope,
        weights: FeatureWeightSet | None = None,
        normalization: NormalizationRef | None = None,
        limit: int = 20,
        min_score: float = 0.0,
        reference_setup_id: str | None = None,
    ) -> SimilarityRun:
        resolved_weights = weights or FeatureWeightSet.from_partial(None)
        resolved_normalization = normalization or NormalizationRef(
            mode="none", anchor="window_start"
        )

        ref_range = self._row_range(instrument_id, window.start, window.end)
        if ref_range is None:
            raise SimilarityReferenceUnavailableError(
                instrument_id,
                f"No price history for instrument {instrument_id!r} in window "
                f"{window.start}..{window.end}.",
            )
        ref_start, ref_end = ref_range
        ref_features = self._features.extract(ref_start, ref_end)
        if not ref_features.vector:
            raise SimilarityReferenceUnavailableError(
                instrument_id,
                "The reference window has too little history to compute any feature family.",
            )

        warnings: list[str] = []
        if ref_features.unavailable:
            names = ", ".join(family.value for family in ref_features.unavailable)
            warnings.append(f"Reference window could not compute: {names} (insufficient history).")

        raw_candidates = self._generate_candidates(instrument_id, ref_start, ref_end, scope)
        scored, dropped_no_history, dropped_below_min = self._score_candidates(
            raw_candidates, ref_features.vector, resolved_weights, min_score
        )
        warnings.extend(
            self._empty_result_warnings(
                raw_candidates, scored, dropped_no_history, dropped_below_min, min_score
            )
        )

        scored.sort(key=lambda item: item[3].overall, reverse=True)
        run_id = self._next_run_id()
        candidates, scores_by_candidate = self._build_candidates(run_id, scored[:limit])

        run = SimilarityRun(
            run_id=run_id,
            reference_setup_id=reference_setup_id or instrument_id,
            scope=scope,
            weights=resolved_weights,
            normalization=resolved_normalization,
            provenance=self._provenance(),
            candidates=candidates,
            warnings=warnings,
        )
        self._runs[run_id] = _StoredRun(run=run, scores_by_candidate=scores_by_candidate)
        return run

    def get_run(self, run_id: str) -> SimilarityRun:
        stored = self._runs.get(run_id)
        if stored is None:
            raise SimilarityRunNotFoundError(run_id)
        return stored.run

    def explain(self, run_id: str, candidate_id: str) -> SimilarityExplanation:
        stored = self._runs.get(run_id)
        if stored is None:
            raise SimilarityRunNotFoundError(run_id)
        score = stored.scores_by_candidate.get(candidate_id)
        if score is None:
            raise SimilarityCandidateNotFoundError(run_id, candidate_id)
        return to_explanation(candidate_id, score)

    # ---- Candidate scoring ----

    def _score_candidates(
        self,
        raw_candidates: list[_CandidateWindow],
        reference_vector: dict,
        weights: FeatureWeightSet,
        min_score: float,
    ) -> tuple[list[tuple[str, int, int, SimilarityScore]], int, int]:
        scored: list[tuple[str, int, int, SimilarityScore]] = []
        dropped_no_history = 0
        dropped_below_min = 0
        for ticker, cand_start, cand_end in raw_candidates:
            cand_features = self._features.extract(cand_start, cand_end)
            if not cand_features.vector:
                dropped_no_history += 1
                continue
            try:
                score = score_candidate(reference_vector, cand_features.vector, weights)
            except ValueError:
                dropped_no_history += 1
                continue
            if score.overall < min_score:
                dropped_below_min += 1
                continue
            scored.append((ticker, cand_start, cand_end, score))
        return scored, dropped_no_history, dropped_below_min

    def _empty_result_warnings(
        self,
        raw_candidates: list[_CandidateWindow],
        scored: list[tuple[str, int, int, SimilarityScore]],
        dropped_no_history: int,
        dropped_below_min: int,
        min_score: float,
    ) -> list[str]:
        if not raw_candidates:
            return [
                "No eligible candidates: the search scope matched no other windows "
                "in the loaded panel."
            ]
        if scored:
            return []
        if dropped_below_min and not dropped_no_history:
            return [f"No candidates cleared the minimum score of {min_score}."]
        if dropped_no_history and not dropped_below_min:
            return ["No candidates had enough history to compute any feature family."]
        return [
            f"No candidates matched: {dropped_below_min} below the minimum score of {min_score}, "
            f"{dropped_no_history} with insufficient history."
        ]

    def _build_candidates(
        self, run_id: str, ranked: list[tuple[str, int, int, SimilarityScore]]
    ) -> tuple[list[SimilarityCandidate], dict[str, SimilarityScore]]:
        candidates: list[SimilarityCandidate] = []
        scores_by_candidate: dict[str, SimilarityScore] = {}
        for index, (ticker, cand_start, cand_end, score) in enumerate(ranked):
            candidate_id = f"{run_id}_candidate_{index + 1}"
            candidates.append(
                SimilarityCandidate(
                    candidate_id=candidate_id,
                    instrument=InstrumentRef(instrument_id=ticker, symbol=ticker),
                    window=self._window_ref(cand_start, cand_end),
                    score=score.overall,
                    per_family_similarity=score.per_family_similarity,
                    unavailable_families=score.unavailable_families,
                )
            )
            scores_by_candidate[candidate_id] = score
        return candidates, scores_by_candidate

    # ---- Candidate generation ----

    def _generate_candidates(
        self, ref_ticker: str, ref_start: int, ref_end: int, scope: SearchScope
    ) -> list[_CandidateWindow]:
        bar_count = ref_end - ref_start
        candidates: list[_CandidateWindow] = []
        if scope in ("same_instrument_windows", "both"):
            candidates.extend(
                self._same_instrument_windows(ref_ticker, ref_start, ref_end, bar_count)
            )
        if scope in ("cross_instrument", "both"):
            candidates.extend(self._cross_instrument_windows(ref_ticker, bar_count))
        return candidates

    def _same_instrument_windows(
        self, ticker: str, ref_start: int, ref_end: int, bar_count: int
    ) -> list[_CandidateWindow]:
        bounds = self._panel.bounds(ticker)
        if bounds is None:
            return []
        start, stop = bounds
        out: list[_CandidateWindow] = []
        pos = start
        while pos + bar_count <= stop and len(out) < _MAX_RAW_CANDIDATES_PER_SCOPE:
            cand_end = pos + bar_count
            # AC5: the reference window itself, and any window overlapping
            # it, is excluded from its own results.
            if pos < ref_end and cand_end > ref_start:
                pos += _CANDIDATE_STRIDE
                continue
            out.append((ticker, pos, cand_end))
            pos += _CANDIDATE_STRIDE
        return out

    def _cross_instrument_windows(self, ref_ticker: str, bar_count: int) -> list[_CandidateWindow]:
        out: list[_CandidateWindow] = []
        for ticker in self._all_tickers:
            if ticker == ref_ticker:
                continue
            bounds = self._panel.bounds(ticker)
            if bounds is None:
                continue
            start, stop = bounds
            pos = start
            while pos + bar_count <= stop and len(out) < _MAX_RAW_CANDIDATES_PER_SCOPE:
                out.append((ticker, pos, pos + bar_count))
                pos += _CANDIDATE_STRIDE
            if len(out) >= _MAX_RAW_CANDIDATES_PER_SCOPE:
                break
        return out

    # ---- Row/date bookkeeping ----

    def _row_range(self, ticker: str, start: date, end: date) -> tuple[int, int] | None:
        """[start row, end row) within `ticker`'s own bounds covering the
        inclusive calendar-date range [start, end] -- not an exact-date
        lookup, since `start`/`end` need not themselves be trading days."""
        bounds = self._panel.bounds(ticker)
        if bounds is None:
            return None
        lower, upper = bounds
        dates = self._panel.frame["date"].to_numpy()[lower:upper]
        lo = int(dates.searchsorted(start.toordinal(), side="left"))
        hi = int(dates.searchsorted(end.toordinal(), side="right"))
        if hi <= lo:
            return None
        return lower + lo, lower + hi

    def _window_ref(self, start: int, end: int) -> WindowRef:
        return WindowRef(
            start=self._panel.date_at(start), end=self._panel.date_at(end - 1), timeframe="1d"
        )

    def _next_run_id(self) -> str:
        run_id = f"similarity_run_{self._next_run_seq}"
        self._next_run_seq += 1
        return run_id

    def _provenance(self) -> MarketDataProvenance:
        status = self._panel_status
        source_label = (
            "Object-store panel" if status.source == "object-store" else "Mock demo panel"
        )
        return MarketDataProvenance(
            as_of=datetime.combine(status.as_of, time.min, tzinfo=timezone.utc),
            source_id=f"panel.{status.source}",
            source_label=source_label,
            liveness="historical",
            timezone="UTC",
            price_adjustment="adjusted",
            engine_version=SIMILARITY_ENGINE_VERSION,
        )
