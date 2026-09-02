import ast
import math
from datetime import date, timedelta

import pytest

from domain.errors import (
    SimilarityCandidateNotFoundError,
    SimilarityReferenceUnavailableError,
    SimilarityRunNotFoundError,
)
from domain.models.panel import PanelStatus
from domain.models.price import PriceBar
from domain.models.similarity import FeatureFamily, FeatureWeightSet, WindowRef
from infra.panel_frame import PanelFrame
from infra.similarity_engine import SIMILARITY_ENGINE_VERSION, PandasSimilarityEngine
from infra.similarity_features import SimilarityFeatureExtractor, WindowFeatures

# ---- Fixture builders -------------------------------------------------


def _bar(ticker: str, day: date, close: float, volume: float = 1_000_000.0) -> PriceBar:
    return PriceBar(
        ticker=ticker,
        date=day,
        open=close,
        high=close + 0.5,
        low=max(close - 0.5, 0.01),
        close=close,
        volume=max(int(volume), 1),
    )


def _bars(
    ticker: str,
    closes: list[float],
    volumes: list[float] | None = None,
    start: date = date(2024, 1, 1),
) -> list[PriceBar]:
    volumes = volumes or [1_000_000.0] * len(closes)
    return [
        _bar(ticker, start + timedelta(days=i), c, v)
        for i, (c, v) in enumerate(zip(closes, volumes))
    ]


def _wave(
    base: float, n: int, period: float = 10.0, amplitude: float = 0.05, phase: float = 0.0
) -> list[float]:
    return [base * (1 + amplitude * math.sin(2 * math.pi * (i + phase) / period)) for i in range(n)]


def _ramp(base: float, n: int, step: float) -> list[float]:
    return [base + i * step for i in range(n)]


def _status(source: str = "mock", as_of: date = date(2024, 6, 1)) -> PanelStatus:
    return PanelStatus(
        as_of=as_of, first_date=date(2024, 1, 1), ticker_count=1, row_count=1, source=source
    )


def _engine(bars: list[PriceBar], status: PanelStatus | None = None) -> PandasSimilarityEngine:
    return PandasSimilarityEngine(PanelFrame.from_bars(bars), status or _status())


# A single, reused panel: REF has 60 bars (a 20-bar reference window sits at
# its middle, positions 20-39, leaving room on both sides for same-instrument
# candidates -- AC5 -- and well past the studies warm-up -- AC1). OTHER is a
# phase-shifted, differently-leveled wave, for cross-instrument candidates.
_REF_CLOSES = _wave(base=100.0, n=60, period=10.0, amplitude=0.05)
_REF_VOLUMES = _wave(base=1_000_000.0, n=60, period=6.0, amplitude=0.4)
_OTHER_CLOSES = _wave(base=300.0, n=60, period=10.0, amplitude=0.05, phase=2.0)
_OTHER_VOLUMES = _wave(base=1_500_000.0, n=60, period=6.0, amplitude=0.4, phase=1.0)
_REF_WINDOW = WindowRef(
    start=date(2024, 1, 21), end=date(2024, 2, 9), timeframe="1d"
)  # positions 20..39


def _shared_panel_engine() -> PandasSimilarityEngine:
    bars = _bars("REF", _REF_CLOSES, _REF_VOLUMES) + _bars("OTHER", _OTHER_CLOSES, _OTHER_VOLUMES)
    return _engine(bars)


# ---- AC1/AC2: feature extraction ---------------------------------------


