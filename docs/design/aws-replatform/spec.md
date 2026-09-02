# AWS Re-platform — Product Spec

## Intent

The backend runs on a hosting tier that caps the process at 512 MB, and every
memory decision this project has made was made against that number. The
number is an artifact of a free plan, not a requirement: a realistic
three-step, four-study pattern peaks at **723 MB absolute RSS** against a
panel that is only **65.7 MB resident**.

This feature moves the backend to infrastructure with real memory, so that
how large the research universe can be becomes a product decision about
base-rate quality rather than a hosting artifact. Success is the workbench
answering the same questions it answers today, against the same real panel,
from infrastructure the project owns and describes as code — with the panel's
nightly currency intact and the peak memory of a realistic query measured
rather than assumed.

It is a re-platform, not a rewrite. No question a researcher can ask changes,
no answer changes, and the engine's public surface is untouched.

## Preconditions

- An AWS account the project can create resources in: **`490284589142`,
  region `us-east-1`**, reached through the `alekst23` profile whose IAM
  principal is `terraform-deploy-user`. The region matches the existing
  `postgres` RDS instance `database-1`, so a later server-side workspace
  store does not cross regions.
- A paid EODHD API key with quota to run a backfill and a nightly delta.
  See `docs/reference/data-provider.md`.
- The existing panel and universe-metadata objects in Cloudflare R2, which
  are the migration's source. They cost a paid backfill to reproduce, so
  they are moved by copy-and-verify, never by move-and-hope.
- The frontend stays on Cloudflare Workers and is served over HTTPS, so the
  backend origin must be HTTPS.
- EPIC-0013's vectorized panel I/O and partitioned Parquet are merged to
  `main`. This is what gets deployed; deploying the pre-EPIC-0013 load path
  would put a 5.45 GB peak on the new container.

## Features

1. **A single container image** that runs either the API or an ingestion
   script, so the service and the nightly job cannot drift apart in what
   they depend on.
2. **A liveness endpoint outside the demo stack**, so the platform's health
   probe measures whether the process is serving HTTP and nothing else.
3. **Object storage reached through the deployment's own identity**, with a
   configured-but-unreachable store failing loudly instead of degrading to
   synthetic data.
4. **The whole AWS footprint described as Terraform**, applied from clean
   state, with no console step.
5. **Runtime secrets held in AWS**, injected by reference, absent from the
   repository, the image, the service configuration, and the logs.
6. **The API running as a long-running HTTPS service at 2 GB**, holding the
   panel resident.
7. **The panel objects migrated to S3**, byte-identical and verified.
8. **The nightly delta running on a schedule on AWS**, from the same image,
   idempotent by `(ticker, date)`.
9. **A recorded measurement of absolute peak RSS** on the deployed
   container, against a realistic pattern and the real panel.
10. **A cutover with a rollback path**, and decommissioning only after
    everything above holds.

## Behavioral Specifications

### Serving research from AWS

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | The service is deployed with a reachable bucket holding the real panel | A researcher loads the workbench and runs a pattern | Results are identical to what the pre-migration deployment returned for the same pattern, and the panel is reported as real, with its as-of date |
| Cold start | A new instance has just started and the panel is still downloading | A request arrives | The request is served or waits, and the instance is not recycled for being slow to warm up |
| Degraded panel | Object storage is not configured at all | The service starts | It serves the mock panel, stays healthy, and discloses the panel as synthetic through the existing research surface — the pre-migration behaviour, unchanged |
| Silent-mock hazard | Object storage **is** configured but cannot be reached — wrong bucket, denied, or unreachable | The service starts | It fails loudly. It must never present synthetic prices as real. This is the failure mode the migration exists to remove, not to carry across |
| Cross-origin | The Cloudflare frontend calls the new backend origin | A browser issues the request | It succeeds, and an origin outside the allowlist does not |

### Health and recycling

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Liveness | The process is up and serving HTTP | The platform probes health | Success, with no file read, no object-storage call, and no panel computation |
| No panel | The service has no panel loaded, or has the mock fallback | The platform probes health | Success. A degraded-but-serving deployment stays routable |
| Dead process | The process has stopped serving HTTP | The platform probes health | Failure, and the instance is replaced |
| Demo stack retired | Every route under the `spike` prefix has been deleted | The platform probes health | Success. Retiring demo code cannot break the deployment |
| Probe volume | The probe runs at its configured interval indefinitely | Rate limits are evaluated | The probe is never throttled into a false negative |

### Keeping the panel current

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Ordinary night | The panel is current to the previous session | The schedule fires | One trading day is appended and the stored panel advances by one session |
| Retry | A run already appended today's session | The same run is invoked again | The panel is unchanged — appends are idempotent by `(ticker, date)` |
| Market holiday | The provider returns no rows for the target date | The schedule fires | The panel is left untouched and the run is not an error |
| Recovery | The panel is several sessions stale after failed nights | A catch-up run is invoked | Every missing session is applied in one run, with no execution ceiling cutting it short |
| Failure | A run fails for any reason | The next morning arrives | The failure is visible to an operator rather than silent, and the panel's staleness is disclosed through the existing research surface |

### Operating it

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Reproducible | An empty account and this repository | Terraform is applied from clean state | The deployment comes up with no manual console step, and an immediate second plan reports no drift |
| No secrets at rest | Any commit, image layer, or service configuration | It is inspected | No EODHD key and no storage credential appears in plaintext |
| Rotation | A secret's value is changed in AWS | The next instance starts | It takes effect, with no code change and no infrastructure change |
| Memory truth | The service is deployed at its configured ceiling | A realistic multi-step, multi-study pattern runs against the real panel | Absolute peak RSS of the whole process is measured and recorded against that ceiling, with headroom stated. A peak that does not fit is reported as not fitting |
| Rollback | The new deployment is serving and something is wrong | An operator follows the runbook | Traffic returns to the previous deployment by a path that was valid at the moment of cutover |
| Decommission | Everything above holds and the user has approved | Render is turned off | Its services stop, its credentials are revoked rather than orphaned, and the rollback path's expiry is recorded |

## Non-Goals

- **Moving the frontend off Cloudflare Workers.** It works. Only its API
  origin and the backend's CORS allowlist change.
- **Fixing the memory growth itself.** Peak still grows with expression
  complexity, not just row count. This converts a hard blocker into a
  deferred efficiency problem; it does not delete it. EPIC-0015 stays parked
  with a new trigger: when measured peak on the deployed container
  approaches its ceiling.
- **Using the available RDS/Aurora Postgres.** It is noted as available and
  already paid for, and workspace persistence already sits behind a
  repository port, so a Postgres adapter is a later drop-in. Nothing here
  requires it.
- **Any change to the engine's public surface, to `PriceBar`, or to what a
  pattern means.**
- **Trimming the universe.** The liquidity floor returns to being a product
  decision about base-rate quality.
- **Autoscaling.** One instance is correct for a design whose premise is a
  resident in-memory panel; scaling out multiplies the panel per instance
  rather than sharing it.

## Open Questions

None blocking. All six of the epic's original open questions were settled on
2026-09-01 and are recorded with their reasoning in
`docs/plan/EPIC-0016/_epic.md` under Resolved Decisions.

One item is deliberately left to measurement rather than to argument: **2 GB
was chosen over the recommended 4 GB.** If T-0016-9's measured peak on a
complex pattern against the real panel exceeds roughly 1.4 GB, the ceiling
should be raised rather than the result rationalised. It is a Terraform
input for exactly this reason.

---

*Implemented by: EPIC-0016 (issue #16)*
