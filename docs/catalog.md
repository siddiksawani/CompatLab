# Persistent catalog and admission

`@compatlab/catalog` is the private PostgreSQL data layer. It uses PostgreSQL 18.6, Drizzle ORM 0.45.3 and node-postgres 8.23.1. It reserves work, provides policy-aware report lookup, and owns durable scheduling transactions. The [private control API](orchestration.md) dispatches work to authenticated execution workers. Hosted classification and public reads are documented in [reports](reports.md).

## Data and identities

The SQL migration is the schema authority. `src/schema.ts` provides typed Drizzle mappings; integration tests compare every mapped column with PostgreSQL. Handwritten SQL holds checks, composite foreign keys, indexes and triggers that need explicit review. Do not run a schema-push command against this database.

| Tables | Responsibility |
|---|---|
| `packages`, `package_versions` | Exact artifact identity, ordered manifest, latest observed tags and changed-integrity flags |
| `preparations` | Profile/platform and resolution generation, retained lock bytes/digest, sealed snapshot generation, tree digest and worker locality |
| `runtime_images`, `matrices`, `matrix_members` | Approved immutable runtime definitions and ordered matrix configuration |
| `scans`, `runs` | Preparation/matrix identity, lifecycle, per-image/mode/group evidence and bounded logs |
| `jobs`, `workers` | Durable work, scoped credentials, supervisor sessions, leases and cleanup reconciliation |
| `reports` | Immutable classifier revisions/payloads with separate invalidation/replacement metadata |
| `blocks`, `audit_events` | Policy exclusions and append-only administrative history |

The catalog also retains maintainer authority, monitoring and notification tables with separate role grants. Matrix membership is a join table so PostgreSQL can reject a run whose image is outside its scan's matrix. Membership must be complete, contiguous, ordered, and contain unique profiles and image IDs. A deferred constraint checks the complete matrix at transaction commit.

Artifact identity and manifests, matrix configuration, memberships, runtime definitions, scan identities and report content cannot be edited or deleted in place. Manifests use PostgreSQL `json` to preserve conditional export key order; their original text cannot be replaced even with an order-only change. The latest nonempty registry tag observation and its timestamp are separate mutable metadata. Exact-version resolution does not fetch tags, so its empty tag map leaves previous observations intact. Tags never determine artifact identity or cache reuse.

A runtime digest can be registered again with the same definition; the original registration timestamp is retained. Image quarantine and matrix enablement are separate mutable fields. Matrix image IDs and artifact/image block subjects are normalized UUIDs. Once preparation results are known, their lock, snapshot generation and digest cannot change. Worker assignment can change while preparation is in progress; sealed snapshot locality is fixed. Eviction only clears availability. PostgreSQL verifies the SHA-256 of retained lock bytes.

Variable data has database byte bounds: manifests 2 MiB, tag observations 64 KiB, locks 16 MiB, preparation metadata 4 MiB, stored plans 8 MiB, preparation diagnostics 256 KiB, run evidence/reports 20 MiB, run logs 4 MiB, and small configuration/audit data 16 KiB. The engine's stricter per-session and whole-scan budgets still apply before persistence. The private API divides those budgets among the actual planned runtime groups and validates checkpoint consistency before persistence.

## Admission transaction

Registry resolution happens before `admitScan`. The function validates the exact public artifact, matrix UUID, classifier revision and pseudonymous requester key. It takes one short transaction-level advisory lock shared by admission and administrative policy writes. At the initial twenty-scan queue limit, this makes global quotas straightforward to enforce across web processes without Redis or distributed counters. No database connection is held while installing or running packages. Revisit lock granularity only if measured admission latency requires it.

Admission follows this order:

1. Record the exact artifact observation. Changed integrity for an existing package/version flags every observation and excludes old cached evidence; it never rewrites the original artifact.
2. Reject disabled/unknown matrices, quarantined images, integrity anomalies and active package/artifact/image/harness/probe blocks.
3. Return a valid report for the requested classifier revision, or an already active scan, without consuming new-work quota.
4. Enforce `admission_v4`: at most twenty requested scans globally, two active and ten new scans per hour per requester, and five minutes between new scans of the same package/version. Active means requested, preparing, running or aggregating. Replies include a retry interval. Admission derives aliases for the retained daily pseudonyms so active work and the rolling-hour quota continue across UTC midnight. Only the current pseudonym is stored; hourly throttling reports the remaining oldest-request window.
5. Reuse a pending preparation with an active job, or an available ready preparation on a healthy worker, where the selected matrix has no previous scan, or an authorized controlled rescan references its terminal parent. Otherwise create a new resolution generation. Insert the scan and, when a new preparation is needed, its unique preparation job atomically.

