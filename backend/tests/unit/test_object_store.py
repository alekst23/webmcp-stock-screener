"""T-0001-9: the R2/S3 panel-store adapter, without a live bucket."""

from __future__ import annotations

from typing import Any

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from domain.errors import PanelStoreError
from infra.object_store import (
    ObjectStoreConfig,
    S3PanelStore,
    config_from_env,
    missing_object_store_vars,
)

CONFIG = ObjectStoreConfig(
    bucket="panels",
    endpoint_url="https://example.r2.cloudflarestorage.com",
    access_key_id="not-a-real-key",
    secret_access_key="not-a-real-secret",
)

FULL_ENV = {
    "R2_BUCKET_NAME": "panels",
    "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
    "R2_ACCESS_KEY_ID": "not-a-real-key",
    "R2_SECRET_ACCESS_KEY": "not-a-real-secret",
}


class _Body:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


class FakeS3Client:
    """Enough of boto3's S3 client to exercise the adapter's own logic."""

    def __init__(self, objects: dict[str, bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.raise_on_head: Exception | None = None

    def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        if self.raise_on_head is not None:
            raise self.raise_on_head
        if Key not in self.objects:
            raise ClientError(
                {"Error": {"Code": "404"}, "ResponseMetadata": {"HTTPStatusCode": 404}},
                "HeadObject",
            )
        return {}

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": _Body(self.objects[Key])}

    def put_object(self, Bucket: str, Key: str, Body: bytes) -> None:
        self.objects[Key] = Body


class TestObjectStoreConfig:
    def test_config_is_none_when_any_variable_is_unset(self) -> None:
        # A local checkout with no R2 credentials must still boot against the
        # mock panel rather than crash -- so partial config reads as "none".
        partial = dict(FULL_ENV)
        partial.pop("R2_SECRET_ACCESS_KEY")

        assert config_from_env(partial) is None, "partial config must not build a store"
        assert config_from_env(FULL_ENV) is not None, "full config must build a store"

    def test_missing_variables_are_named_for_the_cli_error(self) -> None:
        partial = {**FULL_ENV, "R2_ENDPOINT_URL": "   "}

        missing = missing_object_store_vars(partial)

        assert missing == ["R2_ENDPOINT_URL"], f"expected the blank var named, got {missing}"


class TestS3PanelStore:
    def test_round_trips_an_object(self) -> None:
        store = S3PanelStore(CONFIG, client=FakeS3Client())

        store.put_object("panel.parquet", b"bytes")

        assert store.object_exists("panel.parquet"), "expected the written object to exist"
        assert store.get_object("panel.parquet") == b"bytes", "read back the wrong bytes"

    def test_a_missing_object_is_absent_rather_than_an_error(self) -> None:
        # A first deploy against an empty bucket has to fall back to the mock
        # panel; raising here would fail app startup instead.
        store = S3PanelStore(CONFIG, client=FakeS3Client())

        assert store.object_exists("panel.parquet") is False, "expected a plain False"

    def test_a_transport_failure_raises_a_chained_domain_error(self) -> None:
        client = FakeS3Client()
        client.raise_on_head = EndpointConnectionError(endpoint_url=CONFIG.endpoint_url)
        store = S3PanelStore(CONFIG, client=client)

        with pytest.raises(PanelStoreError) as caught:
            store.object_exists("panel.parquet")

        assert caught.value.__cause__ is not None, "expected the boto error chained via `from`"

    def test_reading_a_missing_object_raises_a_chained_domain_error(self) -> None:
        store = S3PanelStore(CONFIG, client=FakeS3Client())

        with pytest.raises(PanelStoreError) as caught:
            store.get_object("panel.parquet")

        assert isinstance(
            caught.value.__cause__, ClientError
        ), f"expected the ClientError chained, got {caught.value.__cause__!r}"
