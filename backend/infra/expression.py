"""Safe parser/evaluator for study and setup-step expressions.

Expressions reference price/volume fields (`open`, `high`, `low`, `close`,
`volume`), previously-defined studies by name, numeric literals, arithmetic
(`+ - * /`), comparisons, boolean combinators, and a fixed function catalog
(`sma`, `ema`, `atr`, `highest`, `lowest`, `days_since`). Parsing goes
through Python's `ast` module restricted to a small node-type whitelist so
evaluation never runs arbitrary code — this is a safety boundary, not a
language limitation.

`highest`/`lowest` deliberately look back over the `n` bars STRICTLY BEFORE
the current bar (today's own value never counts toward its own
"highest/lowest N"): a breakout is conventionally "today closes above the
highest high of the preceding N days," which would be tautological if today
were included. `sma`/`ema` include the current bar, matching the usual
"N-day moving average as of today" meaning. This distinction is a query
engine judgment call the acceptance criteria doesn't pin down, documented
here for whoever next touches it.
"""

from __future__ import annotations

import ast
from typing import Callable

import numpy as np
import pandas as pd

from domain.errors import ExpressionError

FUNCTION_CATALOG: list[str] = ["sma", "ema", "atr", "highest", "lowest", "days_since"]
BASE_FIELDS: frozenset[str] = frozenset({"open", "high", "low", "close", "volume"})

# Which argument (0-based) of each function must be an integer literal window size.
_WINDOW_ARG_INDEX: dict[str, int] = {"sma": 1, "ema": 1, "highest": 1, "lowest": 1, "atr": 0}
_FUNCTION_ARITY: dict[str, int] = {name: idx + 1 for name, idx in _WINDOW_ARG_INDEX.items()}
_FUNCTION_ARITY["days_since"] = 1

_ALLOWED_BINOPS: tuple[type[ast.operator], ...] = (ast.Add, ast.Sub, ast.Mult, ast.Div)
_ALLOWED_CMPOPS: tuple[type[ast.cmpop], ...] = (
    ast.Gt,
    ast.Lt,
    ast.GtE,
    ast.LtE,
    ast.Eq,
    ast.NotEq,
)
_ALLOWED_BOOLOPS: tuple[type[ast.boolop], ...] = (ast.And, ast.Or)
_ALLOWED_UNARYOPS: tuple[type[ast.unaryop], ...] = (ast.UAdd, ast.USub, ast.Not)

_COMPARE_FUNCS: dict[type[ast.cmpop], Callable[[object, object], object]] = {
    ast.Gt: lambda a, b: a > b,
    ast.Lt: lambda a, b: a < b,
    ast.GtE: lambda a, b: a >= b,
    ast.LtE: lambda a, b: a <= b,
    ast.Eq: lambda a, b: a == b,
    ast.NotEq: lambda a, b: a != b,
}
_BINOP_FUNCS: dict[type[ast.operator], Callable[[object, object], object]] = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
}


def _error(expression: str, detail: str) -> ExpressionError:
    return ExpressionError(f'expression "{expression}" {detail}', list(FUNCTION_CATALOG))


def parse_expression(expression: str, known_names: frozenset[str]) -> ast.Expression:
    """Parse and validate `expression`, raising ExpressionError (carrying the
    full function catalog) on anything unsupported so a caller — human or
    agent — can self-correct in one turn (AC2)."""
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise _error(expression, f"is not valid syntax: {exc.msg}") from exc
    for node in ast.walk(tree):
        _validate_node(node, expression, known_names)
    return tree


