# Persistent catalog and admission

`@compatlab/catalog` is the private PostgreSQL data layer. It uses PostgreSQL 18.6, Drizzle ORM 0.45.3 and node-postgres 8.23.1. It reserves work and provides policy-aware report lookup. It does not dispatch jobs, expose an HTTP API, classify evidence, or execute packages. Those components arrive in slices 08–11.

## Data and identities

The SQL migration is the schema authority. `src/schema.ts` provides typed Drizzle mappings; integration tests compare every mapped column with PostgreSQL. Handwritten SQL holds checks, composite foreign keys, indexes and triggers that need explicit review. Do not run a schema-push command against this database.

| Tables | Responsibility |
|---|---|
| `packages`, `package_versions` | Exact artifact identity, ordered manifest, latest observed tags and changed-integrity flags |
| `preparations` | Profile/platform and resolution generation, retained lock bytes/digest, sealed snapshot generation, tree digest and worker locality |
| `runtime_images`, `matrices`, `matrix_members` | Approved immutable runtime definitions and ordered matrix configuration |
| `scans`, `runs` | Preparation/matrix identity, lifecycle, per-image/mode/group evidence and bounded logs |
| `jobs`, `workers` | Durable work identities and fields for the later claim/lease protocol |
| `reports` | Immutable classifier revisions/payloads with separate invalidation/replacement metadata |
| `blocks`, `audit_events` | Policy exclusions and append-only administrative history |

There are thirteen domain tables plus migration history. Matrix membership is a join table so PostgreSQL can reject a run whose image is outside its scan's matrix. Membership must be complete, contiguous, ordered, and contain unique profiles and image IDs. A deferred constraint checks the complete matrix at transaction commit.

Artifact identity and manifests, matrix configuration, memberships, runtime definitions, scan identities and report content cannot be edited or deleted in place. Manifests use PostgreSQL `json` to preserve conditional export key order; their original text cannot be replaced even with an order-only change. The latest nonempty registry tag observation and its timestamp are separate mutable metadata. Exact-version resolution does not fetch tags, so its empty tag map leaves previous observations intact. Tags never determine artifact identity or cache reuse.

A runtime digest can be registered again with the same definition; the original registration timestamp is retained. Image quarantine and matrix enablement are separate mutable fields. Matrix image IDs and artifact/image block subjects are normalized UUIDs. Once preparation results are known, their lock, snapshot generation and digest cannot change. Worker assignment can change while preparation is in progress; sealed snapshot locality is fixed. Eviction only clears availability. PostgreSQL verifies the SHA-256 of retained lock bytes.

Variable data has database byte bounds: manifests 2 MiB, tag observations 64 KiB, locks 16 MiB, preparation diagnostics 256 KiB, run evidence/reports 20 MiB, run logs 4 MiB, and small configuration/audit data 16 KiB. The engine's stricter per-session and whole-scan budgets still apply before persistence. These column limits do not replace result validation in the later private job API or classifier.

## Admission transaction

Registry resolution happens before `admitScan`. The function validates the exact public artifact, matrix UUID, classifier revision and pseudonymous requester key. It takes one short transaction-level advisory lock shared by admission and administrative policy writes. At the initial twenty-scan queue limit, this makes global quotas straightforward to enforce across web processes without Redis or distributed counters. No database connection is held while installing or running packages. Revisit lock granularity only if measured admission latency requires it.

Admission follows this order:

1. Record the exact artifact observation. Changed integrity for an existing package/version flags every observation and excludes old cached evidence; it never rewrites the original artifact.
2. Reject disabled/unknown matrices, quarantined images, integrity anomalies and active package/artifact/image/harness/probe blocks.
3. Return a valid report for the requested classifier revision, or an already active scan, without consuming new-work quota.
4. Enforce `admission_v1`: at most twenty requested scans globally, two active scans per requester, and five minutes between new scans of the same package/version. Active means requested, preparing, running or aggregating. Replies include a retry interval.
5. Reuse a pending preparation with an active job, or an available ready preparation on a healthy worker, where the selected matrix has no previous scan. Otherwise create a new resolution generation. Insert the scan and, when a new preparation is needed, its unique preparation job atomically.

The cooldown spans matrices and requesters. A completed scan without a usable report can be admitted again after the cooldown, using a new preparation generation. Admission does not silently reset an old scan or change its matrix. Ready/preparing shared preparations retain their original preparation job; slice 08 will advance dependent scans and create run/aggregation jobs.

All callers that create public work must use this transaction. The database account belongs only to trusted control services. Raw worker clients must not receive it. Registration, quarantine, blocking and invalidation functions are private administrative primitives, not authentication or public endpoints; operator authorization arrives with the control and operations slices. Actor/reason records are required for their mutations.

Requester keys must be rotating keyed pseudonyms produced by the future trusted ingress layer, never raw IP addresses. Rows store a seven-day expiry. The scheduled removal of expired keys and the remaining retention policies belong to the pre-launch operations gate. Public admission stays disabled until those controls exist.

## Reads and invalidation

`findCachedReport` performs one policy-aware SQL query and returns IDs only. It excludes invalidated/superseded reports, mismatched classifier revisions, blocked inputs, changed artifacts, quarantined images and disabled matrices. Snapshot eviction does not invalidate a historical report. Callers must use this lookup for cache reuse rather than selecting a report by package name alone. Old report payloads remain available for historical explanation; no public report API is implemented yet.

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

The required `Database qualification` CI job runs the pinned image on Linux. Tests cover concurrent deduplication and quotas, cache lookup under policy changes, natural keys, immutable identities, matrix foreign keys, JSON/lock bounds, transaction rollback, migration races/checksums, and additive upgrade compatibility. `pnpm check` checks source/test types and runs unit tests; it does not substitute mocks for the database gate. `skipLibCheck` is confined to the catalog and database-test TypeScript projects because Drizzle's declarations reference optional drivers for other databases. Project source remains strict.

References: [PostgreSQL advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS), [PostgreSQL 18.6 release notes](https://www.postgresql.org/docs/release/18.6/), [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql), [Drizzle transactions](https://orm.drizzle.team/docs/transactions).
