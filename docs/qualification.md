# Public MVP qualification

PR 11 adds repeatable operational and 100-version corpus gates. Evidence below is tied to test runs; it does not claim the service has been deployed publicly. Demand interviews remain product work and were explicitly waived as a prerequisite to implementing PRs 12–14.

## Acceptance mapping

| PRD criteria | Implementation and executable evidence |
|---|---|
| 1–2: discovery and exact versions | `packages/engine/test/registry.test.ts`, catalog public integration tests and Playwright scoped/unscoped flows |
| 3–5: integrity, hostile archives, scripts | Preparation qualification exercises pinned npm, source/integrity enforcement, extraction containment and script sentinels |
| 6: same dependency snapshot | Preparation/runtime/engine qualification records and compares lock, snapshot/tree identities and profile across runtimes |
| 7–8: independent probes, native prerequisites | Runtime/engine fixture gates cover conditional exports, TLA, subpaths, native/prebuilt outcomes and cause labels |
| 9–11: containment and bounds | Worker qualification uses Linux amd64/runsc for internet, metadata, host, sibling, archive, CPU/memory/process/disk/output and cleanup tests |
| 12: protocol trust | Sandbox smoke and contract tests reject fake stdout verdicts, missing completion and abnormal exits; package-process attestation is not claimed |
| 13–17: classification, provenance, evidence | Catalog report integration and classifier tests preserve raw observations, distinguish infrastructure from package causes, and expose coverage/limits/identities/log markers |
| 18–20: deduplication, durable progress, sharing | PostgreSQL concurrency, orchestration and report/API tests plus Playwright refresh, cached view, download and stable URL flows |
| 21: CLI/replay | CLI contract tests, [execution guide](probe-execution.md), runtime doctor, explicit missing-snapshot failure and rebuild qualification |
| 22: browser/accessibility | Playwright Chromium, Firefox, WebKit and mobile, axe checks, keyboard focus and responsive flows against a production build |
| 23: operator controls | Operations PostgreSQL tests cover drain, cancellation, cleanup fencing, retries, quotas, retention and immutable audits; role tests exercise the deployed grants |
| 24: recovery | Actual encrypted off-host upload/retrieval drill, fresh PostgreSQL restore, production execution-host provisioning recipe and explicit snapshot rebuild |
| 25: public operating contract | `/methodology`, `/privacy`, `/terms`, `/security`, repository security policy and [operations runbook](operations.md); real contact and deployment configuration are release checks |

Browser and database fixtures are authored evidence for their respective layers. They never qualify execution containment. The Linux/runsc gates execute actual untrusted package code. Do not substitute ordinary Docker when those gates fail.

## Measured checks

The initial catalog saturation drill submits 40 distinct requests concurrently through four independent pools against PostgreSQL on the testing devbox. It admits 20 and throttles 20 without exceeding the queue bound. The observed batch took 3,437 ms, with p50 2,137 ms, p95 3,300 ms and a subsequent status query of 7 ms. This includes SSH tunnel latency and is a modest admission burst, not a sustained throughput benchmark. The configured `admission_v2` limits are 20 queued globally, 2 active and 10 new scans/hour per anonymous requester, and a 5-minute package/version cooldown. Do not raise them on this evidence alone.

The off-host backup drill transferred a 64,666-byte encrypted synthetic catalog from the development machine to the separate Linux devbox, retrieved it, and verified reports, exact locks, audits and migration checksums on a second fresh PostgreSQL instance. The complete drill took 6,833 ms, including 2,017 ms for authenticated decryption, fresh-instance startup, restore and comparison. Archive SHA-256: `ff5f4115afaaf20c1471e7d209dea68d7c3b6f90ec9f90e3de231a6d0f2f8cf0`. CI repeats the transport/encryption/restore regression using disposable loopback SSH. The corpus assessment will be recorded here after the release-qualification workflow completes.

## Corpus review

The fresh-host recipe completed on the disposable Ubuntu runner, followed by the sandbox and hostile-worker suites. The snapshot-loss drill at commit `3d3fe71` completed in 14,535 ms: retained lock restored, 16 group records with complete coverage and all observed loads passing, original image definitions preserved, and a new snapshot generation recorded. [Execution rebuild evidence](https://github.com/siddiksawani/CompatLab/actions/runs/37156014403) accompanies the workflow.

`fixtures/corpus/public-v1.json` pins 100 unique public npm package versions and published integrities, spanning utility libraries, parsers, HTTP clients/servers, UI libraries, WebAssembly, native addons and packages with prerequisites. Ten independent Linux/runsc shards run the actual hosted control/worker/report path. Every report must contain four runtime profiles and sixteen independent cells, the pinned integrity and an observation timestamp. Infrastructure outcomes fail the gate and require investigation; package/prerequisite outcomes remain evidence rather than being rewritten as passes.

At commit `3d3fe71`, all 100 versions completed preparation and produced the expected 1,600 report cells with zero infrastructure failures. The aggregate report outcomes were 84 pass, 13 inconclusive and 3 partial. Median end-to-end scan time was 14,585 ms, p95 23,509 ms, and the slowest scan took 104,417 ms. These are smoke observations under the pinned Linux profile, not universal compatibility scores. The [per-version record](qualification/public-corpus-v1.csv) retains outcomes, coverage, report IDs, lock digests and snapshot generations.

Representative reports were inspected alongside every package's summary:

| Package | Observation and interpretation |
|---|---|
| `zod@4.6.5` | Enumerated entries load, but `./v4/locales/*` remains omitted by policy. The aggregate stays inconclusive instead of implying complete export coverage |
| `hono@4.13.12` | Runtime-specific adapters reference their runtime globals: Node fails Deno/Bun adapters, while each native runtime loads its own adapter. Independent subpath results preserve the differences; wildcard omission also remains visible |
| `react-dom` | Root cells pass. Subpath loading reaches the process time limit after recorded observations, leaving inconclusive completion rather than converting a timeout to a successful batch |
| `preact` | Server subpaths require an absent `preact-render-to-string` dependency. Root success does not hide those subpath failures |
| `yargs`, `svelte` | Inspectable subpath failures produce partial reports while independently successful root loading remains visible |
| `sharp@0.35.5`, `bcrypt@6.0.0`, `better-sqlite3@13.0.3` | Shipped native artifacts are recorded and roots load under all four profiles without running installer scripts. Loading alone does not prove native API behavior or another platform's support |
| `hash-wasm@4.12.0`, `xxhash-wasm@1.1.0` | Roots load across the selected profiles; no claim is made that their hashing APIs were behaviorally asserted |

Each shard uploads full report envelopes plus per-package timing, queue wait, coverage, outcome and cell duration/failure summaries. [The corpus workflow](https://github.com/siddiksawani/CompatLab/actions/runs/37156014403) passed all ten shards. CI artifact retention is 14 days; the reviewed summary remains in Git. A changing npm registry or unavailable tarball is an explicit failed qualification, not permission to substitute an unrecorded artifact.

## Release boundary

The checked-in deployment defaults to admission disabled. The devbox is used only for tests. No public VPS/domain, GitHub App, Sentry destination, permanent backup target or notification service is created by these checks. Real deployment still needs the operator configuration and release decision described in the runbook. Recovery timings for small fixtures do not establish the four-hour RTO at production data volume.
