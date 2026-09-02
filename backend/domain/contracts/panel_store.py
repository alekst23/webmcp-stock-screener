from typing import Protocol


class PanelStore(Protocol):
    """Blob storage holding the price panel and universe metadata.

    Object storage rather than a Render persistent disk: attaching a disk on
    Render requires a paid instance tier that costs far more than storing
    ~60-90MB of Parquet (see docs/reference/data-provider.md). Implemented in
    infra by an S3-API adapter (Cloudflare R2 or S3), and by an in-memory
    fake in tests.

    Raises domain.errors.PanelStoreError on any transport or credential
    failure. A missing object is NOT an error -- `object_exists` answers that
    question, so a first-ever deploy against an empty bucket can fall back to
    the mock panel instead of crashing at startup.

    `ensure_reachable` answers a different question: can the bucket itself be
    reached at all. It is the caller's job to run it before treating a
    configured store as usable -- a wrong bucket, a denied permission, or
    credentials that never resolve must abort startup rather than be
    mistaken for "not yet seeded".
    """

    def ensure_reachable(self) -> None: ...

    def object_exists(self, key: str) -> bool: ...

    def get_object(self, key: str) -> bytes: ...

    def put_object(self, key: str, body: bytes) -> None: ...
