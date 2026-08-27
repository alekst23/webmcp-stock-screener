from datetime import date
from typing import Protocol

from domain.models.instance import InstanceSet
from domain.models.pattern import Setup, SetupStep, Study


class PatternResearchEngine(Protocol):
	"""The query engine's contract, implemented by an infra adapter over the
	panel (mock in early development, real EODHD-backed later — same
	contract either way). Extended incrementally as later tickets (T-1001-4)
	add methods; T-1001-3 delivers the three below."""

	def define_study(self, name: str, expression: str) -> Study:
		"""Raises domain.errors.ExpressionError on an unsupported expression."""
		...

	def define_setup(self, name: str | None, steps: list[SetupStep]) -> Setup:
		...

	def find_instances(
		self,
		setup: Setup,
		from_date: date | None = None,
		to_date: date | None = None,
		min_market_cap: float | None = None,
		sectors: list[str] | None = None,
	) -> InstanceSet:
		"""Returns every completed occurrence of `setup` in the loaded panel.

		If fewer than 5 completed instances are found, also includes partial
		(in-progress) matches — see spec.md's "Instance search" scenarios for
		the exact threshold and completion-scoring rules.
		"""
		...
