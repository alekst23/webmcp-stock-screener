# AWS Re-platform — Technical Design

## Contracts

### Object-store configuration

Today `ObjectStoreConfig` requires four `R2_`-prefixed values and
`config_from_env` returns `None` when any is blank. `load_panel` reads `None`
as "no store configured" and falls back to the mock panel. On a role-based
AWS deployment with no static keys, that path means the service boots, passes
its health check, and serves **synthetic prices as though they were real**.

The contract has to distinguish three states that are currently two.

| State | Meaning | Behaviour |
|-------|---------|-----------|
| Not configured | No bucket named | Mock panel, disclosed as synthetic. The local-development path, unchanged |
| Configured and reachable | Bucket named, credentials resolve, objects readable | Real panel |
| Configured and unreachable | Bucket named, but denied / missing / unresolvable credentials | **Fail loudly.** Never the mock panel |

| Field | Type | Description |
|-------|------|-------------|
| `bucket` | `str` | Required. Its presence is what distinguishes "configured" from "not configured" |
| `endpoint_url` | `str \| None` | Optional. Absent for real S3, so boto3 does its own regional resolution; set for R2 or any S3-compatible endpoint |
| `region` | `str \| None` | Optional. Replaces the hardcoded `_R2_REGION = "auto"`, which real S3 rejects as a region name. Defaults to the ambient AWS region; `"auto"` remains the correct value for R2 |
| `access_key_id` | `str \| None` | Optional. Absent means the boto3 default credential chain — the instance role on AWS |
| `secret_access_key` | `str \| None` | Optional, paired with `access_key_id` |

Variable names become provider-neutral. The `R2_`-prefixed names stop being
honest once the bucket is S3, and `.env.example` must state which are
required, which are optional, and what each is for.

`missing_object_store_vars` exists to let CLI entry points fail with a
message naming what is unset. Its notion of "missing" narrows with the
config: only the bucket is unconditionally required.

### Liveness endpoint

| Property | Value |
|----------|-------|
| Location | Outside the `/api/spike` prefix, so deleting the demo stack cannot break the deployment |
| Cost | No file I/O, no object-storage call, no panel computation. The current target, `/api/spike/ping`, reads a Parquet file and constructs a `PriceBar` per probe |
| Semantics | Liveness only. Success whenever the process serves HTTP — including with no panel, or with the mock fallback |
| Rate limiting | Exempt, so a frequent probe cannot exhaust the per-address budget or be throttled into a false negative |

Panel provenance and staleness stay where they already are, on
`GET /api/research/panel`. Two questions, two endpoints: "is this process
alive" is the platform's, "is this data real and current" is the
researcher's. Conflating them makes a degraded-but-serving deployment
unroutable — which is the opposite of what T-0013-5 chose when it decided to
disclose degradation rather than fail on it.

## Data Flow

### Deployed shape

```
Cloudflare Workers (frontend, HTTPS, unchanged)
        │  HTTPS, CORS-allowlisted origin
        v
App Runner service ── 1 vCPU / 2 GB ── image from ECR
        │  instance role (no static keys)
        │  liveness probe ─> health endpoint
        v
S3 bucket (private, versioned, encrypted)  <── panel + universe metadata
        ^
        │  same image, same role, same code path
EventBridge Scheduler ──> ECS Fargate task (no service, no ALB, no NAT)
        nightly: append one session, idempotent by (ticker, date)
```

Two platforms, one image. App Runner serves HTTP only, so the batch job
cannot share it; running both from the same registry image and the same
application identity is what keeps their dependency closures from drifting.

### Why the container is long-running

`main.py`'s lifespan hook loads the panel once at startup and the engine
keeps it resident. That is the design's premise, and it is why this is a
container rather than a function: a per-invocation runtime would cold-start
pandas and pyarrow and re-pull the panel on every call — seconds per call for
an interactive agent tool — and would force a query-per-request rewrite.

The consequence for operations is that **an instance is not useful until the
panel is downloaded and parsed**, so health-check timing must tolerate real
load time against S3 rather than against a local file. Getting this wrong
presents as a deployment that rolls itself back forever with nothing in the
application logs.

### Measuring memory

App Runner reports request-level metrics, not per-task memory utilization.
Peak RSS is therefore measured **from inside the container**, as absolute
whole-process RSS with no baseline subtraction — the same correction the
project's blocker table records against the earlier 688 MB figure, which
subtracted a baseline taken after imports and so reported a number the
platform never sees.

The stages that make up the measured 723 MB, for whoever repeats it:
interpreter 14 MB → libraries 90 MB → application imports 100 MB → panel read
217 MB → parsed 364 MB → before search 385 MB → **peak during search
723 MB**, against a panel only 65.7 MB resident. The search transients are
the only part that grows with expression complexity, and they are +65% on a
complex pattern versus a simple one.

---

*Product design: [spec.md](spec.md)*