Controlled [maintainer rescans](monitoring.md) add an immutable observation revision and parent scan ID. A parent has at most one child; concurrent requests reuse it. The parent must be terminal with cleanup confirmed. Its reports remain unchanged, and another active observation defers the rescan.

The cooldown spans matrices and requesters. A completed scan without a usable report can be admitted again after the cooldown, using a new preparation generation. Admission does not silently reset an old scan or change its matrix. Ready/preparing shared preparations retain their original preparation job; reconciliation advances dependent scans and creates run/aggregation jobs. Ready reuse requires complete snapshot metadata and a recently seen, reconciled owner session. Legacy snapshots remain historical evidence and cannot be silently dispatched through the new protocol.

All callers that create public work must use this transaction. The database account belongs only to trusted control services. Raw worker clients must not receive it. Registration, quarantine, blocking and invalidation functions are private administrative primitives, not authentication or public endpoints; operator authorization arrives with the control and operations slices. Actor/reason records are required for their mutations.

Requester keys are rotating keyed pseudonyms produced by the [trusted ingress layer](website.md#public-boundaries), never raw IP addresses. Rows store a seven-day expiry. The scheduled removal of expired keys and the remaining retention policies belong to the pre-launch operations gate. Public admission stays disabled until those controls exist.

## Reads and invalidation

`findCachedReport` performs one policy-aware SQL query and returns IDs only. It excludes invalidated/superseded reports, mismatched classifier revisions, blocked inputs, changed artifacts, quarantined images and disabled matrices. Snapshot eviction does not invalidate a historical report. Callers must use this lookup for cache reuse rather than selecting a report by package name alone. Old report payloads remain available for historical explanation through the public report API.

Indexes support exact artifacts, preparation reuse, active requester counts, the requested queue, package cooldown, current reports, runnable jobs and worker leases. The pool has ten connections with finite connection, statement and lock waits. Idle connection loss emits a bounded diagnostic without exposing the connection URL.

## Migrations and qualification

Build before applying migrations:

```sh
pnpm build
DATABASE_URL='postgres://USER:PASSWORD@HOST/DATABASE' pnpm db:migrate
```

Run migrations once as a release step using a migration-capable role. Concurrent invocations share a PostgreSQL advisory lock. A transaction applies pending migrations and records SHA-256 checksums. Changed, missing, duplicated or reordered migration history is rejected; a failed migration rolls back both DDL and its history entry. Do not edit applied files. Use additive expand/contract migrations and test on restored data before destructive changes. Older application queries must remain compatible during rollout; running an older migration set against newer history intentionally fails.

For local integration testing, start a disposable database. It executes only trusted PostgreSQL code and authored fixtures; scanned packages still require the separate Linux/runsc host.

```sh
docker run --detach --rm --name compatlab-catalog-test \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_PASSWORD=compatlab-test --env POSTGRES_DB=compatlab_test \
  --tmpfs /var/lib/postgresql:rw,size=512m \
  postgres:18.6-bookworm@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650

docker exec compatlab-catalog-test pg_isready -U postgres -d compatlab_test
COMPATLAB_TEST_DATABASE_URL='postgres://postgres:compatlab-test@127.0.0.1:55432/compatlab_test' pnpm test:database
docker stop compatlab-catalog-test
```

Wait for `pg_isready` to report acceptance before running tests. The suite requires a test role with database-creation privileges and an address whose database name begins with `compatlab_test`. It creates uniquely named disposable databases and deletes only those databases. Each test starts with a clean catalog and real PostgreSQL constraints; concurrent tests drain every request before cleanup.

The required `Database qualification` CI job runs the pinned image on Linux. Tests cover concurrent deduplication and quotas, cache lookup under policy changes, natural keys, immutable identities, matrix foreign keys, JSON/lock bounds, transaction rollback, migration races/checksums, and additive upgrade compatibility. `pnpm check` checks source/test types and runs unit tests; it does not substitute mocks for the database gate. `skipLibCheck` applies to TypeScript projects importing the catalog, including the operator CLI and test projects, because Drizzle's declarations reference optional drivers for other databases. Project source remains strict.

References: [PostgreSQL advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS), [PostgreSQL 18.6 release notes](https://www.postgresql.org/docs/release/18.6/), [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql), [Drizzle transactions](https://orm.drizzle.team/docs/transactions).
