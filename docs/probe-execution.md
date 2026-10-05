# Local probe execution

The local engine loads public npm artifacts inside pinned runsc containers. It records raw loading evidence, static manifest observations, exact images, snapshot identity and coverage. The catalog adds versioned [classification and public report reads](reports.md). The worker runs with the [qualified lifecycle profile](worker-lifecycle.md).

## Build the CLI

The CLI is a private workspace package in this repository, not a published npm package. A report download does not install a global `compatlab` executable. Do not use `npx compatlab` or install an unrelated package to resolve `command not found`.

Use Node.js 24.21.0 and pnpm 12.8.1, as pinned in `.node-version` and `package.json`. From a qualified Linux amd64 execution host:

```sh
git clone https://github.com/siddiksawani/CompatLab.git
cd CompatLab
pnpm install --frozen-lockfile
pnpm build
pnpm cli --help
sudo "$(command -v node)" apps/cli/dist/bin.js doctor --json
```

`pnpm cli` invokes `apps/cli/dist/bin.js` from the repository root. Execution needs root, so the examples below invoke that compiled file with the selected Node binary through `sudo`. On macOS or Windows, use SSH to a qualified Linux machine or a dedicated VM; Docker Desktop is not this execution environment.

## Commands

Use a dedicated Linux amd64 host with local Docker/runsc, root mount/firewall privileges, bridge netfilter, and the [preparation prerequisites](preparation.md). `doctor` detects prerequisites without qualifying the host. There is no host-execution fallback, remote Docker endpoint, arbitrary image, or custom command option. Never start a separate CLI supervisor on an active hosted worker: execution ownership and recovery are host-wide, even with a different `--state-dir`.

```sh
pnpm build
sudo "$(command -v node)" apps/cli/dist/bin.js check is-number@7.0.0 --matrix initial_v1 --json
sudo "$(command -v node)" apps/cli/dist/bin.js reproduce /var/lib/compatlab/reports/REPORT_ID.json --json
sudo "$(command -v node)" apps/cli/dist/bin.js reproduce /var/lib/compatlab/reports/REPORT_ID.json --rebuild --json
```

Names must include an exact version; scoped packages use `@scope/name@version`. The default state directory is `/var/lib/compatlab`, private to root. `--state-dir` selects an operator-owned local directory. The initial setup builds approved runtime images and stores their actual immutable IDs. Missing images or mismatched image metadata fail closed.

Each successful command saves a bounded JSON report, the exact lock bytes, and the sealed snapshot. Exit 0 means all applicable planned loading observations completed successfully; 1 means a loading failure or incomplete coverage; 2 means invalid arguments; 3 means the operation could not run. Text output shows compact coverage; JSON includes bounded evidence. Loading success does not exercise arbitrary exported functions or prove general compatibility.

Reproduction defaults to verified reuse of the actual retained snapshot. Missing, changed or unmounted snapshots fail visibly. `--rebuild` installs from the retained validated lock with scripts disabled and records a new generation. It never silently calls a rebuild a reuse. Runtime image IDs must still be available and approved. Retained state must accompany a copied report for verified reuse. Workspace eviction and startup recovery follow the worker lifecycle policy.

## Replay a hosted report

Hosted replay currently requires operator assistance. The reproduction JSON and lock download do not contain the CLI, runtime images or sealed workspace. Production runtime images are not yet published for public pulling. Their `sha256:...` IDs are local Docker image identities, not registry download addresses. A new `check` builds local images and creates new evidence; it does not make those images identical to a hosted report's images.

1. Build the CLI on a separate qualified replay host as above. Use a source revision supporting the report's preparation, harness, policy and runtime profiles. Unavailable historical profiles fail closed.
2. Download **Reproduction inputs** and **Exact package lock** from the report. Place both in the repository root, keeping the report-specific JSON filename and naming the lock `package-lock.json`.
3. Have the originating worker's operator export the exact image IDs listed in the descriptor with `docker image save --output runtime-images.tar <image IDs>`. Load that operator-supplied archive on the replay host with `docker image load --input runtime-images.tar`. Do not rebuild or edit the descriptor to bypass missing images. The CLI verifies image identity, platform and provenance before replay.
4. From the repository root, run the report's command, for example:

