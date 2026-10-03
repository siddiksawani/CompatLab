# Delivery sequence

The approved project is divided into fourteen implementation PRs. PRs 1–11 deliver and qualify the anonymous public MVP; PRs 12–14 add the approved maintainer workflow after its validation gates. Optional P2 work, including private packages, teams and billing, remains outside this sequence and requires its own design review.

Each PR is independently reviewable, includes meaningful tests for its behavior, and merges before its dependent slice starts. The numbered slices are not a reason to combine unrelated fixes or skip a failed gate. Material scope changes require an updated plan.

| Slice | PR | Deliverable | Depends on | Required evidence |
|---|---|---|---|---|
| 01 | Repository foundation and execution contracts | TypeScript workspace, CLI doctor, bounded completion protocol, authored Linux/runsc smoke fixtures, CI and contribution policy | Empty repository baseline | Strict build/lint; protocol and CLI tests; Linux smoke distinguishes completion files from stdout and unsuccessful exits |
| 02 | Registry resolution and exact artifact identity | Scoped/unscoped discovery, abbreviated metadata, exact versions, integrity/source validation, bounded registry client | 01 | Mock-registry tests for moving tags, missing metadata, unavailable artifacts, redirects, retries, and response bounds |
| 03 | Sandboxed npm preparation and sealed snapshots | Consumer workspace, pinned installer, lock validation, disabled scripts, preparation proxy, bounded extraction, snapshot locality/reuse | 02 | Script sentinels, integrity/source rejection, hostile archives, optional/bundled dependencies, same actual sealed snapshot |
| 04 | Probe planning and runtime profiles | Manifest analysis, ordered exports, executable subpaths, native/platform indicators, pinned Node/Bun/Deno images and adapters | 03 | Conditional exports, ESM require/TLA, wildcard/asset exclusions, offline Deno writes, native prerequisites, variable matrix size |
| 05 | Root probes, subpath batches and usable CLI | Fresh root modes, ordered batches/checkpoints/restarts, coverage, local check/reproduce commands | 04 | 50 authored/real versions, interrupted batches, 512-entry work cap, evidence limits, fail-closed CLI and replay disclosure |
| 06 | Hardened worker and execution lifecycle | Production sandbox backend, quotas, egress controls, cancellation/descendant cleanup, capacity reservations, qualified cache reuse | 05 | Real runsc network/metadata/host/sibling, archive, CPU/memory/process/disk/output tests; no public execution until this gate passes |
| 07 | Persistent catalog and scan admission | PostgreSQL migrations, natural identities, preparations/scans/runs, immutable matrix selection, quotas and deduplication | 06 | Real PostgreSQL concurrent admission/uniqueness tests, bounded queue, invalidation lookup, migration compatibility |
| 08 | Private job API and durable orchestration | Scoped worker tokens, WireGuard-bound API, claims/leases, retries, locality, reconciliation, progress snapshots | 07 | Late/duplicate/conflicting submissions, expired leases, partitions, worker death, restart cleanup and fair dispatch |
| 09 | Classification, report storage and read API | Versioned normalization, coverage aggregation, report revisions, sanitized retained evidence, JSON/reproduction metadata | 08 | Package/infra distinction, reclassification preserving raw evidence, incomplete coverage, log limits/expiry, immutable identities |
| 10 | Anonymous website and report experience | Next.js search/version selection, admission, polling, report matrix, details and sharing | 09 | Playwright scoped/unscoped flows, refresh recovery, cached views without execution, keyboard/mobile/browser review |
| 11 | Operations, deployment and public MVP qualification | SSH admin CLI, audit/quarantine/drain controls, Compose/runbooks, backups, retention, error tracking and public documentation | 10 | All 25 MVP acceptance criteria; 100-package review; modest saturation test; restored backup and rebuilt execution host |
| 12 | Maintainer identity and repository authority | Better Auth/GitHub login, GitHub App linkage, minimal permissions, revocation/deletion and account quotas | 11 + demand gate | Authorization/CSRF/session tests, revoked access, token protection, accurate authority labels, anonymous flow unchanged |
| 13 | Release monitoring, comparisons and alerts | Registry reconciliation, controlled rescans, comparisons, deduplicated deliveries and evidence-linked badges | 12 | Missed releases, duplicate deliveries, meaningful-change rules, changed-input disclosure, notification retries independent of scans |
| 14 | Maintainer assertions and CI integration | Commit-pinned probes/offline fixtures, named assertion evidence, pre-publication CI source identities and documentation | 13 + threat-model review | Unauthorized probes rejected, resource/fixture bounds, immutable revisions, distinct `probe_verified` evidence and CI provenance |

## Review and release gates

PR 1 establishes an execution experiment, not a public scanner. Its fixed authored fixtures are the only executable input; the CLI cannot submit or load npm packages. Production preparation and isolation arrive in later PRs.

PRs 2–6 collectively close the M0/M1/M2 feasibility and worker gates. Stop and revise the design if shared snapshots, native-addon behavior, Deno parity, or containment cannot be demonstrated. Unit mocks cannot replace Linux/runsc evidence.

PRs 7–11 close durable-control, public-interface and launch gates. Include PostgreSQL integration tests when storage is introduced and browser tests when pages exist. Broad load characterization is required before increasing public limits. Deployment remains a separate release decision after the code and gates are ready.

On October 3, 2026, the maintainer explicitly authorized completing PRs 8–14 without waiting for the customer-demand gate. The targets of ten developer/maintainer reviews and five concrete monitoring/probe requests remain product-validation work, not completed evidence. Before PR 14, review custom-probe authority, inputs and sandbox exposure. Optional private/team execution needs an additional external security review. Public deployment still requires the launch gates and its own release decision.

## Repository workflow

- Repository: [siddiksawani/CompatLab](https://github.com/siddiksawani/CompatLab); maintainer: `siddiksawani`.
- The user approved a single empty bootstrap commit because GitHub requires a base for the first PR. It contains no project files. All project changes arrive through feature-branch PRs.
- Use descriptive numbered feature branches, such as `feat/04-probe-planning`. Commits and GitHub changes use the `siddiksawani` maintainer account.
- Keep CI actions and dependencies pinned. Require `Quality`, `Sandbox smoke`, `Preparation qualification`, `Runtime qualification`, `Engine qualification`, `Worker qualification`, `Database qualification`, `Orchestration qualification`, and `Browser qualification` for merges.
- Use squash merges and delete merged branches. No automatic merges or direct pushes to `main`.
- Keep PR descriptions focused on the resulting behavior, tests, and limitations. Update this sequence when a slice's scope changes.

The 31–49 engineering-day estimate in the architecture plan covers the public MVP (PRs 1–11). Re-estimate after the feasibility work. PRs 12–14 are separately estimated after demand and threat-model review.
