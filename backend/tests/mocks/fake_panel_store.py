"""In-memory PanelStore with real behavior, for tests.

Deliberately a working store rather than a call-recorder: the pipeline's
interesting failures (a delta appended twice, a panel round-tripping through
Parquet) only show up when reads actually return what writes stored.
"""

from __future__ import annotations


class InMemoryPanelStore:
    def __init__(self, objects: dict[str, bytes] | None = None) -> None:
        self.objects: dict[str, bytes] = dict(objects or {})
        self.put_count = 0

    def object_exists(self, key: str) -> bool:
        return key in self.objects

    def get_object(self, key: str) -> bytes:
        return self.objects[key]

    def put_object(self, key: str, body: bytes) -> None:
        self.objects[key] = body
        self.put_count += 1
