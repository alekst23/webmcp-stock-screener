from datetime import date

from domain.contracts.engine import PatternResearchEngine
from domain.errors import ExpressionError
from domain.models.instance import InstanceSet
from domain.models.pattern import Setup, SetupStep, Study

SUPPORTED_FUNCTIONS = ["sma", "ema", "atr", "highest", "lowest", "days_since"]


class MockPatternResearchEngine(PatternResearchEngine):
	"""Real in-memory behavior over a tiny hand-built fixture, for tests of
	callers (e.g. T-1001-5's WebMCP integration) that don't need the actual
	pandas-backed engine."""

	def __init__(self) -> None:
		self._studies: dict[str, Study] = {}
		self._setups: dict[str, Setup] = {}
		self._next_id = 1

	def _id(self, prefix: str) -> str:
		value = f"{prefix}_{self._next_id}"
		self._next_id += 1
		return value

	def define_study(self, name: str, expression: str) -> Study:
		fn = next((f for f in SUPPORTED_FUNCTIONS if f in expression), None)
		if "(" in expression and fn is None:
			raise ExpressionError(
				f'expression "{expression}" uses an unsupported function', SUPPORTED_FUNCTIONS
			)
		study = Study(id=self._id("study"), name=name, expression=expression)
		self._studies[study.id] = study
		return study

	def define_setup(self, name: str | None, steps: list[SetupStep]) -> Setup:
		setup = Setup(id=self._id("setup"), name=name, steps=steps)
		self._setups[setup.id] = setup
		return setup

	def find_instances(
		self,
		setup: Setup,
		from_date: date | None = None,
		to_date: date | None = None,
		min_market_cap: float | None = None,
		sectors: list[str] | None = None,
	) -> InstanceSet:
		return InstanceSet(
			id=self._id("set"),
			setup_id=setup.id,
			instances=[],
			complete_count=0,
			partial_count=0,
			from_date=from_date or date(2015, 1, 2),
			to_date=to_date or date(2026, 8, 25),
		)