class TestFeatureExtraction:
    def test_reference_window_with_full_history_computes_five_of_six_families(self) -> None:
        extractor = SimilarityFeatureExtractor(
            PanelFrame.from_bars(_bars("REF", _REF_CLOSES, _REF_VOLUMES)).frame
        )

        features = extractor.extract(20, 40)

        expected = {
            FeatureFamily.PRICE_SHAPE,
            FeatureFamily.VOLUME,
            FeatureFamily.VOLATILITY,
            FeatureFamily.STUDIES,
            FeatureFamily.PATTERN_STRUCTURE,
        }
        assert set(features.vector) == expected, (
            f"expected the five computable families with 20 bars of history well past "
            f"warm-up, got {set(features.vector)}"
        )
        assert features.unavailable == (FeatureFamily.RELATIVE_STRENGTH,), (
            "relative_strength has no data source in this codebase yet and must be "
            f"reported unavailable, not fabricated -- got {features.unavailable}"
        )
        assert FeatureFamily.RELATIVE_STRENGTH not in features.vector

    def test_price_shape_first_resampled_point_is_zero_regardless_of_price_level(self) -> None:
        """AC2 (price-level invariance): a percent-change-from-start series is
        always 0 at its own start, whatever the instrument's absolute price
        -- this is the mechanism, not an incidental fact, so it holds for a
        $5 stock and a $5,000 one alike."""
        cheap = SimilarityFeatureExtractor(
            PanelFrame.from_bars(_bars("CHEAP", _wave(5.0, 20))).frame
        )
        expensive = SimilarityFeatureExtractor(
            PanelFrame.from_bars(_bars("EXP", _wave(5000.0, 20))).frame
        )

        cheap_shape = cheap.extract(0, 20).vector[FeatureFamily.PRICE_SHAPE]
        expensive_shape = expensive.extract(0, 20).vector[FeatureFamily.PRICE_SHAPE]

        assert cheap_shape[0] == pytest.approx(
            0.0, abs=1e-9
        ), f"expected the $5 window's first resampled point to be 0, got {cheap_shape[0]}"
        assert expensive_shape[0] == pytest.approx(0.0, abs=1e-9), (
            f"expected the $5000 window's first resampled point to be 0 too "
            f"(price-level invariance), got {expensive_shape[0]}"
        )

    def test_price_shape_embedding_has_fixed_length_regardless_of_bar_count(self) -> None:
        """AC2 (bar-count invariance): a 6-bar and a 40-bar window must embed
        to the same length, or they could never be compared."""
        short = SimilarityFeatureExtractor(
            PanelFrame.from_bars(_bars("SHORT", _wave(100.0, 6))).frame
        )
        long_ = SimilarityFeatureExtractor(
            PanelFrame.from_bars(_bars("LONG", _wave(100.0, 40))).frame
        )

        short_shape = short.extract(0, 6).vector[FeatureFamily.PRICE_SHAPE]
        long_shape = long_.extract(0, 40).vector[FeatureFamily.PRICE_SHAPE]

        assert len(short_shape) == len(long_shape), (
            f"expected equal-length embeddings regardless of bar count, "
            f"got {len(short_shape)} (6 bars) vs {len(long_shape)} (40 bars)"
        )

    def test_identical_relative_shape_scores_highly_similar_across_level_and_bar_count(
        self,
    ) -> None:
        """AC2, end to end: the same relative shape, at a very different
        price level and a very different bar count, still measures as highly
        similar -- and clearly more similar than a genuinely different shape
        at the reference's own level and bar count."""
        from domain.models.similarity import per_family_similarity

        ref = SimilarityFeatureExtractor(
            PanelFrame.from_bars(_bars("REF2", _wave(50.0, 12, period=10.0))).frame
        )
        # Same number of cycles over the window's own span as the reference
        # (period scaled by the bar-count ratio) -- "identical relative
        # shape" means the same curve over [0, 1] of the window, not the
        # same absolute wavelength.
        same_shape_far = SimilarityFeatureExtractor(
            PanelFrame.from_bars(_bars("FAR", _wave(4000.0, 40, period=10.0 * 40 / 12))).frame
        )
        different_shape_near = SimilarityFeatureExtractor(
            PanelFrame.from_bars(_bars("NEAR", _ramp(50.0, 12, step=4.0))).frame
        )

        ref_vec = ref.extract(0, 12).vector[FeatureFamily.PRICE_SHAPE]
        far_vec = same_shape_far.extract(0, 40).vector[FeatureFamily.PRICE_SHAPE]
        near_vec = different_shape_near.extract(0, 12).vector[FeatureFamily.PRICE_SHAPE]

        sim_far = per_family_similarity(ref_vec, far_vec)
        sim_near = per_family_similarity(ref_vec, near_vec)

        assert sim_far > sim_near, (
            f"expected the same relative shape at a different level/bar-count ({sim_far}) "
            f"to score more similar than a different shape at the reference's own "
            f"level/bar-count ({sim_near})"
        )
        assert sim_far > 0.9, f"expected near-identical shapes to score close to 1.0, got {sim_far}"

    def test_very_short_window_has_no_available_families_at_all(self) -> None:
        extractor = SimilarityFeatureExtractor(PanelFrame.from_bars(_bars("ONEBAR", [100.0])).frame)

        features = extractor.extract(0, 1)

        assert (
            features.vector == {}
        ), f"expected a 1-bar window to compute nothing, got {features.vector}"
        assert set(features.unavailable) == set(
            FeatureFamily
        ), f"expected every family named unavailable for a 1-bar window, got {features.unavailable}"


