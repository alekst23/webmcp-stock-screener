"""Feature extraction for the similarity engine (EPIC-1012 T-1012-2).

Turns a contiguous row range of the loaded price panel into a
`domain.models.similarity.FeatureVector` -- one fixed-length embedding per
available feature family. A family is OMITTED from the returned dict (never
scored as zero) when the window carries too little history to compute it;
`domain.models.similarity.score_candidate` already treats a family present in
only one of the two vectors being compared as unavailable and excludes it
from the weighted score, renormalizing over what remains -- that mechanism is
what T-1012-2's AC12 degradation path relies on, so this module's only job is
to omit honestly, not to invent a placeholder value.

Price-shape and volume are resampled to a fixed number of points via linear
interpolation over the window's normalized [0, 1] position (`_resample`) --
this is what makes AC2 hold: a window's shape embedding has the same length
regardless of how many bars it covers, and is computed from a
percent-change/relative-to-mean series rather than the raw absolute values,
so it does not depend on the instrument's price level or share-volume scale
either. Relative strength has no data source yet (no EPIC-1008 reference-data
port exists in this codebase as of this ticket -- confirmed by grep) and is
always omitted; a future port only has to start supplying it, no engine
change required.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from domain.models.similarity import FeatureFamily, FeatureVector
from infra.expression import ExpressionEvaluator
from infra.panel_frame import float_column

# Points a shape/profile embedding is resampled to. Fixed across every
# window regardless of its own bar count -- this equal length is what lets
# `per_family_similarity` compare a 6-bar window against a 40-bar one.
_SHAPE_POINTS = 12
_STUDY_POINTS = 6

# The two derived-series ratios the "studies" family is built from, evaluated
# once panel-wide via infra/expression.py's vectorized evaluator rather than
# per-candidate -- exactly the reusable technique T-1012-2's design
# references call out. Both need a `min_periods` history before they are
# defined, which is what makes an early-panel window degrade this family via
# the NaN check in `_windowed_resample`, rather than silently.
STUDY_EXPRESSIONS: tuple[str, ...] = ("close / sma(close, 5)", "volume / sma(volume, 10)")

# Bars strictly required to say a family means anything at all: one return,
# one gap, one body -- fewer than this and the family is omitted rather than
# computed from a single degenerate point.
_MIN_BARS_FOR_SHAPE = 2


def _resample(values: np.ndarray, n_points: int) -> tuple[float, ...]:
    """Linearly interpolates `values` onto `n_points` evenly spaced samples
    over its own normalized index -- a fixed-length embedding independent of
    how many bars `values` actually holds."""
    if len(values) == 1:
        return tuple(float(values[0]) for _ in range(n_points))
    x_old = np.linspace(0.0, 1.0, num=len(values))
    x_new = np.linspace(0.0, 1.0, num=n_points)
    return tuple(float(v) for v in np.interp(x_new, x_old, values))


def _price_shape(closes: np.ndarray) -> tuple[float, ...] | None:
    if len(closes) < _MIN_BARS_FOR_SHAPE or closes[0] == 0:
        return None
    pct_change_from_start = (closes - closes[0]) / closes[0]
    return _resample(pct_change_from_start, _SHAPE_POINTS)


def _volume_shape(volumes: np.ndarray) -> tuple[float, ...] | None:
    if len(volumes) < _MIN_BARS_FOR_SHAPE:
        return None
    mean_volume = float(volumes.mean())
    if mean_volume <= 0:
        return None
    return _resample(volumes / mean_volume, _SHAPE_POINTS)


def _volatility(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray
) -> tuple[float, ...] | None:
    if len(closes) < _MIN_BARS_FOR_SHAPE:
        return None
    returns = np.diff(closes) / closes[:-1]
    ranges = (highs - lows) / closes
    if not (np.all(np.isfinite(returns)) and np.all(np.isfinite(ranges))):
        return None
    return (float(np.std(returns)), float(np.mean(np.abs(returns))), float(np.mean(ranges)))


def _pattern_structure(opens: np.ndarray, closes: np.ndarray) -> tuple[float, ...] | None:
    if len(closes) < _MIN_BARS_FOR_SHAPE:
        return None
    prev_close = closes[:-1]
    if not np.all(prev_close != 0) or not np.all(closes != 0):
        return None
    up_day_fraction = float(np.mean(np.diff(closes) > 0))
    gap = (opens[1:] - prev_close) / prev_close
    gap_up_fraction = float(np.mean(gap > 0.005))
    body_to_range = np.abs(closes - opens) / closes
    return (up_day_fraction, gap_up_fraction, float(np.mean(body_to_range)))


def _windowed_study_points(series: np.ndarray, start: int, end: int) -> tuple[float, ...] | None:
    window = series[start:end]
    if len(window) < _MIN_BARS_FOR_SHAPE or not np.all(np.isfinite(window)):
        return None
    return _resample(window, _STUDY_POINTS)


@dataclass(frozen=True)
class WindowFeatures:
    """One window's feature vector plus which of the six families could not
    be computed from it -- surfaced separately from the vector itself so a
    caller can report *why* a family is missing (AC12) without having to
    infer it from an absent dict key."""

    vector: FeatureVector
    unavailable: tuple[FeatureFamily, ...]


class SimilarityFeatureExtractor:
    """Precomputes the panel-wide arrays every window's features are sliced
    from -- one pass over the whole panel, not one per candidate. Row
    positions are absolute indices into the same `PanelFrame` the caller
    resolved ticker row ranges from."""

    def __init__(self, panel: pd.DataFrame) -> None:
        self._opens = float_column(panel, "open").to_numpy()
        self._highs = float_column(panel, "high").to_numpy()
        self._lows = float_column(panel, "low").to_numpy()
        self._closes = float_column(panel, "close").to_numpy()
        self._volumes = float_column(panel, "volume").to_numpy()
        evaluator = ExpressionEvaluator(panel, {})
        self._study_series = tuple(
            evaluator.evaluate(expression).to_numpy() for expression in STUDY_EXPRESSIONS
        )

    def extract(self, start: int, end: int) -> WindowFeatures:
        """Features for the row range [start, end) -- `end` exclusive,
        matching Python slice convention. Omits any family the window is too
        short, or too early in its ticker's history (studies), to support."""
        closes = self._closes[start:end]
        opens = self._opens[start:end]
        highs = self._highs[start:end]
        lows = self._lows[start:end]
        volumes = self._volumes[start:end]

        candidates: dict[FeatureFamily, tuple[float, ...] | None] = {
            FeatureFamily.PRICE_SHAPE: _price_shape(closes),
            FeatureFamily.VOLUME: _volume_shape(volumes),
            FeatureFamily.VOLATILITY: _volatility(closes, highs, lows),
            FeatureFamily.RELATIVE_STRENGTH: None,  # no reference-data port available yet
            FeatureFamily.STUDIES: self._studies(start, end),
            FeatureFamily.PATTERN_STRUCTURE: _pattern_structure(opens, closes),
        }
        vector: FeatureVector = {
            family: values for family, values in candidates.items() if values is not None
        }
        unavailable = tuple(family for family, values in candidates.items() if values is None)
        return WindowFeatures(vector=vector, unavailable=unavailable)

    def _studies(self, start: int, end: int) -> tuple[float, ...] | None:
        parts: list[float] = []
        for series in self._study_series:
            points = _windowed_study_points(series, start, end)
            if points is None:
                return None
            parts.extend(points)
        return tuple(parts)
