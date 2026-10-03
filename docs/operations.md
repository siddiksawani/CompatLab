# Operations and deployment

The public MVP runs on a control VPS and a separate disposable Linux amd64 execution host. PostgreSQL, Next.js and Caddy share the control host. The worker has Docker and runsc; the web and control containers have neither a Docker socket nor package execution privileges. WireGuard connects the worker to the private control API. Public admission stays disabled until the release checklist passes and the maintainer chooses to launch.

## Build a release

Use a clean checkout of a reviewed commit, Node 24.21.0, pnpm 12.8.1, Docker with BuildKit/buildx, and Compose. Install dependencies with the frozen lockfile, run `pnpm check`, then:

```sh
node infra/configure.mjs compatlab.example /etc/compatlab
bash infra/build-release.sh /var/lib/compatlab-release-001
export COMPATLAB_CONFIG_DIR=/etc/compatlab
docker compose --env-file /var/lib/compatlab-release-001/release.env -f infra/compose.yaml config --quiet
docker compose --env-file /var/lib/compatlab-release-001/release.env -f infra/compose.yaml up -d postgres
```

Replace the example domain before generating configuration. The generator creates a new private directory outside the checkout, unique database passwords, requester/proxy secrets, and a backup encryption key. Keep it out of Git and image build contexts. Back up its keys separately using the operator's secret-storage process. Losing the backup key loses access to encrypted dumps.

Image builds produce immutable local image IDs and record the source commit. Build on the target architecture or distribute those exact images through a private registry by digest. Do not replace these IDs with mutable tags. The proxy builds checksum-verified Caddy 2.11.7; its base is pinned separately. Next.js runs as an unprivileged user with a read-only root filesystem and bounded memory. The control container shares the host network solely to bind its WireGuard address.

The PostgreSQL bootstrap creates three nonsuperuser application roles. Apply migrations with the separate migration credential, then install the grants file:

```sh
ADMIN_DATABASE_URL_FILE=/etc/compatlab/migration-url pnpm cli admin migrate --reason 'Initialize reviewed schema.'
docker compose --env-file /var/lib/compatlab-release-001/release.env -f infra/compose.yaml exec -T postgres psql -U postgres -d compatlab -v ON_ERROR_STOP=1 < infra/grants.sql
```

Reapply grants after migrations that introduce tables. The web role admits work and reads reports; it cannot change workers, results, service controls or schema. The control role reconciles execution and retention; it cannot admit arbitrary policy changes. The operator role has explicit table/column grants for its operations and cannot change migration history or delete execution rows. Database triggers append a reserved mutation event even for direct SQL writes. Operator-supplied annotations are stamped with the authenticated database role and transaction ID; the SSH actor is retained as a claimed actor. These triggers and immutable-identity constraints do not protect against the separate schema administrator. Only the migration credential owns schema changes. Never give that credential to the web, worker or routine operator process.

## Connect and qualify a worker

Provision only a fresh Ubuntu 24.04 amd64 execution machine:

```sh
sudo env COMPATLAB_FRESH_EXECUTION_HOST=1 bash infra/provision-worker.sh
export PATH=/opt/compatlab-node/bin:$PATH
pnpm install --frozen-lockfile
pnpm build
sudo /opt/compatlab-node/bin/node scripts/sandbox-smoke.mjs
sudo /opt/compatlab-node/bin/node scripts/worker-smoke.mjs
```

This installs pinned Docker, containerd, runsc and Node versions, enables bridge filtering and configures runsc with systrap. It modifies host services; never run it on a shared development machine. A successful build or fixture smoke alone is insufficient: run the hostile-code worker qualification before accepting public work. Retain the logs with the selected kernel, image IDs and commit.

Configure WireGuard using host-specific keys. Give the control host `10.44.0.1/32` and the worker `10.44.0.2/32`, with narrow peer AllowedIPs. Restrict the control TCP port 4871 to that interface and peer in both provider and host firewalls. Publicly expose only SSH from operator addresses and Caddy 80/443; PostgreSQL remains loopback-only. Test from an unrelated host that database/control ports are inaccessible. The control process independently refuses to start unless the configured address belongs to a real WireGuard interface.

