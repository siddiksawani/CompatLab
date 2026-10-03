# Local probe execution

The local engine loads public npm artifacts inside pinned runsc containers. It records raw loading evidence, static manifest observations, exact images, snapshot identity and coverage. Classification and public reports arrive in later slices. The worker remains experimental until the hostile lifecycle qualification in slice 06; public execution remains disabled until the launch gates pass.

## Commands

Use a dedicated Linux amd64 host with local Docker/runsc, root mount/firewall privileges, bridge netfilter, and the preparation prerequisites. `doctor` detects prerequisites without qualifying the host. There is no host-execution fallback, remote Docker endpoint, arbitrary image, or custom command option.

```sh
pnpm build
sudo "$(command -v node)" apps/cli/dist/bin.js check is-number@7.0.0 --matrix initial_v1 --json
sudo "$(command -v node)" apps/cli/dist/bin.js reproduce /var/lib/compatlab/reports/REPORT_ID.json --json
sudo "$(command -v node)" apps/cli/dist/bin.js reproduce /var/lib/compatlab/reports/REPORT_ID.json --rebuild --json
```

Names must include an exact version; scoped packages use `@scope/name@version`. The default state directory is `/var/lib/compatlab`, private to root. `--state-dir` selects an operator-owned local directory. The initial setup builds approved runtime images and stores their actual immutable IDs. Missing images or mismatched image metadata fail closed.

Each successful command saves a bounded JSON report, the exact lock bytes, and the sealed snapshot. Exit 0 means all applicable planned loading observations completed successfully; 1 means a loading failure or incomplete coverage; 2 means invalid arguments; 3 means the operation could not run. Text output shows compact coverage; JSON includes bounded evidence. Loading success does not exercise arbitrary exported functions or prove general compatibility.

Reproduction defaults to verified reuse of the actual retained snapshot. Missing, changed or unmounted snapshots fail visibly. `--rebuild` installs from the retained validated lock with scripts disabled and records a new generation. It never silently calls a rebuild a reuse. Runtime image IDs must still be available and approved. This release accepts local report files; remote report URLs arrive with the read API. Retained state and locks must accompany a copied report. Retention, eviction and restart recovery are subsequent worker/operations work.

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

Limits never expand because a package requests more work. A checkpoint limit can leave incomplete coverage. The engine stops dispatch if accumulated evidence reaches the remaining report byte budget; the CLI returns an explicit limit error instead of allocating an oversized report. Containers are removed before reading final evidence and unmounting output. Preparation snapshots remain sealed for explicit reuse. Full capacity reservations and recovery qualification arrive in slice 06.

## Qualification

`sudo "$(command -v node)" scripts/engine-smoke.mjs node_24_21_0` runs the engine gate for one profile. CI repeats it for all four pinned profiles. Each gate checks 40 authored package versions and 10 exact public versions, plus protocol cases for package exit codes, mixed observations, crash continuation, timeout continuation, restart exhaustion, shared batch state, fake stdout, malformed checkpoints, bounded errors, error getters and the 512-entry cap. Authored cases cover ESM/CJS/TLA, conditions, native/Wasm, dependencies, browser assumptions and safe export observation. Existing preparation tests independently verify npm extraction, aliases, bundled/optional dependencies and disabled scripts.

The Node 24 job also executes the compiled CLI across the full matrix, verifies snapshot reuse, and explicitly rebuilds from its retained lock. Shorter test-only deadlines exercise interruption without changing production policy defaults. Tests use disposable Linux/runsc hosts; downloaded package code never runs on the developer host.
