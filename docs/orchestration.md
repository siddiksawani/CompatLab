# Private orchestration

The control service claims durable PostgreSQL jobs and accepts bounded evidence from authenticated workers. It never loads package code. The worker agent connects through the private API and uses the existing runsc supervisor. Classification and public report endpoints arrive in slice 09.

## Identity and transport

`registerWorker` creates a 256-bit random bearer token, returns it once, stores its SHA-256 hash, and records the operator action. Capabilities list approved image digests, preparation profiles, platform, and harness/plan/policy revisions. Workers receive no database credentials. Store the token in a private root-owned file on the execution host; revoke it centrally by setting the worker's revocation metadata through operator functions.

The production control entry point requires an IPv4 address belonging to a WireGuard interface, checks the interface kind, and binds only that address. There is no wildcard bind, public reverse-proxy route, or browser access. The client accepts only literal private/loopback IPv4 origins, ignores proxy environment variables, never follows redirects, and bounds response bytes and request duration. Loopback is used by the disposable integration fixture, not the production listener.

The private HTTP API accepts versioned JSON contracts:

| Endpoint | Operation |
|---|---|
| `POST /v1/workers/ready` | Confirm supervisor startup cleanup and establish a new session |
| `POST /v1/workers/evictions` | Mark unreserved snapshots unavailable before removing local bytes |
| `POST /v1/jobs/claim` | Claim one eligible operation and refresh active snapshot reservations |
| `POST /v1/jobs/renew` | Mark an attempt running and renew its lease |
| `POST /v1/jobs/results` | Accept preparation provenance, run evidence, or a structured failure |
| `POST /v1/jobs/abandon` | Acknowledge completed local cleanup when no evidence was accepted |

Tokens are checked before bodies are buffered. Requests are limited to 32 MiB, responses to 16 MiB, concurrent requests to eight, and connections to 64. Headers, idle sockets, body time, JSON structure, and individual contract fields have separate bounds. Errors omit request content and credentials. The JSON body limit accommodates a 16 MiB lock encoded as base64; it is not an execution output allowance.

## Claims and leases

`scheduler_v1` permits three globally leased/running jobs, at most one preparation, two concurrent jobs per runtime image, and the registered one-to-three slots per worker. Claims use a short transaction, the shared catalog advisory lock for cross-process quotas/policy changes, and `FOR UPDATE SKIP LOCKED` on the selected job. No transaction remains open while package work executes.

Eligible work must match the worker capabilities and current policy. Runtime jobs stay on the sealed snapshot's owner. Dispatch first favors scans with fewer active jobs, then earlier requests. A claim starts the scan's fifteen-minute deadline if it has not started; renewals and retries never extend it.

Each attempt receives a random token and a 30-second lease. The agent renews every ten seconds, measures elapsed time with a monotonic clock, subtracts request latency and a three-second cancellation margin, and aborts immediately on renewal failure. A failed or stalled control connection cannot renew authority indefinitely. Local cleanup must finish before an abandonment acknowledgement releases the database reservation.

Expired attempts remain reserved. Reconciliation marks their worker as requiring recovery; it does not assume a disconnected process has died. A new supervisor session may reclaim work only after startup cleanup. A live session cannot be superseded, and an expired session cannot resume under its old identifier. Revoked and quarantined workers cannot claim or submit new evidence. Idle workers are drained after thirty seconds without contact.

Infrastructure failures retry at most twice after the first attempt, with five- and ten-second backoffs within the original deadline. Preparation failures do not trigger automatic retries. Run observations, including failures and interrupted coverage, are accepted as evidence rather than treated as infrastructure retries.

## Results and recovery

Preparation acceptance verifies canonical base64, the actual lock digest and source/integrity policy, installed package identity, and the reserved installer/profile. It retains the worker-local snapshot ID, immutable generation, ordered installed manifest, lock, tree digest, and bounded metadata. Plan generation and creation of the matrix's root/subpath jobs happen in the same transaction. Reconciliation also repairs missed transitions and aggregation reservations.

Run acceptance checks the approved image/profile, group, mode, ordered entries, session continuation, successful process outcomes, checkpoints, and recomputed coverage. Stdout is never a verdict. Evidence budgets reserve room for the scan plan and preparation metadata before dividing the remaining report budget across groups. Logs have a separate four-MiB scan allowance, are stored separately from raw evidence, and receive a thirty-day expiry. PostgreSQL cannot store NUL in JSONB text, so ingestion replaces it with `?` and labels logs `nul_replacement_v1`; broader display sanitization belongs to the report layer.

Each accepted attempt stores a digest of its canonical submitted result. Identical resubmission is idempotent; different evidence for the same accepted attempt is rejected. Worker/session/attempt identity and lease validity reject stale submissions. These are at-least-once jobs with one accepted logical result, not exactly-once package execution.

Startup and claim requests include an inventory of sealed local snapshots. Missing snapshots become unavailable before new claims; their active scans fail explicitly instead of waiting indefinitely. The agent refreshes server-owned snapshot pins on every claim response. Those reservations span gaps between runtime jobs and retries. Executing jobs hold independent pins, so refreshing the remote set cannot evict a workspace still in use. Before eviction, the catalog atomically removes availability and refuses deletion for snapshots reserved by active scans or uncleared attempts. New admissions therefore cannot race collection into stale reuse. Losing control contact aborts and drains active work before releasing reservations.

`scanProgress` reads state, revision, timestamps, and job counts in one database snapshot. It excludes logs and does not invent a completion percentage. Public conditional polling is added with the report API.

## Running and qualification

Build and migrate before starting either service. Runtime images and matrix/worker capabilities must be registered by a trusted operator using the catalog functions; the operator CLI is part of slice 11.

```sh
DATABASE_URL='postgres://USER:PASSWORD@HOST/DATABASE' pnpm db:migrate
DATABASE_URL='postgres://USER:PASSWORD@HOST/DATABASE' \
  CONTROL_BIND_ADDRESS=10.66.0.1 CONTROL_WIREGUARD_INTERFACE=wg0 \
  node services/control/dist/bin.js

sudo env CONTROL_URL=http://10.66.0.1:4871 \
  WORKER_TOKEN_FILE=/etc/compatlab/worker-token \
  WORKER_STATE_DIRECTORY=/var/lib/compatlab \
  "$(command -v node)" services/worker/dist/remote/bin.js
```

The test-only PostgreSQL service may run on a disposable qualification host. Production control and package execution still require separate host/VM boundaries. The devbox is authorized for testing only; no public service is deployed there.

`pnpm check` covers lease/command cancellation, transport restrictions, and local ownership. `pnpm test:database` covers concurrent claims, worker scope, late/conflicting submissions, cleanup confirmation, bounded retries, fairness, locality, eviction, policy changes, and HTTP validation. `scripts/orchestration-smoke.mjs` uses a real PostgreSQL catalog, private HTTP server, and separate worker process without database credentials. It prepares an exact public package, kills and replaces the worker during execution, verifies expired capacity stays reserved until recovery, and accepts all sixteen groups under runsc from the original snapshot. It is a required Linux CI gate. The existing hostile worker, preparation, and engine gates remain required.

Migration 0002 expands the existing schema. Historical reports remain readable. Older preparation records without installed-manifest/local-snapshot metadata are not eligible for new remote work; they are never silently relabeled as fresh snapshots. Legacy active jobs receive fenced session identifiers and require confirmed cleanup. A database constraint requires a session for every leased/running job.

References: [PostgreSQL row locking](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE), [Node HTTP limits](https://nodejs.org/docs/latest-v24.x/api/http.html).
