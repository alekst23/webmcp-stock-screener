from pydantic import BaseModel, model_validator


class Study(BaseModel):
    """A named derived series over price/volume data, e.g. relative volume."""

    id: str
    name: str
    expression: str


class SetupStep(BaseModel):
    """One condition in a temporal pattern's sequence."""

    condition: str
    # [min, max] trading days after the previous step this condition may
    # occur in. None for the first step.
    within: tuple[int, int] | None = None
    # If true, the condition must hold on every day of the window, not just
    # one day within it.
    sustained: bool = False


class Setup(BaseModel):
    """A temporal pattern: an ordered sequence of condition steps."""

    id: str
    name: str | None = None
    steps: list[SetupStep]

    @model_validator(mode="after")
    def _validate_within_bounds(self) -> "Setup":
        # Validated here (not on SetupStep itself) because the error needs
        # the step's position in the sequence, which only the parent Setup
        # knows -- a SetupStep constructed on its own has no index to report.
        for index, step in enumerate(self.steps):
            if step.within is None:
                continue
            min_days, max_days = step.within
            if min_days < 0:
                raise ValueError(f"step {index}: within min must be >= 0, got {min_days}")
            if max_days < min_days:
                raise ValueError(
                    f"step {index}: within max ({max_days}) must be >= min ({min_days})"
                )
        return self