def _validate_node(node: ast.AST, expression: str, known_names: frozenset[str]) -> None:
    if isinstance(node, ast.Call):
        _validate_call(node, expression)
    elif isinstance(node, ast.Name):
        # Also visited standalone when it's a Call's func (e.g. the "sma" in
        # "sma(close, 5)") — _validate_call already checked that case fully.
        if node.id not in known_names and node.id not in FUNCTION_CATALOG:
            raise _error(expression, f'references an unsupported name "{node.id}"')
    elif isinstance(node, ast.BinOp):
        if not isinstance(node.op, _ALLOWED_BINOPS):
            raise _error(expression, "uses an unsupported arithmetic operator")
    elif isinstance(node, ast.Compare):
        if any(not isinstance(op, _ALLOWED_CMPOPS) for op in node.ops):
            raise _error(expression, "uses an unsupported comparison operator")
    elif isinstance(node, ast.BoolOp):
        if not isinstance(node.op, _ALLOWED_BOOLOPS):
            raise _error(expression, "uses an unsupported boolean operator")
    elif isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, _ALLOWED_UNARYOPS):
            raise _error(expression, "uses an unsupported unary operator")
    elif isinstance(node, ast.Constant):
        if not isinstance(node.value, (int, float)) or isinstance(node.value, bool):
            raise _error(expression, "uses an unsupported literal (only numbers are allowed)")
    elif isinstance(node, (ast.Expression, ast.Load)):
        pass
    elif isinstance(node, (ast.operator, ast.cmpop, ast.boolop, ast.unaryop)):
        pass  # the operator token itself; its parent node validated it above
    else:
        raise _error(expression, f"uses unsupported syntax ({type(node).__name__})")


def _validate_call(node: ast.Call, expression: str) -> None:
    if not isinstance(node.func, ast.Name):
        raise _error(expression, "calls something that is not a plain function name")
    name = node.func.id
    if name not in FUNCTION_CATALOG:
        raise _error(expression, f'uses unsupported function "{name}"')
    if node.keywords:
        raise _error(expression, f'passes keyword arguments to "{name}", which is not supported')
    expected = _FUNCTION_ARITY[name]
    if len(node.args) != expected:
        raise _error(
            expression, f'calls "{name}" with {len(node.args)} argument(s), expected {expected}'
        )
    window_arg = node.args[_WINDOW_ARG_INDEX[name]]
    if not _is_int_literal(window_arg):
        raise _error(expression, f'"{name}"\'s window argument must be an integer literal')


def _is_int_literal(node: ast.expr) -> bool:
    return isinstance(node, ast.Constant) and isinstance(node.value, int)


def _int_literal(node: ast.expr) -> int:
    assert isinstance(node, ast.Constant) and isinstance(node.value, int), "validated at parse"
    return node.value


