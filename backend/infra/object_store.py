"""PanelStore adapter over the S3 API, used against Cloudflare R2.

R2 speaks the S3 API, so boto3 talks to it unchanged given a custom endpoint
URL. Region is fixed to "auto": R2 has no regions, but botocore's SigV4
signer requires *some* region name in the credential scope, and "auto" is the
value Cloudflare documents for S3-compatible clients.

Config comes from the environment (R2_BUCKET_NAME / R2_ENDPOINT_URL /
R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY -- see backend/.env.example). Values
are never committed; on Render they are dashboard secrets (`sync: false` in
render.yaml).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from domain.errors import PanelStoreError

# R2 has no regions; botocore's SigV4 signer still needs a scope name.
_R2_REGION = "auto"


@dataclass(frozen=True)
class ObjectStoreConfig:
    bucket: str
    endpoint_url: str
    access_key_id: str
    secret_access_key: str


def config_from_env(env: dict[str, str] | None = None) -> ObjectStoreConfig | None:
    """Read the object-store config, or None when it is not fully set.

    None rather than an error: a local checkout with no R2 credentials must
    still boot against the mock panel (main.py's fallback), which is how
    every test and every pre-T-1001-9 workflow runs.
    """
    source = env if env is not None else dict(os.environ)
    values = {
        name: source.get(name, "").strip()
        for name in (
            "R2_BUCKET_NAME",
            "R2_ENDPOINT_URL",
            "R2_ACCESS_KEY_ID",
            "R2_SECRET_ACCESS_KEY",
        )
    }
    if not all(values.values()):
        return None
    return ObjectStoreConfig(
        bucket=values["R2_BUCKET_NAME"],
        endpoint_url=values["R2_ENDPOINT_URL"],
        access_key_id=values["R2_ACCESS_KEY_ID"],
        secret_access_key=values["R2_SECRET_ACCESS_KEY"],
    )


def missing_object_store_vars(env: dict[str, str] | None = None) -> list[str]:
    """Names of the object-store variables that are unset or blank, for CLI
    entry points that must fail with a message naming what to set."""
    source = env if env is not None else dict(os.environ)
    return [
        name
        for name in (
            "R2_BUCKET_NAME",
            "R2_ENDPOINT_URL",
            "R2_ACCESS_KEY_ID",
            "R2_SECRET_ACCESS_KEY",
        )
        if not source.get(name, "").strip()
    ]


class S3PanelStore:
    """PanelStore over any S3-API endpoint (R2 in this project's deployment).

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
            region_name=_R2_REGION,
        )

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


def _is_not_found(exc: ClientError) -> bool:
    """S3 and R2 disagree on the code for a missing object on HEAD (404 vs
    NoSuchKey vs 404 with an empty code), so match on the HTTP status too."""
    error = exc.response.get("Error", {}) if isinstance(exc.response, dict) else {}
    if str(error.get("Code")) in {"404", "NoSuchKey", "NotFound"}:
        return True
    metadata = exc.response.get("ResponseMetadata", {}) if isinstance(exc.response, dict) else {}
    return int(metadata.get("HTTPStatusCode", 0)) == 404
