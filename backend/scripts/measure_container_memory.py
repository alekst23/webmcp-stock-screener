"""Measure absolute whole-process RSS, stage by stage, against the real
deployed panel -- meant to be run *inside* the deployed container image
(T-0016-9), not on a development machine.

`measure_universe_scale.py` takes a baseline reading after imports and the
panel are already on disk, then reports every later figure as a delta from
that baseline. `ru_maxrss` is a high-water mark that never falls within a
process, so that subtraction produces "how much this stage added since an
already-late point," not the absolute number a container's cgroup memory
limit enforces. That earlier mistake is exactly what the project's blocker
table records against a 688 MB figure that was really 723 MB. This script
reports every stage as the raw, un-subtracted reading instead -- each number
already includes every prior stage's cost, which is also why the stages must
run in a fixed order in a single process rather than independently.

    uv run python scripts/measure_container_memory.py --pattern simple
    uv run python scripts/measure_container_memory.py --pattern complex

Requires OBJECT_STORE_BUCKET (and whatever the boto3 credential chain needs)
in the environment, pointed at the real panel -- there is no synthetic
fallback here, unlike measure_universe_scale.py. Each pattern must be run as
a separate process invocation: peak RSS never decreases within a process, so
measuring both patterns in one run would let the first one's peak leak into
the second's number.
"""

from __future__ import annotations

import argparse
import gc
import json
import resource
import sys
import time
from pathlib import Path
from typing import Any, cast

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Two shapes deliberately: AC5 requires quantifying how much of the peak is
# attributable to expression complexity rather than just asserting it, so
# both patterns run against the identical panel and identical pipeline up to
# "before search," differing only in the setup passed to find_instances.
_SIMPLE_STUDIES: dict[str, str] = {}
_SIMPLE_STEPS: list[dict[str, Any]] = [{"condition": "close > sma(close, 50)"}]

# A plausible research pattern, not the simplest expression that will run:
# a volume-spike anchor, an uptrend-confirmation window, then a breakout
# confirmation -- 3 steps referencing 4 studies, matching the epic's
# "3-step/4-study" reference figure so this run is comparable to it.
_COMPLEX_STUDIES: dict[str, str] = {
    "rel_volume": "volume / sma(volume, 20)",
    "trend200": "close - sma(close, 200)",
    "momentum12": "close - ema(close, 12)",
    "vol_atr": "atr(14)",
}
_COMPLEX_STEPS: list[dict[str, Any]] = [
    {"condition": "rel_volume > 3"},
    {"condition": "trend200 > 0 and momentum12 > 0", "within": (1, 10)},
    {"condition": "close > highest(high, 20) and vol_atr > 0", "within": (1, 15)},
]

_PATTERNS: dict[str, tuple[dict[str, str], list[dict[str, Any]]]] = {
    "simple": (_SIMPLE_STUDIES, _SIMPLE_STEPS),
    "complex": (_COMPLEX_STUDIES, _COMPLEX_STEPS),
}

_PANEL_KEY = "panel.parquet"


def rss_bytes() -> int:
    """Absolute high-water-mark RSS of the whole process so far, never a
    delta -- AC1/AC7. Linux (the container's platform) reports kilobytes,
    macOS bytes."""
    peak = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return peak if sys.platform == "darwin" else peak * 1024


def _stage_libraries() -> None:
    """Third-party stack the app depends on, imported together as one
    stage because that is how the blocker table's own breakdown groups
    them (interpreter -> +libs -> +app imports)."""
    import boto3  # noqa: F401
    import numpy  # noqa: F401
    import pandas  # noqa: F401
    import pyarrow  # noqa: F401