class ExpressionEvaluator:
    """Evaluates a validated expression into a per-row Series aligned to
    `panel`'s index (a DataFrame with an `open/high/low/close/volume` and
    `ticker` column, sorted by ticker then date). Rolling/lookback functions
    are grouped by ticker so history never leaks across ticker boundaries."""

    def __init__(self, panel: pd.DataFrame, studies: dict[str, str]) -> None:
        self._panel = panel
        self._studies = studies  # study name -> its expression string
        self._by_ticker = panel["ticker"]

    def evaluate(self, expression: str, _stack: tuple[str, ...] = ()) -> pd.Series:
        known = BASE_FIELDS | set(self._studies)
        tree = parse_expression(expression, known)
        return self._eval_node(tree.body, _stack)

    def evaluate_condition(self, expression: str) -> pd.Series:
        """Like `evaluate`, but coerced to a boolean Series with NaN (not
        enough history yet) treated as not-satisfied."""
        return self._as_bool_series(self.evaluate(expression))

    def _eval_node(self, node: ast.expr, stack: tuple[str, ...]) -> pd.Series | float:
        if isinstance(node, ast.Constant):
            return float(node.value)
        if isinstance(node, ast.Name):
            return self._resolve_name(node.id, stack)
        if isinstance(node, ast.BinOp):
            left = self._eval_node(node.left, stack)
            right = self._eval_node(node.right, stack)
            return _BINOP_FUNCS[type(node.op)](left, right)  # type: ignore[return-value]
        if isinstance(node, ast.UnaryOp):
            return self._eval_unaryop(node, stack)
        if isinstance(node, ast.BoolOp):
            return self._eval_boolop(node, stack)
        if isinstance(node, ast.Compare):
            return self._eval_compare(node, stack)
        if isinstance(node, ast.Call):
            return self._eval_call(node, stack)
        raise ExpressionError(
            f"cannot evaluate node type {type(node).__name__}", list(FUNCTION_CATALOG)
        )

    def _resolve_name(self, name: str, stack: tuple[str, ...]) -> pd.Series:
        if name in BASE_FIELDS:
            return self._panel[name].astype(float)
        if name in stack:
            raise ExpressionError(
                f'study "{name}" is defined in terms of itself', list(FUNCTION_CATALOG)
            )
        if name in self._studies:
            return self.evaluate(self._studies[name], stack + (name,))
        raise ExpressionError(f'unknown name "{name}"', list(FUNCTION_CATALOG))

    def _eval_unaryop(self, node: ast.UnaryOp, stack: tuple[str, ...]) -> pd.Series | float:
        value = self._eval_node(node.operand, stack)
        if isinstance(node.op, ast.USub):
            return -value
        if isinstance(node.op, ast.UAdd):
            return value
        return ~self._as_bool_series(value)

    def _eval_boolop(self, node: ast.BoolOp, stack: tuple[str, ...]) -> pd.Series:
        values = [self._as_bool_series(self._eval_node(v, stack)) for v in node.values]
        combine = (lambda a, b: a & b) if isinstance(node.op, ast.And) else (lambda a, b: a | b)
        result = values[0]
        for value in values[1:]:
            result = combine(result, value)
        return result

    def _eval_compare(self, node: ast.Compare, stack: tuple[str, ...]) -> pd.Series:
        current_left = self._eval_node(node.left, stack)
        result: pd.Series | None = None
        for op, comparator in zip(node.ops, node.comparators):
            right = self._eval_node(comparator, stack)
            part = self._as_bool_series(_COMPARE_FUNCS[type(op)](current_left, right))
            result = part if result is None else (result & part)
            current_left = right
        assert result is not None, "ast.Compare always has at least one comparator"
        return result

    def _eval_call(self, node: ast.Call, stack: tuple[str, ...]) -> pd.Series:
        assert isinstance(node.func, ast.Name), "validated at parse"
        name = node.func.id
        if name == "sma":
            series = self._eval_node(node.args[0], stack)
            n = _int_literal(node.args[1])
            return self._grouped(series).transform(
                lambda s: s.rolling(n, min_periods=n).mean()
            )
        if name == "ema":
            series = self._eval_node(node.args[0], stack)
            n = _int_literal(node.args[1])
            return self._grouped(series).transform(
                lambda s: s.ewm(span=n, adjust=False, min_periods=n).mean()
            )
        if name == "highest":
            return self._lookback(self._eval_node(node.args[0], stack), node.args[1], "max")
        if name == "lowest":
            return self._lookback(self._eval_node(node.args[0], stack), node.args[1], "min")
        if name == "atr":
            return self._atr(_int_literal(node.args[0]))
        if name == "days_since":
            condition = self._as_bool_series(self._eval_node(node.args[0], stack))
            return self._days_since(condition)
        raise ExpressionError(f'uses unsupported function "{name}"', list(FUNCTION_CATALOG))

    def _grouped(self, series: pd.Series) -> "pd.core.groupby.generic.SeriesGroupBy":
        return series.groupby(self._by_ticker)

    def _lookback(self, series: pd.Series, n_node: ast.expr, how: str) -> pd.Series:
        n = _int_literal(n_node)
        grouped = self._grouped(series)
        if how == "max":
            return grouped.transform(lambda s: s.shift(1).rolling(n, min_periods=n).max())
        return grouped.transform(lambda s: s.shift(1).rolling(n, min_periods=n).min())

    def _atr(self, n: int) -> pd.Series:
        high, low, close = self._panel["high"], self._panel["low"], self._panel["close"]
        prev_close = self._grouped(close).transform(lambda s: s.shift(1))
        true_range = pd.concat(
            [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
        ).max(axis=1)
        return self._grouped(true_range).transform(lambda s: s.rolling(n, min_periods=n).mean())

    def _days_since(self, condition: pd.Series) -> pd.Series:
        """Trading days since `condition` was last True, per ticker (0 if
        true today; NaN if never true yet in this ticker's history)."""
        position = pd.Series(np.arange(len(self._panel)), index=self._panel.index, dtype=float)
        last_true_position = position.where(condition)
        filled = self._grouped(last_true_position).transform(lambda s: s.ffill())
        return position - filled

    def _as_bool_series(self, value: pd.Series | float) -> pd.Series:
        if isinstance(value, pd.Series):
            return value.fillna(False).astype(bool)
        return pd.Series(bool(value), index=self._panel.index)
