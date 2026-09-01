"""Environment resolution shared by the ingestion CLIs.

Every one of these scripts costs real money or rewrites the stored panel, so
they fail loudly and specifically on missing configuration -- naming the
variable to set -- rather than half-running against a partial environment.
No credential is ever defaulted, embedded, or inferred.
"""

from __future__ import annotations

import os
import sys

from infra.object_store import S3PanelStore, config_from_env, missing_object_store_vars


def require_api_key() -> str:
    key = os.environ.get("EODHD_API_KEY", "").strip()
    if not key:
        sys.exit(
            "EODHD_API_KEY is not set. This script calls the paid EOD Historical "
            "Data plan; set the key in the environment (see backend/.env.example) "
            "and re-run. Never commit it."
        )
    return key


def require_panel_store() -> S3PanelStore:
    missing = missing_object_store_vars()
    if missing:
        sys.exit(
            f"Object store is not configured: {', '.join(missing)} unset. "
            "See backend/.env.example for what each variable holds."
        )
    config = config_from_env()
    if config is None:
        sys.exit(
            "Object store configuration became unreadable; check the OBJECT_STORE_* variables."
        )
    return S3PanelStore(config)