def _stage_app_imports() -> dict[str, Any]:
    from domain.models.pattern import SetupStep, Study
    from infra.object_store import S3PanelStore, config_from_env
    from infra.pandas_engine import PandasPatternResearchEngine
    from infra.panel_frame import PanelFrame
    from infra.panel_io import parquet_bytes_to_panel

    return {
        "SetupStep": SetupStep,
        "Study": Study,
        "S3PanelStore": S3PanelStore,
        "config_from_env": config_from_env,
        "PandasPatternResearchEngine": PandasPatternResearchEngine,
        "PanelFrame": PanelFrame,
        "parquet_bytes_to_panel": parquet_bytes_to_panel,
    }


def _fetch_real_panel(mods: dict[str, Any]) -> bytes:
    config = mods["config_from_env"]()
    if config is None:
        raise SystemExit(
            "OBJECT_STORE_BUCKET is unset -- this script measures the real deployed panel "
            "only; it has no synthetic fallback (unlike measure_universe_scale.py)."
        )
    store = mods["S3PanelStore"](config)
    store.ensure_reachable()
    return cast(bytes, store.get_object(_PANEL_KEY))


def _build_setup(mods: dict[str, Any], engine: Any, pattern: str) -> Any:
    studies, steps = _PATTERNS[pattern]
    for name, expression in studies.items():
        engine.define_study(name, expression)
    setup_steps = [mods["SetupStep"](**step) for step in steps]
    return engine.define_setup(f"container_measure_{pattern}", setup_steps)


def measure(pattern: str, ceiling_bytes: int) -> dict[str, object]:
    stages: dict[str, int] = {"interpreter": rss_bytes()}

    _stage_libraries()
    stages["libraries"] = rss_bytes()

    mods = _stage_app_imports()
    stages["app_imports"] = rss_bytes()

    started = time.perf_counter()
    data = _fetch_real_panel(mods)
    fetch_seconds = round(time.perf_counter() - started, 2)
    stages["panel_read"] = rss_bytes()

    started = time.perf_counter()
    frame = mods["parquet_bytes_to_panel"](data)
    parse_seconds = round(time.perf_counter() - started, 2)
    stages["parsed"] = rss_bytes()

    resident_bytes = int(frame.memory_usage(deep=True).sum())
    row_count = int(len(frame))
    ticker_count = int(frame["ticker"].nunique())
    date_min = int(frame["date"].min())
    date_max = int(frame["date"].max())

    engine = mods["PandasPatternResearchEngine"](mods["PanelFrame"](frame))
    setup = _build_setup(mods, engine, pattern)
    gc.collect()
    stages["before_search"] = rss_bytes()

    started = time.perf_counter()
    result = engine.find_instances(setup)
    search_seconds = round(time.perf_counter() - started, 2)
    stages["peak_during_search"] = rss_bytes()

    peak = stages["peak_during_search"]
    headroom_bytes = ceiling_bytes - peak
    return {
        "pattern": pattern,
        "panel_bytes_compressed": len(data),
        "panel_rows": row_count,
        "panel_tickers": ticker_count,
        "panel_date_ordinal_min": date_min,
        "panel_date_ordinal_max": date_max,
        "panel_resident_bytes": resident_bytes,
        "fetch_seconds": fetch_seconds,
        "parse_seconds": parse_seconds,
        "search_seconds": search_seconds,
        "anchors": result.complete_count + result.partial_count,
        "matches": result.complete_count,
        "stages_absolute_rss_bytes": stages,
        "ceiling_bytes": ceiling_bytes,
        "headroom_bytes": headroom_bytes,
        "headroom_pct": round(100 * headroom_bytes / ceiling_bytes, 1),
        "fits_ceiling": headroom_bytes > 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pattern", choices=sorted(_PATTERNS), required=True)
    parser.add_argument(
        "--ceiling-bytes",
        type=int,
        default=2 * 1024**3,
        help="Configured memory ceiling to report headroom against (default: 2 GiB).",
    )
    args = parser.parse_args()
    print(json.dumps(measure(args.pattern, args.ceiling_bytes), indent=2))


if __name__ == "__main__":
    main()
