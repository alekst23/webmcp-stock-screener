"""PanelStore adapter over the S3 API -- AWS S3 in production, Cloudflare R2
in earlier deployments and still supported for any S3-compatible endpoint.

Credentials come from the standard boto3 resolution chain (environment,
shared config, or -- on AWS App Runner / ECS -- the instance/task role) when
no static key pair is supplied. Static keys plus a custom endpoint keep
working unchanged, which is what an R2 deployment needs.

Config comes from the environment (OBJECT_STORE_BUCKET /
OBJECT_STORE_ENDPOINT_URL / OBJECT_STORE_REGION / OBJECT_STORE_ACCESS_KEY_ID
/ OBJECT_STORE_SECRET_ACCESS_KEY -- see backend/.env.example). Values are
never committed; on Render they were dashboard secrets (`sync: false` in
render.yaml); on AWS they are not set at all, since the task role supplies
credentials.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from domain.errors import PanelStoreError

_BUCKET_VAR = "OBJECT_STORE_BUCKET"

# T-0016-12: the single source of truth for the object-store variable names,
# so a deployment manifest (render.yaml) can be checked against what this
# module actually reads instead of drifting from it silently.
OBJECT_STORE_VARS: tuple[str, ...] = (
    _BUCKET_VAR,
    "OBJECT_STORE_ENDPOINT_URL",
    "OBJECT_STORE_REGION",
    "OBJECT_STORE_ACCESS_KEY_ID",
    "OBJECT_STORE_SECRET_ACCESS_KEY",
)


@dataclass(frozen=True)
class ObjectStoreConfig:
    bucket: str
    endpoint_url: str | None = None
    region: str | None = None
    access_key_id: str | None = None
    secret_access_key: str | None = None


def config_from_env(env: dict[str, str] | None = None) -> ObjectStoreConfig | None:
    """Read the object-store config, or None when no bucket is named.

    The bucket is the sole signal of "configured": everything else -- region,
    endpoint, static credentials -- has a value boto3 can resolve on its own,
    so leaving it unset must not be mistaken for "no store". None rather than
    an error here: a local checkout with no bucket named must still boot
    against the mock panel (application/load_panel.py's fallback), which is
    how every test and every pre-T-0001-9 workflow runs.
    """
    source = env if env is not None else dict(os.environ)
    bucket = source.get(_BUCKET_VAR, "").strip()
    if not bucket:
        return None
    return ObjectStoreConfig(
        bucket=bucket,
        endpoint_url=_optional(source, "OBJECT_STORE_ENDPOINT_URL"),
        region=_optional(source, "OBJECT_STORE_REGION"),
        access_key_id=_optional(source, "OBJECT_STORE_ACCESS_KEY_ID"),
        secret_access_key=_optional(source, "OBJECT_STORE_SECRET_ACCESS_KEY"),
    )


def _optional(source: dict[str, str], name: str) -> str | None:
    value = source.get(name, "").strip()
    return value or None


def missing_object_store_vars(env: dict[str, str] | None = None) -> list[str]:
    """Names of the object-store variables that are unset or blank, for CLI
    entry points that must fail with a message naming what to set.

    Only the bucket is unconditionally required -- everything else is
    optional, so a role-based deploy that sets nothing else is not "missing"
    credentials it was never meant to have.
    """
    source = env if env is not None else dict(os.environ)
    return [_BUCKET_VAR] if not source.get(_BUCKET_VAR, "").strip() else []


class S3PanelStore:
    """PanelStore over any S3-API endpoint (AWS S3 or Cloudflare R2).

    `client` is injectable so the adapter's own key handling and error
    chaining are unit-testable without a live bucket.
    """

    def __init__(self, config: ObjectStoreConfig, client: Any | None = None) -> None:
        self._bucket = config.bucket
        # boto3's client is dynamically generated from service metadata, so
        # there is no static type to bind to here.
        self._client: Any = client or boto3.client(
            "s3",
            endpoint_url=config.endpoint_url,
            aws_access_key_id=config.access_key_id,
            aws_secret_access_key=config.secret_access_key,
            region_name=config.region,
        )

    def ensure_reachable(self) -> None:
        """Confirm the bucket itself can be reached under the resolved
        credentials. Raises PanelStoreError, naming the bucket and chaining
        the original exception, on any failure -- wrong bucket, denied
        permission, or a credential chain that never resolves.

        Deliberately separate from `object_exists`: a HEAD against a missing
        *key* and a HEAD against a missing *bucket* can both come back as a
        bare 404, and only the former is the benign "not seeded yet" case
        load_panel is allowed to fall through on.
        """
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except (ClientError, BotoCoreError) as exc:
            raise PanelStoreError(f"Object store bucket {self._bucket!r} is not reachable") from exc

    def object_exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as exc:
            # A plain "not there" is a normal answer, not a failure -- an
            # empty bucket on a first deploy must fall back to the mock
            # panel rather than crash startup.
            if _is_not_found(exc):
                return False
            raise PanelStoreError(f"Could not stat {key} in {self._bucket}") from exc
        except BotoCoreError as exc:
            raise PanelStoreError(f"Could not stat {key} in {self._bucket}") from exc
        return True

    def get_object(self, key: str) -> bytes:
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            body: bytes = response["Body"].read()
        except (ClientError, BotoCoreError, KeyError) as exc:
            raise PanelStoreError(f"Could not read {key} from {self._bucket}") from exc
        return body

    def put_object(self, key: str, body: bytes) -> None:
        try:
            self._client.put_object(Bucket=self._bucket, Key=key, Body=body)
        except (ClientError, BotoCoreError) as exc:
            raise PanelStoreError(f"Could not write {key} to {self._bucket}") from exc

    def object_version(self, key: str) -> str | None:
        """The object's current S3 VersionId, or None if it does not exist.

        Not part of the `PanelStore` protocol -- an S3-specific capability
        for scripts that must record a rollback target before overwriting a
        versioned object (see scripts/enforce_universe_floor.py). None is
        also returned if the bucket is unversioned, since a HEAD then omits
        `VersionId` entirely rather than erroring.
        """
        try:
            response = self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as exc:
            if _is_not_found(exc):
                return None
            raise PanelStoreError(f"Could not stat {key} in {self._bucket}") from exc
        except BotoCoreError as exc:
            raise PanelStoreError(f"Could not stat {key} in {self._bucket}") from exc
        version: str | None = response.get("VersionId")
        return version


def _is_not_found(exc: ClientError) -> bool:
    """S3 and R2 disagree on the code for a missing object on HEAD (404 vs
    NoSuchKey vs 404 with an empty code), so match on the HTTP status too."""
    error = exc.response.get("Error", {}) if isinstance(exc.response, dict) else {}
    if str(error.get("Code")) in {"404", "NoSuchKey", "NotFound"}:
        return True
    metadata = exc.response.get("ResponseMetadata", {}) if isinstance(exc.response, dict) else {}
    return int(metadata.get("HTTPStatusCode", 0)) == 404