# ---- AC12: explicit per-family degradation on the reference -----------


class TestReferenceDegradation:
    def _early_window_features(self) -> WindowFeatures:
        bars = _bars("EARLY", _wave(100.0, 30))
        extractor = SimilarityFeatureExtractor(PanelFrame.from_bars(bars).frame)
        return extractor.extract(0, 3)  # positions 0-2: too early for sma(close,5)/sma(volume,10)

    def test_window_too_early_for_studies_warmup_omits_studies_not_zeroes_it(self) -> None:
        features = self._early_window_features()

        assert FeatureFamily.STUDIES in features.unavailable, (
            f"expected studies excluded for a window inside its own warm-up period, "
            f"got unavailable={features.unavailable}"
        )
        assert FeatureFamily.STUDIES not in features.vector
        # The other four bar-count-only-gated families ARE available at 3 bars.
        assert FeatureFamily.PRICE_SHAPE in features.vector
        assert FeatureFamily.VOLATILITY in features.vector

    def test_search_names_the_degraded_family_in_warnings_and_still_reconciles(self) -> None:
        bars = _bars("EARLY", _wave(100.0, 30)) + _bars("OTHER2", _wave(120.0, 30, phase=1.0))
        engine = _engine(bars)
        window = WindowRef(start=date(2024, 1, 1), end=date(2024, 1, 3), timeframe="1d")

        run = engine.search(instrument_id="EARLY", window=window, scope="cross_instrument")

        assert any("studies" in w for w in run.warnings), (
            f"expected a warning naming 'studies' as excluded for insufficient history, "
            f"got {run.warnings}"
        )
        assert (
            run.candidates
        ), "expected at least one candidate from OTHER2's matching-length window"
        explanation = engine.explain(run.run_id, run.candidates[0].candidate_id)
        assert FeatureFamily.STUDIES not in explanation.contributions
        assert explanation.reconciles(), (
            f"expected contributions to still reconcile to the overall score with a "
            f"family excluded, got {explanation.contributions} vs {explanation.overall_score}"
        )


# ---- AC3/AC4/AC5: search, scope, self-exclusion ------------------------


class TestSearchScopeAndExclusion:
    def test_candidates_are_ranked_descending_with_stable_unique_ids(self) -> None:
        engine = _shared_panel_engine()

        run = engine.search(instrument_id="REF", window=_REF_WINDOW, scope="both")

        scores = [c.score for c in run.candidates]
        assert scores == sorted(scores, reverse=True), f"expected descending scores, got {scores}"
        ids = [c.candidate_id for c in run.candidates]
        assert len(ids) == len(set(ids)), f"expected unique candidate IDs, got {ids}"
        assert all(cid.startswith(run.run_id + "_candidate_") for cid in ids)

    def test_cross_instrument_scope_returns_only_other_instruments(self) -> None:
        engine = _shared_panel_engine()

        run = engine.search(instrument_id="REF", window=_REF_WINDOW, scope="cross_instrument")

        assert run.scope == "cross_instrument"
        assert run.candidates, "expected OTHER's matching-length windows as candidates"
        assert all(c.instrument.instrument_id == "OTHER" for c in run.candidates)

    def test_same_instrument_scope_returns_only_the_same_instrument(self) -> None:
        engine = _shared_panel_engine()

        run = engine.search(
            instrument_id="REF", window=_REF_WINDOW, scope="same_instrument_windows"
        )

        assert run.scope == "same_instrument_windows"
        assert run.candidates, "expected other windows of REF's own history as candidates"
        assert all(c.instrument.instrument_id == "REF" for c in run.candidates)

    def test_same_instrument_scope_excludes_reference_window_and_overlaps(self) -> None:
        engine = _shared_panel_engine()

        run = engine.search(
            instrument_id="REF", window=_REF_WINDOW, scope="same_instrument_windows"
        )

        for candidate in run.candidates:
            overlaps = (
                candidate.window.start <= _REF_WINDOW.end
                and candidate.window.end >= _REF_WINDOW.start
            )
            assert not overlaps, (
                f"candidate window {candidate.window.start}..{candidate.window.end} overlaps "
                f"the reference window {_REF_WINDOW.start}..{_REF_WINDOW.end} and must be excluded"
            )