On the qualified worker, export the exact runtime image definitions and capabilities with `sudo node infra/worker-images.mjs /etc/compatlab/runtime-export` (create that private directory first). Transfer those JSON files to the control operator. Register each runtime with `pnpm cli admin runtime-register FILE --reason TEXT`. Create a matrix JSON with a unique `revision`, `preparationProfile: npm_11_19_0_linux_amd64_v2`, `harnessRevision: load_v2`, `planRevision: explicit_exports_v1`, `policyRevision: runtime_limits_v2`, and the returned `imageIds` in display order. Register it with `admin matrix-register FILE --reason TEXT`.

Set `PUBLIC_MATRIX_ID` in the web environment to the returned UUID. Register `worker-capabilities.json` with `admin worker-register FILE --reason TEXT`; capture the one-time token in a private file on the worker. The catalog retains only its hash. Configure the worker using `infra/worker.env.example`, install `infra/compatlab-worker.service`, and enable it. Never place control/database/GitHub/Sentry/backup credentials in the worker environment. Start web, control and proxy using Compose once WireGuard and the matrix are ready. Verify `/healthz` through HTTPS and `admin status`. Leave `PUBLIC_SCANS_ENABLED=false` until launch approval.

## Routine controls

Set `ADMIN_DATABASE_URL_FILE=/etc/compatlab/operator-url` in an SSH operator shell. `pnpm cli admin --help` lists all commands. Mutations require a meaningful `--reason`; the actor comes from the OS account. Use individual SSH accounts where attribution matters. The CLI has no public HTTP endpoint.

| Operation | Command and effect |
|---|---|
| Inspect | `status` shows queue age, worker heartbeat/cleanup, database size, infrastructure failures, backup age and retention backlog; `host-status /var/lib/compatlab` reports free bytes/inodes and exits unsuccessfully below 4 GiB free |
| Pause | `pause` atomically stops new admissions; existing scans and cached reports remain accessible. `resume` reopens admission |
| Drain | `worker-drain UUID` rejects new claims while allowing existing leases to complete. Queued work requires resume or retirement. `worker-resume UUID` refuses unresolved recovery or quarantine |
| Fence | `worker-quarantine UUID` rejects execution authority; `worker-revoke UUID` permanently revokes its token. Neither claims that host cleanup happened |
| Retire | `worker-retire UUID --confirm-host-destroyed` is only for a host already powered off/destroyed and isolated from the network. It fences credentials, marks snapshots lost, and releases held capacity with an audit. Unfinished preparation can retry within its original attempt/deadline bounds |
| Policy | `block package\|artifact\|image\|harness\|probe SUBJECT`, `unblock UUID`, `runtime-quarantine UUID`, `runtime-approve UUID`, `matrix-disable UUID`, `matrix-enable UUID` |
| Cancel | `cancel SCAN_UUID` retains capacity until cleanup is confirmed. Cancellation during shared preparation cancels all affected scans, returned in the result |
| Retry | `retry SCAN_UUID` requires a terminal infrastructure failure and confirmed cleanup. It creates new identities instead of overwriting evidence; admission limits still apply |
| Correct | `invalidate REPORT_UUID` records a reason and prevents cache reuse; `reclassify SCAN_UUID` creates a classifier revision without changing observations |
| Remove logs | `remove-logs SCAN_UUID` removes retained logs for a terminal scan and audits the request; structured observations and the original classification remain |
| Retain | `retention` removes expired data in bounded batches of 1,000 rows per category; the control process runs it automatically every minute |

Audit entries cannot be edited or deleted within 180 days, including by routine operator credentials. Operators cannot backdate audit inserts or forge reserved database-mutation events. Apply a package block when reviewing recurring abuse. Never relabel infrastructure failures as package incompatibility to clear an incident.

## Backup and recovery

The recovery targets are RPO 24 hours and RTO 4 hours, with no high-availability SLA. A database and a control VPS remain single points of failure. Before launch, configure a separate backup host/account with restricted storage access, a pinned SSH host key, and enough space for seven days of archives. Install the Node toolchain on the control host too; the backup unit uses `/opt/compatlab-node/bin/node`.

