# Execution worker lifecycle

The worker runs on a dedicated Linux amd64 host. It requires the checksum-pinned runsc release `release-20260928.0`, registered at `/usr/local/bin/runsc` with exactly `--platform=systrap`, and the local Docker socket. Host checks reject a changed runtime registration. Runtime policy `runtime_limits_v2` includes the lifecycle controls below. Earlier local report policies are not silently replayed under this policy.

## Ownership and recovery

`ExecutionSupervisor` holds an OS file lock for the entire operation. The lock survives neither an exited owner nor a disconnected holder, and records the supervisor PID plus its process start identity. Another supervisor cannot take live resources. Stop earlier worker versions before upgrading to this ownership protocol; all managed resources on the execution host belong to this one supervisor.

Before admission, recovery removes CompatLab-labeled containers, preparation networks and their firewall rules, abandoned output mounts, and incomplete preparations. It preserves valid sealed snapshots. Job and snapshot directories must be UUID-named, root-owned and private, with trusted parent directories. Unexpected ownership or cleanup failure stops admission instead of guessing which files are safe to remove.

Before advertising retained snapshots to the control service, the worker restores any mounts lost during a host restart. It accepts only private, root-owned storage with regular, bounded backing files and trusted mount directories, then mounts the sealed ext4 volume read-only without journal replay, device access or setuid privileges. Existing mounts with changed policies are rejected. Reuse verifies the original lock and tree digests; recovery never reinstalls dependencies or changes a snapshot's identity.

Changing the state directory retires the previous directory's snapshot cache before admitting work in the new directory. Retained reports and lock files stay in the previous directory. Returning there requires rebuilding evicted snapshots explicitly. This prevents multiple state directories from accumulating independent cache budgets.

Creation and startup are separate Docker operations. Cancellation after creation prevents package startup, and every execution path removes the container before output cleanup. The supervisor combines user cancellation, the scan deadline and host-lease loss. It drains active operations before releasing ownership. The [remote agent](orchestration.md) also enforces durable job leases with a monotonic deadline and renews them while submitting results. Local ownership and remote leases protect different failure boundaries.

Low-level preparation/backend functions remain internal interfaces for the supervisor and qualification fixtures. They must not be exposed directly through an API. The local CLI uses the supervisor for its full lifecycle.

## Capacity and storage

The capacity pool admits at most three jobs, including at most one preparation. A runtime reserves 1.5 GiB memory and 8 MiB output storage; preparation reserves 3 GiB memory (including proxy/runtime overhead) and 2 GiB disk. The host keeps 1 GiB memory and 2 GiB disk headroom. Available memory and disk are checked before dispatch; reservations are conservative and may reduce usable slots below three. These are versioned initial limits, not throughput claims.

Waiting work honors cancellation. When another scan is waiting, it takes priority over additional work for a scan already using slots. A normal completed cleanup releases its reservation. A failed cleanup keeps the reservation and stops admission until resource recovery succeeds. The pool's unit tests cover contention, one-at-a-time preparation, low resources, cancellation and cleanup failures.

A quarantined supervisor also keeps snapshot references: a failed cleanup cannot establish that every reader has stopped. Recovery must remove abandoned resources before those snapshots become eligible for collection.

Sealed snapshots have an 8 GiB allocated-byte ceiling and a seven-day cache lifetime. Before preparation, collection reserves space for the maximum new volume and excludes pinned snapshots. Preparation and probing run inside `withScan`; each active scan holds its own snapshot references. Scope completion, failure or cancellation drains outstanding operations and releases those references. Shared snapshots remain protected until their last active scan ends. Cache eviction removes workspace bytes without editing reports or retained locks. A subsequent reuse request fails visibly; rebuilding requires the explicit CLI option. Shared npm caches remain disabled. Every preparation uses a private cache, and runtime probes mount only the same verified sealed snapshot.

Each runtime retains the existing memory/CPU, guest-process, temporary filesystem, output filesystem and emitted-log bounds. Output byte/inode exhaustion is recorded as a resource limit. Actual container state distinguishes OOM and package exit codes from Docker startup failures. The scan deadline continues through subsequent work and waits.

The guest process/thread limit is 128 through `RLIMIT_NPROC`. The host cgroup allows 512 tasks to account for systrap's sandbox and executor threads. A host limit of 128 exhausted runtime overhead before the guest fork limit in qualification; policy v2 separates those limits. The worker gate measures the cgroup CPU, memory and host-task limits and checks that cancellation leaves no processes in that cgroup.

## Qualification

On a disposable execution host with the pinned setup:

```sh
pnpm build
sudo "$(command -v node)" scripts/worker-smoke.mjs
```

The suite exercises all four runtime images against host files/secrets, sockets, sibling files and networking, public/metadata/IPv6/DNS egress, read-only mounts, temp/output/inode limits, memory exhaustion, CPU loops, output flooding, native fork/thread pressure, detached children, user cancellation and scan expiry. It also checks direct preparation-network bypass and forbidden proxy targets, kills a live supervisor during work, reconciles its containers/networks/firewall/mounts, and verifies sealed snapshot reuse and eviction. A missing-mount regression restarts the supervisor, checks its ready inventory, and loads the unchanged snapshot in every runtime. Preparation archive, integrity and download-budget attacks remain in the required preparation gate; the 50-version-per-runtime engine gate remains required.

Qualification demonstrates these tested boundaries under the pinned configuration. `doctor` still reports prerequisites only. A deployment host must run the suites itself; public admission remains disabled until the durable-control and launch gates pass. See [gVisor's resource model](https://gvisor.dev/docs/architecture_guide/resources/) for host versus sandbox accounting.