# ---- AC6: weight sets change ranking -----------------------------------


class TestWeightsChangeRanking:
    def _panel(self) -> list[PriceBar]:
        ref_closes = _wave(100.0, 20, period=10.0, amplitude=0.05)
        ref_volumes = _wave(1_000_000.0, 20, period=6.0, amplitude=0.4)
        # MATCH_PRICE: same price wave (period/amplitude/phase) as REF, but a
        # volume profile that shares nothing with REF's oscillation.
        match_price_closes = _wave(500.0, 20, period=10.0, amplitude=0.05)
        match_price_volumes = _ramp(500_000.0, 20, step=50_000.0)
        # MATCH_VOLUME: same volume wave as REF, but a price series that
        # shares nothing with REF's oscillation.
        match_volume_closes = _ramp(200.0, 20, step=5.0)
        match_volume_volumes = _wave(2_000_000.0, 20, period=6.0, amplitude=0.4)
        return (
            _bars("REF3", ref_closes, ref_volumes)
            + _bars("MATCH_PRICE", match_price_closes, match_price_volumes)
            + _bars("MATCH_VOLUME", match_volume_closes, match_volume_volumes)
        )

    def _weights_favoring(self, family: str) -> FeatureWeightSet:
        zero = {f.value: 0.0 for f in FeatureFamily}
        zero[family] = 1.0
        return FeatureWeightSet.from_partial(zero)

    def test_weight_set_favoring_price_shape_vs_volume_flips_the_top_candidate(self) -> None:
        engine = _engine(self._panel())
        window = WindowRef(start=date(2024, 1, 1), end=date(2024, 1, 20), timeframe="1d")

        price_run = engine.search(
            instrument_id="REF3",
            window=window,
            scope="cross_instrument",
            weights=self._weights_favoring("price_shape"),
        )
        volume_run = engine.search(
            instrument_id="REF3",
            window=window,
            scope="cross_instrument",
            weights=self._weights_favoring("volume"),
        )

        assert price_run.candidates[0].instrument.instrument_id == "MATCH_PRICE", (
            f"expected MATCH_PRICE to rank first when only price_shape is weighted, "
            f"got {[c.instrument.instrument_id for c in price_run.candidates]}"
        )
        assert volume_run.candidates[0].instrument.instrument_id == "MATCH_VOLUME", (
            f"expected MATCH_VOLUME to rank first when only volume is weighted, "
            f"got {[c.instrument.instrument_id for c in volume_run.candidates]}"
        )
        assert price_run.weights.weights[FeatureFamily.PRICE_SHAPE] == 1.0
        assert volume_run.weights.weights[FeatureFamily.VOLUME] == 1.0


# ---- AC7: bounded results, no padding ----------------------------------


class TestBoundedResults:
    def test_limit_caps_candidate_count(self) -> None:
        engine = _shared_panel_engine()

        run = engine.search(instrument_id="REF", window=_REF_WINDOW, scope="both", limit=2)

        assert len(run.candidates) <= 2, f"expected at most 2 candidates, got {len(run.candidates)}"

    def test_min_score_excludes_rather_than_pads(self) -> None:
        engine = _shared_panel_engine()

        run = engine.search(
            instrument_id="REF", window=_REF_WINDOW, scope="both", limit=50, min_score=0.999999
        )

        assert run.candidates == [], (
            f"expected an impossibly high min_score to exclude every candidate rather than "
            f"padding, got {len(run.candidates)}"
        )
        assert all(c.score >= 0.999999 for c in run.candidates)


# ---- AC8/AC9: pinning and explanation -----------------------------------