```sh
sudo "$(command -v node)" apps/cli/dist/bin.js reproduce ./REPORT_ID-reproduction.json --rebuild --lockfile ./package-lock.json --json
```

This rebuilds from the exact retained lock with scripts disabled, while keeping the recorded runtime images. It creates a new snapshot generation; compare the tree digests before claiming identical installed bytes. Unavailable registry artifacts can still prevent rebuilding. The command returns exit 1 when it ran but found loading failures or incomplete coverage, and exit 3 when execution could not run. A loading failure in a replay is evidence, not necessarily a broken CLI.

If `compatlab` is not found, use the source invocation above. If `apps/cli/dist/bin.js` is missing, check the current directory and run `pnpm build`. If backend detection fails, address the listed Linux/runsc prerequisites. If an exact runtime image is missing, obtain it from the operator; the CLI will not silently substitute another image.

## Execution method

Each runtime has separate root ESM and CommonJS jobs, followed by independent sequential subpath batches for both modes. Applicable subpaths retain their planned order. A batch shares module caches and globals; reports label it `sequential_batch_v2`. Root jobs use fresh sandboxes and `fresh_root_v2`.

The harness observes only loading and `typeof` the returned value. It does not enumerate exports, read exported getters or call functions. Native error fields come from data descriptors; arbitrary thrown values are not coerced. Observations include the runtime's resolution result when available. A runtime may substitute a built-in module (notably Bun for some package names); resolution evidence must be considered before claiming that published files executed.

Before each load, the harness atomically replaces a checkpoint naming the active index. Afterward it adds a bounded observation. The external supervisor checks identity, order, history, schema, byte bounds and progress. A root or batch completes only after exit zero and a matching completed checkpoint, without an overriding termination. Stdout/stderr are logs. Checkpoints are observations from the package process, not adversarial semantic attestations; malicious code in the same process can tamper with them.

An interrupted batch retains validated observations. A known crashing or timed-out entry is marked and skipped on continuation, with at most three restarts per mode/runtime. Unknown or malformed checkpoints stop continuation. Even if later entries succeed, the interruption remains visible and coverage is incomplete. Unattempted entries and planner omissions remain separate.

## Bounds

- Root/entry: 30 seconds; batch: 120 seconds; scan: 15 minutes from preparation/run start, including subsequent waits.
- At most 512 explicit subpaths; at most four sessions per subpath group.
- Each job has private 64 MiB temp and an enforced 8 MiB/64-inode result tmpfs.
- Root checkpoint: 64 KiB; batch checkpoint: 2 MiB; local report: 20 MiB.
- Error messages: 2,048 characters; stdout/stderr: 128 KiB each per job, 4 MiB retained per scan; terminate after 8 MiB emitted per job.

Limits never expand because a package requests more work. A checkpoint limit can leave incomplete coverage. The engine stops dispatch if accumulated evidence reaches the remaining report byte budget; the CLI returns an explicit limit error instead of allocating an oversized report. Containers are removed before reading final evidence and unmounting output. Preparation snapshots remain sealed for explicit reuse. Host capacity reservations and recovery are enforced by the worker supervisor.

## Qualification

`sudo "$(command -v node)" scripts/engine-smoke.mjs node_24_21_0` runs the engine gate for one profile. CI repeats it for all four pinned profiles. Each gate checks 40 authored package versions and 10 exact public versions, plus protocol cases for package exit codes, mixed observations, crash continuation, timeout continuation, restart exhaustion, shared batch state, fake stdout, malformed checkpoints, bounded errors, error getters and the 512-entry cap. Authored cases cover ESM/CJS/TLA, conditions, native/Wasm, dependencies, browser assumptions and safe export observation. Existing preparation tests independently verify npm extraction, aliases, bundled/optional dependencies and disabled scripts.

The Node 24 job also executes the compiled CLI across the full matrix, verifies snapshot reuse, and explicitly rebuilds from its retained lock. Shorter test-only deadlines exercise interruption without changing production policy defaults. Tests use disposable Linux/runsc hosts; downloaded package code never runs on the developer host.

Named maintainer assertions use a separate `assertion_v1` harness and do not change automatic loading evidence. Reproduction inputs can include a retained assertion bundle; the CLI replays it under the same limits. See [assertions and CI](assertions-and-ci.md) for the manifest, capability and archive contracts.
