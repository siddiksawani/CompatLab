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

On October 4, 2026, the maintainer deferred the public maintainer workflow. The website now presents its purpose and planned features as **Coming soon**, with account controls removed from the public page. The existing backend foundation and historical evidence remain in the repository for later work. Do not enable GitHub accounts or the monitoring service as part of the current public experience. The follow-up frontend slice fixes layouts across public pages and verifies phone, tablet and large-screen use.

## Repository workflow

Production follow-ups use separate PRs for worker-outage admission/service hardening, production infrastructure/automatic deployment, and search discoverability. The user authorized deployment on October 4, 2026 using the [VPS and isolated home-worker design](deployment.md). Existing workloads on both machines must remain unaffected.

PR 24 follows the homepage feedback with explicit outcome counts, recent-report badges and 375-pixel layout qualification. Its public-discovery slice adds an API guide/catalog, contract-derived OpenAPI, Markdown summaries and content usage preferences. It does not add execution privileges, agent authentication or new sandbox behavior.

PR 25 fixes package selection when npm serves a selected-version manifest as `text/plain`. The bounded JSON parser and artifact validation still apply; regression tests cover valid and invalid plain-text responses and browser version selection.

PR 26 corrects local replay setup: report commands invoke the built source CLI, prerequisites precede copying, and hosted replay explicitly requires operator-supplied exact runtime images. Backend and missing-image errors explain the next step. Public CLI/image distribution remains future work.

PR 27 removes avoidable idle polling delays between worker jobs. Job completion wakes the next claim without increasing concurrency or weakening snapshot checks. Tests cover completion during claims, idle backoff, shutdown and the local capacity bound.

PR 28 publishes an evidence-led article about npm loading across Node.js, Bun and Deno. It adds an article index, canonical and article metadata, structured data, sitemap entries and links from the homepage. Published examples identify exact reports and distinguish loading, missing prerequisites and omitted coverage. It changes no execution behavior.

PR 29 distinguishes missing optional peers from runtime failures using retained manifest, installed-package and error evidence. It adds prerequisite explanations and counts to reports, previews and Markdown, preserves raw loading failures and historical report revisions, and makes absent diagnostics explicit. It changes no installation or sandbox behavior. Validation covers classification false positives, PostgreSQL aggregation/evidence preservation and browser presentation at phone and desktop widths.

PR 30 fixes retained snapshot reuse after a worker VM restart. The worker restores missing read-only mounts before advertising snapshots, validates backing storage and existing mount policy, and preserves snapshot identity and contents. Linux/runsc qualification covers concurrent restoration, unsafe backing rejection, startup inventory and actual loading through every runtime after mount loss.

### Discovery and adoption follow-ups

On October 9, 2026, the maintainer approved improving programmatic access, evidence discovery, focused coverage and a read-only MCP pilot. Deliver these as separate reviewable slices. Ordinary lookups must remain read-only, historical observations must retain their identities, and public maintainer accounts remain deferred.

| Slice | Deliverable | Validation |
|---|---|---|
| 31 | Expose eligible reports from earlier matrices without changing current-matrix reuse; retain evidence during active scans; review Cloudflare blocking of public readers | PostgreSQL selection/invalidation/integrity tests, browser search/package/Markdown flows, responsive review, independent production edge-access checks |
| 32 | Readable package/version pages, compact evidence summaries and optional agent documentation links | Canonical/404/scoped-name tests, summary fidelity, no work on reads, browser and sitemap checks |
| 33 | Minimal disclosed measurement of useful lookups and missing evidence; bounded curated coverage | Privacy/retention, deduplication, existing admission and worker-outage gates, foreground capacity protection; seed a small relevant corpus before expanding |
| 34 | Read-only MCP tools over the same public evidence contracts and a developer pilot | Protocol/client integration, limits, missing/historical report semantics, exact provenance; registry publishing requires the actual tested endpoint |

Slice 32 adds catalog-backed exact-version pages, compact report JSON and an optional `llms.txt` reading guide. It preserves observation URLs, admission behavior and training preferences. New package sitemaps share the bounded discovery query limit, and missing evidence returns 404 without registry access or work submission. The next slices remain planned.

Slice 31 adds `availableReport` while preserving `reportId` as the current-matrix selection. The initial validation plan for the later slices does not claim those features are implemented or that the pilot has users. Dependent slices follow the repository's merge and release gates.

- Repository: [siddiksawani/CompatLab](https://github.com/siddiksawani/CompatLab); maintainer: `siddiksawani`.
- The user approved a single empty bootstrap commit because GitHub requires a base for the first PR. It contains no project files. All project changes arrive through feature-branch PRs.
- Use descriptive numbered feature branches, such as `feat/04-probe-planning`. Commits and GitHub changes use the `siddiksawani` maintainer account.
- Keep CI actions and dependencies pinned. Require `Quality`, `Sandbox smoke`, `Preparation qualification`, `Runtime qualification`, `Engine qualification`, `Worker qualification`, `Database qualification`, `Orchestration qualification`, `Browser qualification`, `Operations qualification`, `Corpus qualification`, and `Maintainer qualification` for merges.
- Use squash merges and delete merged branches. No automatic merges or direct pushes to `main`.
- Keep PR descriptions focused on the resulting behavior, tests, and limitations. Update this sequence when a slice's scope changes.

The 31–49 engineering-day estimate in the architecture plan covers the public MVP (PRs 1–11). Re-estimate after the feasibility work. PRs 12–14 are separately estimated after demand and threat-model review.
