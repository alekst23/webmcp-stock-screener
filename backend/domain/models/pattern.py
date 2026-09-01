from pydantic import BaseModel


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