Copy `infra/backup.env.example` to the private configuration directory, set the real target, install `compatlab-backup.service` and `compatlab-backup.timer`, and enable the timer. Run the service once immediately. The script streams a PostgreSQL custom-format dump, encrypts it using AES-256-GCM and a fresh nonce, uploads to a temporary name, verifies SHA-256 remotely, renames and syncs the archive, then audits success. Keys are never uploaded. Partial or failed uploads are not successful backups. Failed attempts remove their local encrypted copy and attempt removal of the remote temporary object; completed and abandoned remote temporary archives expire after seven days on the next successful connection. Dump size is bounded by available storage, reserving space for encryption and 1 GiB headroom. Both local and remote completed archives expire after seven days. Restrict the remote directory to this application; the retention command owns the `compatlab-*.clb` namespace there.

Restore procedure:

1. Pause public admission. Provision a clean control host and install the reviewed release and private configuration. Keep the old worker tokens fenced until reconciliation is complete.
2. Fetch the most recent verified archive from the separate host. Compare its digest with the successful backup audit/backup logs. Run `pnpm cli backup decrypt ARCHIVE OUTPUT_DUMP KEY_FILE` in a private directory. Decryption publishes no output until authentication succeeds.
3. Initialize a fresh PostgreSQL 18.6 instance and roles. Restore with `pg_restore --no-owner --no-acl --exit-on-error` into its empty `compatlab` database using the migration administrator. Never restore over a running production database.
4. Run `admin migrate` and apply `infra/grants.sql`. Verify report counts, immutable report JSON, exact locks and operator audit history against the backup record. Re-run `admin status` and `/healthz`.
5. Retire destroyed workers, provision/qualify replacements, register their new tokens/images, and rebuild lost snapshots only from retained exact locks. A rebuild records a new snapshot generation; it never claims reuse of the original bytes. Preserve unavailable replay status for missing snapshots until rebuilding succeeds.
6. Run the complete integration checks against the recovered environment before resuming admission. Remove plaintext dumps after validation and record actual elapsed recovery time.

`scripts/backup-qualification.mjs user@host:/private/test-directory` exercises the actual uploader, retrieval, authenticated decryption and restore into a second fresh PostgreSQL instance using synthetic report/lock/audit data. It creates only temporary test containers and removes its own uploaded archive. `scripts/rebuild-qualification.mjs` destroys an execution workspace and verifies explicit lock-based recovery under runsc. CI uses the production provisioning recipe on a disposable host. These are reproducible small-fixture drills, not a measured restore time for a mature production database; repeat at realistic volume before launch and after material growth.

## Health, privacy and release checks

The public `/healthz` checks database connectivity without returning details. Run `node scripts/availability-check.mjs https://REAL_DOMAIN` from an independent host at least once per minute and route failures through the operator's monitoring service. Check worker heartbeat older than 30 seconds, oldest queue age, infrastructure failures, backup success older than 24 hours, free disk below 4 GiB, and retention backlog. These checks require deployment-specific scheduling and notification destinations; no live monitor or Sentry project is provisioned by the repository.

Set an HTTPS `SENTRY_DSN` in web/control environments if used. Error events contain only an allowlisted operational name, timestamp and event ID; SDK default integrations, traces and personal-data collection are disabled. Package contents, network addresses, cookies, request bodies, credentials and user details are dropped. Default Caddy access logs are off, and error logs remove request details. Install the journald drop-in for a 14-day/1-GiB ceiling, taking account of other services sharing that journal. The public privacy page describes the default retention: logs 30 days, anonymous identifiers 7 days, snapshots/cache up to 7 days within 8 GiB, audits 180 days, backups 7 days, reports/locks indefinite.

Before launch verify TLS, DNS, firewall reachability, real backup destination/key escrow, restore timing at current volume, worker containment, secret rotation, privacy/security contact availability, independent uptime alerts and all [acceptance evidence](qualification.md). GitHub contact links require the repository/security-reporting feature to be accessible to intended users; configure and test that path before advertising it. Launch is an explicit maintainer decision after these checks, not a side effect of merging this PR.
