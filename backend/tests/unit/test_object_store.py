"""T-0001-9 / T-0016-3: the S3/R2 panel-store adapter, without a live bucket."""

from __future__ import annotations

from typing import Any

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError, NoCredentialsError

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
    region="auto",
    access_key_id="not-a-real-key",
    secret_access_key="not-a-real-secret",
)

FULL_ENV = {
    "OBJECT_STORE_BUCKET": "panels",
    "OBJECT_STORE_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
    "OBJECT_STORE_REGION": "auto",
    "OBJECT_STORE_ACCESS_KEY_ID": "not-a-real-key",
    "OBJECT_STORE_SECRET_ACCESS_KEY": "not-a-real-secret",
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
        self.raise_on_head_bucket: Exception | None = None

    def head_bucket(self, Bucket: str) -> dict[str, Any]:
        if self.raise_on_head_bucket is not None:
            raise self.raise_on_head_bucket
        return {}

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
    def test_config_is_none_when_bucket_is_unset(self) -> None:
        # A local checkout with no object-store bucket named must still boot
        # against the mock panel rather than crash -- an unset bucket is the
        # entire definition of "not configured".
        without_bucket = {**FULL_ENV, "OBJECT_STORE_BUCKET": "   "}

        assert config_from_env(without_bucket) is None, "blank bucket must not build a store"
        assert config_from_env(FULL_ENV) is not None, "a named bucket must build a store"

    def test_config_builds_from_bucket_alone_for_the_credential_chain_path(self) -> None:
        # AC1: a role-based AWS deploy sets only the bucket -- no static
        # keys, no custom endpoint, no region override -- and must still
        # read as "configured" so the ambient credential chain gets a turn.
        bucket_only = {"OBJECT_STORE_BUCKET": "prod-panels"}

        config = config_from_env(bucket_only)

        assert config is not None, "bucket alone must be enough to configure a store"
        assert config.bucket == "prod-panels", f"got {config.bucket!r}"
        assert config.endpoint_url is None, f"got {config.endpoint_url!r}"
        assert config.region is None, f"got {config.region!r}"
        assert config.access_key_id is None, f"got {config.access_key_id!r}"
        assert config.secret_access_key is None, f"got {config.secret_access_key!r}"

    def test_config_still_carries_static_credentials_and_endpoint_when_set(self) -> None:
        # AC2: the R2-compatible path (static keys + custom endpoint) keeps
        # working unchanged under the renamed variables.
        config = config_from_env(FULL_ENV)

        assert config is not None, "expected a store from a fully-set environment"
        assert config.endpoint_url == "https://example.r2.cloudflarestorage.com"
        assert config.region == "auto", f"got {config.region!r}"
        assert config.access_key_id == "not-a-real-key"
        assert config.secret_access_key == "not-a-real-secret"

    def test_missing_variables_names_only_the_bucket(self) -> None:
        # AC3/AC6: only the bucket is unconditionally required now, so a
        # role-based deploy that sets nothing else must not be told
        # credentials are "missing".
        bucket_only_missing = {"OBJECT_STORE_ENDPOINT_URL": "https://example.com"}

        missing = missing_object_store_vars(bucket_only_missing)

        assert missing == ["OBJECT_STORE_BUCKET"], f"expected just the bucket named, got {missing}"

    def test_missing_variables_is_empty_once_the_bucket_is_set(self) -> None:
        missing = missing_object_store_vars({"OBJECT_STORE_BUCKET": "prod-panels"})

        assert missing == [], f"expected nothing missing once bucket is set, got {missing}"


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


class TestEnsureReachable:
    """AC4: a configured store that cannot actually be reached must fail
    loudly, naming the bucket, rather than being mistaken for an empty one."""

    def test_a_reachable_bucket_raises_nothing(self) -> None:
        store = S3PanelStore(CONFIG, client=FakeS3Client())

        store.ensure_reachable()  # must not raise

    def test_a_wrong_bucket_raises_a_chained_domain_error_naming_the_bucket(self) -> None:
        client = FakeS3Client()
        client.raise_on_head_bucket = ClientError(
            {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadBucket"
        )
        store = S3PanelStore(CONFIG, client=client)

        with pytest.raises(PanelStoreError) as caught:
            store.ensure_reachable()

        assert CONFIG.bucket in str(caught.value), f"expected bucket named, got {caught.value}"
        assert isinstance(
            caught.value.__cause__, ClientError
        ), f"expected the boto error chained, got {caught.value.__cause__!r}"

    def test_denied_permission_raises_a_chained_domain_error(self) -> None:
        client = FakeS3Client()
        client.raise_on_head_bucket = ClientError(
            {"Error": {"Code": "403", "Message": "Forbidden"}}, "HeadBucket"
        )
        store = S3PanelStore(CONFIG, client=client)

        with pytest.raises(PanelStoreError) as caught:
            store.ensure_reachable()

        assert isinstance(caught.value.__cause__, ClientError), f"got {caught.value.__cause__!r}"

    def test_unresolvable_credentials_raise_a_chained_domain_error(self) -> None:
        client = FakeS3Client()
        client.raise_on_head_bucket = NoCredentialsError()
        store = S3PanelStore(CONFIG, client=client)

        with pytest.raises(PanelStoreError) as caught:
            store.ensure_reachable()

        assert isinstance(
            caught.value.__cause__, NoCredentialsError
        ), f"got {caught.value.__cause__!r}"