class TestRunPinningAndExplanation:
    def test_get_run_returns_identical_candidates_without_recomputing(self) -> None:
        engine = _shared_panel_engine()
        run = engine.search(instrument_id="REF", window=_REF_WINDOW, scope="both")

        fetched = engine.get_run(run.run_id)

        assert fetched == run, "expected get_run to return the exact pinned run, unchanged"

    def test_get_run_unknown_id_raises(self) -> None:
        engine = _shared_panel_engine()

        with pytest.raises(SimilarityRunNotFoundError):
            engine.get_run("no-such-run")

    def test_explanation_reconciles_to_the_candidate_score(self) -> None:
        engine = _shared_panel_engine()
        run = engine.search(instrument_id="REF", window=_REF_WINDOW, scope="both")
        candidate = run.candidates[0]

        explanation = engine.explain(run.run_id, candidate.candidate_id)

        assert explanation.candidate_id == candidate.candidate_id
        assert explanation.overall_score == pytest.approx(candidate.score)
        assert explanation.reconciles(), (
            f"expected contributions {explanation.contributions} to sum to "
            f"{explanation.overall_score}"
        )

    def test_explain_unknown_run_raises(self) -> None:
        engine = _shared_panel_engine()

        with pytest.raises(SimilarityRunNotFoundError):
            engine.explain("no-such-run", "whatever")

    def test_explain_unknown_candidate_raises(self) -> None:
        engine = _shared_panel_engine()
        run = engine.search(instrument_id="REF", window=_REF_WINDOW, scope="both")

        with pytest.raises(SimilarityCandidateNotFoundError):
            engine.explain(run.run_id, "not-a-real-candidate")


# ---- AC10: provenance ---------------------------------------------------


class TestProvenance:
    def test_provenance_is_sourced_from_the_panel_status_not_hardcoded(self) -> None:
        status = _status(source="object-store", as_of=date(2024, 3, 15))
        engine = _engine(
            _bars("REF", _REF_CLOSES, _REF_VOLUMES) + _bars("OTHER", _OTHER_CLOSES, _OTHER_VOLUMES),
            status,
        )

        run = engine.search(instrument_id="REF", window=_REF_WINDOW, scope="cross_instrument")

        assert run.provenance.as_of.date() == date(2024, 3, 15)
        assert "object-store" in run.provenance.source_id
        assert run.provenance.liveness == "historical"
        assert run.provenance.price_adjustment == "adjusted"
        assert run.provenance.engine_version == SIMILARITY_ENGINE_VERSION

        mock_status = _status(source="mock", as_of=date(2024, 3, 15))
        mock_engine = _engine(
            _bars("REF", _REF_CLOSES, _REF_VOLUMES) + _bars("OTHER", _OTHER_CLOSES, _OTHER_VOLUMES),
            mock_status,
        )
        mock_run = mock_engine.search(
            instrument_id="REF", window=_REF_WINDOW, scope="cross_instrument"
        )
        assert mock_run.provenance.source_label != run.provenance.source_label, (
            "expected the source label to differ between a mock and an object-store panel "
            "status, not a hardcoded constant"
        )


# ---- AC11: empty results are warned, not errored -----------------------


class TestEmptyResultsAreWarnedNotErrored:
    def test_empty_universe_returns_empty_run_with_warning(self) -> None:
        engine = _engine(_bars("REF", _REF_CLOSES, _REF_VOLUMES))  # no other ticker at all

        run = engine.search(instrument_id="REF", window=_REF_WINDOW, scope="cross_instrument")

        assert run.candidates == []
        assert run.warnings, "expected a warning explaining the empty result"
        assert any("no eligible" in w.lower() for w in run.warnings)

    def test_all_candidates_below_minimum_score_returns_empty_run_with_warning(self) -> None:
        engine = _shared_panel_engine()

        run = engine.search(
            instrument_id="REF", window=_REF_WINDOW, scope="both", min_score=0.999999
        )

        assert run.candidates == []
        assert run.warnings
        assert any("minimum score" in w.lower() for w in run.warnings)

    def test_reference_with_no_history_raises_rather_than_returning_empty_run(self) -> None:
        engine = _shared_panel_engine()
        window = WindowRef(start=date(2030, 1, 1), end=date(2030, 1, 5), timeframe="1d")

        with pytest.raises(SimilarityReferenceUnavailableError):
            engine.search(instrument_id="REF", window=window, scope="both")


# ---- AC13: domain contract imports nothing from infra -------------------


class TestDomainContractPurity:
    def test_similarity_engine_protocol_module_imports_nothing_from_infra(self) -> None:
        import domain.contracts.similarity_engine as module

        tree = ast.parse(open(module.__file__).read())
        imported_modules = [
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        ] + [node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]

        infra_imports = [name for name in imported_modules if name.split(".")[0] == "infra"]
        assert infra_imports == [], f"domain/contracts must not import infra, found {infra_imports}"
