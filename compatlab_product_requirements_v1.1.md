# CompatLab product requirements

**Version:** 1.1  
**Date:** October 3, 2026  
**Status:** Approved implementation baseline; delivery in progress  
**Delivery:** Public website and open-source local engine

This is the current product specification. It supersedes v1.0 and incorporates the reviewed corrections. The [build plan](docs/compatlab-build-plan.md) defines implementation; [research notes](docs/research-notes.md) contain sourced facts. Historical documents are not implementation instructions.

## 1. Product and scope

CompatLab tests an exact public npm artifact in a controlled consumer workspace across pinned JavaScript runtimes. A report describes observed installation and loading behavior, its coverage, and the environment. Import success does not establish functional correctness, package safety, or adversarially tamper-proof execution.

The initial users are developers choosing a runtime and maintainers investigating published-package behavior. The longer-term product adds release monitoring, named behavioral assertions, comparisons, and team workflows. The engine, schemas, harnesses, runtime-image sources, and CLI are open source.

Public search, cached reports, JSON, and quota-limited one-off scans remain free. Future paid or sponsor-supported offerings attach to recurring monitoring, probes, integrations, priority capacity, and team/private workflows. Basic evidence is not paywalled, and no plan sells an unqualified compatibility certificate.

### Requirement language

Priority describes delivery phase: **P0** is the public MVP; **P1** is the maintainer/production enhancement phase; **P2** is optional later work; **OUT** is excluded from the initial scope. **MUST**, **SHOULD**, and **MAY** describe strength within the assigned phase. MUST is required; SHOULD needs a documented reason for omission; MAY is optional. A P1 MUST does not become an MVP obligation. Requirement identifiers from v1.0 remain stable even where wording or phase changes.

### Goals

| ID | Goal |
|---|---|
| G-001 | Give anonymous visitors useful runtime evidence. |
| G-002 | Test the published artifact rather than repository source. |
| G-003 | Distinguish static inspection, smoke tests, and named behavior assertions. |
| G-004 | Preserve artifact, dependency, runtime, harness, policy, and observation identities. |
| G-005 | Contain untrusted archives, JavaScript, Wasm, and prebuilt native code. |
| G-006 | Explain failures through evidence and a stable taxonomy. |
| G-007 | Keep the local open-source engine useful independently of the website. |
| G-008 | Preserve a public history of observed package behavior. |
| G-009 | Add recurring maintainer value through monitoring and comparisons. |
| G-010 | Keep AI outside authoritative classifications and assertions. |

### Delivery boundary

| Phase | Included |
|---|---|
| Local engine | Exact resolution, pinned npm preparation, runtime adapters, JSON, cleanup, container-first CLI |
| P0 public MVP | Anonymous search/scans, exact versions, Linux amd64/glibc, JavaScript/Wasm and shipped prebuilt addons, root and batched subpath loading, cached reports, progress polling, JSON, operator CLI |
| P1 | GitHub login, repository authority, maintainer probes, monitoring, comparisons, alerts, badges, CI integration |
| P2 | Teams, private registries, policies/tokens/billing, other platforms, permission diagnostics, additional integrations |
| OUT of MVP | Lifecycle execution, native compilation, arbitrary URL/file submissions, anonymous custom code, upstream test suites, browsers/DOM, Windows/macOS/ARM runners, benchmarks, malware or vulnerability scoring, AI verdicts |

The launch matrix is a configurable list. The planned default is Node.js 24 and 26 plus stable Bun and Deno; Node 26 remains a preview until its LTS promotion and our qualification tests. An earlier launch uses supported LTS alternatives. Exact patches and image digests are selected at build/release time. Code and schemas must not assume two Node slots or a permanent four-runtime count. [Node release schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json)

Prebuilt native code is an in-scope compatibility target under the same OS sandbox as other package code. Some packages still need scripts, compilation, missing shared libraries, or downloads; their outcomes must identify that cause. Native indicators alone do not justify `unsupported`.

## 2. User journeys and interface

1. A visitor searches for a scoped or unscoped package, selects an exact version, and opens a cached report or requests work without signing in.
2. A new request displays stored preparation/run progress, refreshed by polling. Refreshing the page restores the current snapshot. Queue position is a job detail, not an invented percentage.
3. The report shows a shared npm preparation result, independent root ESM/CommonJS cells, subpath coverage, exact environments, and evidence levels. A cell opens normalized details and bounded raw text on demand.
4. The visitor shares a stable report URL, downloads JSON, or copies an exact reproduction command. Badges and maintainer-verification UI appear in P1.
5. The MVP operator uses `compatlab admin` over SSH for health, block/quarantine, drain, retry, cancellation, and report invalidation. No public admin UI or application login is required.
6. In P1, a maintainer signs in with GitHub, links authorized repositories, enables release monitoring, and optionally supplies an immutable named probe. Alerts link to the exact compared reports.

The homepage leads with package search, example reports, methodology, and the open-source CLI. Package pages show metadata, exact version, report time, coverage, and request state. Missing publication time or repository metadata does not block a scan. Deprecated available packages show a warning; missing or unpublished artifacts cannot run.

Use text and icons with status colors, keyboard-accessible details, a mobile-friendly matrix, and plain explanations. Core reports should render useful content server-side. Account, price, and team features must not obstruct the anonymous flow.

## 3. Compatibility semantics

### Canonical vocabulary

JSON field names use lower camelCase. Enum values and error classifications use **lower snake_case**. Display labels may use normal prose. Use these spellings in schemas, persistence, examples, APIs, and tests.

| Dimension | Values |
|---|---|
| Evidence | `static_only`, `smoke_tested`, `probe_verified` |
| Compatibility outcome | `pass`, `partial`, `fail`, `inconclusive`, `unsupported`, `not_applicable`, `infrastructure_error` |
| Scan lifecycle | `requested`, `preparing`, `running`, `aggregating`, `completed`; terminal alternatives `inconclusive`, `failed_infrastructure`, `rejected`, `cancelled` |
| Job lifecycle | `queued`, `leased`, `running`, `finished`; separate `outcome`, attempt, and lease fields |
| Evidence phase | `resolution`, `acquisition`, `extraction`, `preparation`, `static_analysis`, `sandbox_startup`, `module_resolution`, `module_evaluation`, `probe_assertion`, `teardown` |

Admission resolves an exact version before creating runtime work. A requested scan can wait for a preparation job; a preparing/running scan can also have queued jobs. Compatibility outcomes are independent of processing lifecycle: a completed scan can contain failed or inconclusive probe results.

### Probe applicability and execution

ESM and CommonJS are consumer modes, not mutually exclusive package labels. `type: module` alone does not make `require()` inapplicable. Use the selected runtime's resolution semantics and ordered export conditions, including direct string targets, `node`, `default`, `require`, and `module-sync` where supported. Mark a mode not applicable only when it has no public executable path or the target is a non-executable asset. An accessible ESM target with top-level await can yield a meaningful require failure. [Node package resolution](https://nodejs.org/api/packages.html)

Run root ESM and root CommonJS in separate fresh sandboxes. Run explicit executable subpaths sequentially in one process per runtime/mode, preserving order and session boundaries. Record per-entry results and timing; after a crash or timeout, resume from the next uncompleted entry within restart/work limits. Each batch starts independently of root probes. Batched probes share module caches and globals; reports disclose this limitation.

Root results and subpath coverage are separate. A root can pass while subpath coverage is incomplete. An overall complete pass requires all applicable planned coverage to pass. Wildcard exports, unsupported assets, skipped paths, batch interruptions, and public work limits remain visible. No universal compatibility label is allowed.

### Runtime environment parity

The default profile uses the same sanitized public environment, filesystem policy, dependency snapshot, and OS restrictions across runtimes. Node runs without its permission model; Deno runs with `-A` inside the sandbox, manual `node_modules`, a private writable `DENO_DIR`, no lockfile discovery/writes, and offline dependency behavior. Bun's automatic installation is disabled. Runtime flags are recorded.

gVisor plus the configured host/container controls enforce isolation, disabled execution networking, read-only workspace, and resource bounds. Runtime permission diagnostics are P2, in a separate explicitly labeled profile. OS-policy failures must not be presented as missing runtime APIs. Disabled networking does not disable subprocesses: bounded child processes can run inside the same sandbox and must be reaped.

### Evidence and outcomes

Harness JSON files and checkpoints are package-visible observations. Passing a root probe or a whole uninterrupted batch requires zero exit, a valid bounded completion file, and no supervisor-enforced failure. Completed per-entry checkpoints may survive a later batch interruption, but the affected entry and interrupted batch cannot become an unqualified complete pass. Package stdout/stderr are logs and never parsed as verdicts. Package code in the same process can tamper with result files or behavior; reports do not claim protection against that. Worker authentication protects result submission, not the semantic honesty of malicious code.

Pass means the named applicable observations succeeded. Partial means valid successes and failures coexist. Fail means an applicable loading/assertion operation failed with adequate evidence. Inconclusive covers incomplete coverage, time/resource/policy limits, and unmet preparation prerequisites. Unsupported covers excluded workflows such as required native compilation. Not applicable is excluded from coverage denominators. Infrastructure error means the service could not produce a valid observation.

Successful loading earns `smoke_tested`; only a named behavioral assertion earns `probe_verified`. Presence of install scripts is a warning; evidence that disabled scripts were needed is an inconclusive prerequisite. Shipped prebuilt-addon failures are classified by observed ABI/loading/runtime/platform evidence, not by a blanket exclusion.

## 4. Functional requirements

The following tables are normative. Their observable conditions form the acceptance tests; the build plan maps them to milestones.

### Discovery

| ID | Phase | Requirement |
|---|---|---|
| FR-DISC-001 | P0 | The homepage MUST offer anonymous package search as its primary action. |
| FR-DISC-002 | P0 | Search MUST use public npm metadata and handle scoped names correctly. |
| FR-DISC-003 | P0 | Results MUST show name, description, observed dist-tag version, and repository when available; missing metadata MUST be safe. |
| FR-DISC-004 | P0 | Users MUST select an exact published version; tags MUST resolve before durable scan selection. |
| FR-DISC-005 | P0 | Invalid/missing/unavailable artifacts MUST create no runtime work; deprecation alone MUST show a warning rather than reject an available artifact. |
| FR-DISC-006 | P0 | Search SHOULD expose existing report availability. |
| FR-DISC-007 | P1 | Package pages SHOULD provide richer scanned-version history. |
| FR-DISC-008 | P1 | Typo suggestions SHOULD require explicit selection and preserve the requested name. |
| FR-DISC-009 | P2 | Search-engine indexing MAY cover canonical completed reports, excluding progress/internal pages. |

### Scans and orchestration

| ID | Phase | Requirement |
|---|---|---|
| FR-SCAN-001 | P0 | Reuse MUST include root integrity, lock digest, preparation profile, actual snapshot generation, runtime images, harness/probe revisions, execution policy, and platform profile. Composite database constraints MAY implement identity. |
| FR-SCAN-002 | P0 | Durable identities MUST contain resolved versions, never moving tags. |
| FR-SCAN-003 | P0 | Concurrent equivalent requests MUST converge on one active preparation/scan; results MUST be accepted idempotently. |
| FR-SCAN-004 | P0 | Admission MUST enforce client/IP, package, queue, and global limits atomically. Account quotas begin when accounts exist. |
| FR-SCAN-005 | P0 | Scan and job lifecycles MUST follow section 3, with queue state stored on jobs. |
| FR-SCAN-006 | P0 | Infrastructure failures MUST remain distinct from package outcomes. |
| FR-SCAN-007 | P0 | A durable progress snapshot MUST support refresh/reconnect. Browser polling is sufficient; SSE is optional later. |
| FR-SCAN-008 | P0 | Completed reports MUST be reusable without executing package code on views. |
| FR-SCAN-009 | P1 | Controlled rescans SHOULD preserve previous observations and input revisions. |
| FR-SCAN-010 | P1 | Report invalidation SHOULD exclude faulty evidence from current results while retaining its visible history. P0 image quarantine MUST mark affected reports. |

### Registry and artifact acquisition

| ID | Phase | Requirement |
|---|---|---|
| FR-PKG-001 | P0 | Resolution MUST use the public npm registry for scoped and unscoped packages. |
| FR-PKG-002 | P0 | Store exact name/version, source URL, observed tags, integrity, and published manifest. Publication time and repository metadata are optional. Prefer abbreviated metadata and selected-version endpoints; full packuments MUST NOT be a required input. |
| FR-PKG-003 | P0 | Acquisition MUST verify supplied integrity using pinned npm/maintained fetching tools. Mismatches MUST prevent execution. Missing usable integrity MUST have an explicit inconclusive state. |
| FR-PKG-004 | P0 | The service MUST bound preparation bytes, files, paths, disk, memory, time, and network work; archive bombs MUST terminate within configured limits. A custom extractor is not required. |
| FR-PKG-005 | P0 | Extraction and subsequent file handling MUST prevent unsafe paths/links/devices from accessing host or sibling data. Prove the outcome with hostile archives and validate the sealed tree before mounting it. |
| FR-PKG-006 | P0 | Package fetching/installation and archive handling MUST occur in isolated preparation, outside the web process. |
| FR-PKG-007 | P0 | Preparation egress MUST use an allowlisting proxy plus enforced network rules, including private/metadata destination denial. |
| FR-PKG-008 | P0 | Public package jobs MUST NOT receive package-registry credentials. |
| FR-PKG-009 | P1 | Artifact metadata SHOULD outlive cached bytes. Reports MUST distinguish retained identity from availability for reproduction. |

### Static analysis and preparation

| ID | Phase | Requirement |
|---|---|---|
| FR-STATIC-001 | P0 | Parse the published manifest; invalid JSON MUST yield structured metadata failure. |
| FR-STATIC-002 | P0 | Retain type/main/module/exports/imports/engines/os/cpu/libc/bin, dependency categories, bundled dependencies, and lifecycle scripts. |
| FR-STATIC-003 | P0 | Module-format observations MUST allow indeterminate results and explain probe selection. |
| FR-STATIC-004 | P0 | Enumerate explicit public subpaths within declared bounds and expose omitted patterns/assets/paths. |
| FR-STATIC-005 | P0 | Detect and label shipped native binaries, build indicators, and platform prerequisites. Prebuilt native code MUST remain eligible; compiler/script requirements MUST remain separate. |
| FR-STATIC-006 | P0 | Identify install-time scripts separately; distinguish presence from demonstrated requirement. |
| FR-STATIC-007 | P1 | Bounded literal built-in import observations SHOULD be added after core loading works; they MUST NOT imply failure by themselves. |
| FR-STATIC-008 | P0 | Declared platform restrictions MUST affect preparation/coverage explicitly rather than masquerade as runtime failure. |
| FR-STATIC-009 | P1 | Package size, file/dependency/export counts SHOULD provide context without a quality score. |
| FR-STATIC-010 | P0 | Probe planning MUST produce a versioned, stored plan with stable entry order and applicability reasons. |
| FR-PREP-001 | P0 | Install the target in a service-owned private consumer project. |
| FR-PREP-002 | P0 | Root and dependency lifecycle scripts MUST stay disabled; explicit script commands MUST NOT run. |
| FR-PREP-003 | P0 | Record exact npm/installer image, lock bytes/digest, flags, and installed/omitted dependency observations. |
| FR-PREP-004 | P0 | Seal the finished workspace read-only before execution; job temp/output state MUST be separate. |
| FR-PREP-005 | P0 | All runtimes in a comparison MUST use the same actual sealed snapshot. Lock equality alone MUST NOT be described as byte equality. |
| FR-PREP-006 | P0 | Preparation failures MUST remain separate from import/require results. |
| FR-PREP-007 | P0 | Required install scripts or native compilation MUST yield prerequisite-limited results. Shipped addons requiring neither MUST be tested. |
| FR-PREP-008 | P0 | Reuse ready snapshots by preparation identity and generation; cache eviction MUST NOT silently replace old evidence with a newly resolved tree. |

### Runtime matrix and automatic probes

| ID | Phase | Requirement |
|---|---|---|
| FR-RUNTIME-001 | P0 | Each runtime profile MUST record name, exact version, image digest/build date, OS, architecture, and base environment. |
| FR-RUNTIME-002 | P0 | Execution MUST reference approved immutable image digests. |
| FR-RUNTIME-003 | P0 | Runtime configuration MUST accept a variable-length list. The planned launch list is Node 24/26, stable Bun, stable Deno, qualified under section 1. |
| FR-RUNTIME-004 | P0 | Runtime images MUST contain only runtime/harness and required libraries. Preparation-specific CA packages, installer utilities, build tools, and secrets MUST NOT be added to them. |
| FR-RUNTIME-005 | P0 | Runtime/profile changes MUST produce new report identities. |
| FR-RUNTIME-006 | P1 | Active/preview/deprecated/retired lifecycle states SHOULD preserve historical availability. |
| FR-RUNTIME-007 | P1 | Publish image source/build provenance with the corresponding digest. |
| FR-PROBE-001 | P0 | Applicable root ESM loading MUST record completion, duration, safe namespace observations, and failure evidence. |
| FR-PROBE-002 | P0 | CommonJS loading MUST follow section 3; ESM format alone MUST NOT suppress it. |
| FR-PROBE-003 | P0 | Explicit executable subpaths MUST receive per-entry observations in bounded sequential batches, with disclosed order, cache sharing, restarts, and incomplete coverage. |
| FR-PROBE-004 | P0 | Automatic probes MUST NOT invoke arbitrary exports, getters, or proxy traps for inspection. |
| FR-PROBE-005 | P0 | Harness result files MUST be separate from stdout/stderr. A missing/invalid result or premature exit MUST NOT pass the affected operation; completed checkpoints follow the interrupted-batch rules in section 3. In-process tamper-proof attestation is not a product claim. |
| FR-PROBE-006 | P0 | Every job MUST have externally enforced wall time and resource/output limits; batched probes also need per-entry watchdogs and bounded restarts. |
| FR-PROBE-007 | P2 | A separate diagnostic profile MAY report observed denied capabilities. It MUST disclose nonuniform runtime instrumentation and MUST NOT alter default parity results. |
| FR-PROBE-008 | P0 | Harness, generated launcher, probe plan, and execution policy revisions MUST be recorded and immutable. |
| FR-PROBE-009 | P1 | Package-bin smoke tests MAY use a separate named profile. |
| FR-PROBE-010 | P2 | Category-specific assertions MAY be added as explicit versioned probes. |

### Maintainer probes

| ID | Phase | Requirement |
|---|---|---|
| FR-VERIFY-001 | P1 | Only verified authenticated maintainers MAY register custom probes. |
| FR-VERIFY-002 | P1 | A manifest MUST declare package range, entry, timeout, requested capabilities, fixtures, and expected behavior. |
| FR-VERIFY-003 | P1 | Fetch probe inputs from an authorized immutable repository commit. |
| FR-VERIFY-004 | P1 | Source, fixture, permission, or harness changes MUST create new probe revisions. |
| FR-VERIFY-005 | P1 | Reports MUST separate named assertions from automatic loading observations. |
| FR-VERIFY-006 | P1 | Custom probes MUST use equal or stronger isolation; maintainer authority MUST NOT weaken it. |
| FR-VERIFY-007 | P1 | Reports MUST show the actual approved capability profile. |
| FR-VERIFY-008 | P2 | Community probes MAY follow a separate moderation/trust design. |

### Execution and results

| ID | Phase | Requirement |
|---|---|---|
| FR-EXEC-001 | P0 | Web/control-plane processes MUST NOT execute package code; public execution MUST use a dedicated host. |
| FR-EXEC-002 | P0 | Public jobs MUST use gVisor or an equivalently reviewed OS isolation boundary, never plain Docker alone. |
| FR-EXEC-003 | P0 | Package processes MUST use a non-root UID with no added capabilities. |
| FR-EXEC-004 | P0 | Mounts MUST be supervisor-created and validated job workspace/output paths, with only the bounded preparation-cache exception in section 6. Host secrets, sockets, arbitrary paths, and sibling state MUST NOT be exposed. |
| FR-EXEC-005 | P0 | Runtime root/workspace filesystems MUST be read-only; writable temporary/output space MUST be unique, bounded, and ephemeral. Preparation has its own bounded writable profile. |
| FR-EXEC-006 | P0 | Runtime networking MUST be disabled and externally tested against internet, metadata, host, and sibling destinations. |
| FR-EXEC-007 | P0 | CPU, memory, guest processes/threads, wall time, file/disk, output, and whole-host reservations MUST have tested limits. |
| FR-EXEC-008 | P0 | Jobs MUST have isolated process/filesystem/network views. |
| FR-EXEC-009 | P0 | Default runtime flags MUST preserve the common OS-enforced capability profile in section 3. Permission-specific diagnostics are separate P2 work. |
| FR-EXEC-010 | P0 | Completion, cancellation, timeout, restart, and crash recovery MUST reap all descendants and writable job resources. |
| FR-EXEC-011 | P0 | Worker claims/submissions MUST be authenticated, scoped, attempt-bound, and replay resistant. |
| FR-EXEC-012 | P0 | Workers MUST use a private job API and MUST NOT receive PostgreSQL or account credentials. |
| FR-EXEC-013 | P1 | Workers SHOULD scale by adding self-contained preparation/execution hosts with explicit workspace locality. |
| FR-EXEC-014 | P1 | The sandbox interface SHOULD permit a later microVM backend without changing product contracts. |
| FR-RESULT-001 | P0 | Keep bounded raw evidence separate from normalized classifications; preserve evidence when reclassifying. |
| FR-RESULT-002 | P0 | Failed observations MUST use the versioned taxonomy or `unclassified_runtime_failure`. |
| FR-RESULT-003 | P0 | Outcomes MUST distinguish all seven states in section 3. |
| FR-RESULT-004 | P0 | Evidence MUST identify its actual phase. |
| FR-RESULT-005 | P0 | Reports MUST label `static_only`, `smoke_tested`, or `probe_verified`. |
| FR-RESULT-006 | P0 | Successful loading MUST NOT produce a universal compatibility or safety claim. |
| FR-RESULT-007 | P0 | Normalize temporary paths/IDs and strip terminal controls; escape browser text. |
| FR-RESULT-008 | P0 | Logs MUST have byte/retention limits and explicit sanitization/truncation markers. |
| FR-RESULT-009 | P0 | Root and subpath summaries MUST follow documented coverage rules, with inspectable counts. |
| FR-RESULT-010 | P1 | Comparisons MUST disclose dependency-lock/snapshot, runtime, harness, probe, policy, platform, and batch-method differences. |
| FR-RESULT-011 | P1 | Equivalent failures SHOULD be groupable without losing original evidence. |

### Reports, accounts, and monitoring

| ID | Phase | Requirement |
|---|---|---|
| FR-REPORT-001 | P0 | Completed reports MUST have stable shareable URLs. |
| FR-REPORT-002 | P0 | The matrix MUST distinguish shared preparation, root modes, subpaths, and later behavioral probes. |
| FR-REPORT-003 | P0 | Details MUST show phase, classification, entry, message, raw excerpt, timing, resources, and reproduction metadata. |
| FR-REPORT-004 | P0 | Show root integrity, lock/snapshot identity, runtime image, harness/probe/policy versions, OS/architecture, and observation time. |
| FR-REPORT-005 | P0 | Show evidence limitations, native/script observations, batch semantics, and omitted coverage. |
| FR-REPORT-006 | P0 | Provide versioned downloadable JSON. |
| FR-REPORT-007 | P0 | Provide an exact-input CLI reproduction command where supported and disclose unavailable bytes/profiles. |
| FR-REPORT-008 | P1 | Badges SHOULD link to evidence and avoid unqualified compatibility claims. |
| FR-REPORT-009 | P1 | Version comparisons SHOULD disclose changed inputs. |
| FR-REPORT-010 | P1 | Share previews SHOULD contain useful summaries without raw logs. |
| FR-REPORT-011 | P0 | Core public flows SHOULD meet WCAG 2.2 AA and require accessibility review. |
| FR-AUTH-001 | P1 | Use GitHub OAuth through Better Auth for maintainer login. |
| FR-AUTH-002 | P0 | Normal public report viewing and quota-limited scan requests MUST remain anonymous. |
| FR-AUTH-003 | P1 | Repository linking MUST verify the user's required repository authority with minimal access. |
| FR-AUTH-004 | P1 | Authority labels MUST distinguish repository control from verified npm/artifact ownership. |
| FR-AUTH-005 | P1 | Avoid long-lived credentials where practical; encrypt sensitive stored tokens and keep them outside sandboxes/logs. |
| FR-AUTH-006 | P1 | Users MUST revoke links and delete account-linked configuration under the retention policy. |
| FR-AUTH-007 | P2 | Organization roles MAY be added with server-side enforcement. |
| FR-MON-001 | P1 | A configured release/profile MUST trigger at most one scan selection per monitor. |
| FR-MON-002 | P1 | Registry polling and reconciliation MUST recover missed releases. |
| FR-MON-003 | P1 | Compare with a relevant previous report and expose changed variables. |
| FR-MON-004 | P1 | Alert rules MUST support meaningful changes and avoid unchanged-result noise. |
| FR-MON-005 | P1 | Email/GitHub delivery SHOULD retry separately from scan execution. |
| FR-MON-006 | P1 | Alerts MUST link to immutable compared reports. |

### APIs and operations

| ID | Phase | Requirement |
|---|---|---|
| FR-API-001 | P0 | UI and public JSON MUST use versioned typed contracts. |
| FR-API-002 | P1 | A documented rate-limited read API SHOULD expose package/report summaries. |
| FR-API-003 | P1 | Badge references MUST identify immutable evidence or an explicit current policy/freshness. |
| FR-API-004 | P0 | CLI and hosted reports MUST share schemas; local checks MUST default to a supported sandbox and refuse silent fallback. |
| FR-API-005 | P1 | CI MAY test pre/post-publication artifacts, with distinct source identities and no anonymous uploads. |
| FR-API-006 | P2 | Private API tokens MUST be scoped, hashed, revocable, and shown only at issuance. |
| FR-ADMIN-001 | P0 | Operator CLI MUST show queue state, workers, failures, and abuse without manual database edits. |
| FR-ADMIN-002 | P0 | Operators MUST block package versions/probes with neutral policy results. |
| FR-ADMIN-003 | P0 | Operators MUST quarantine images/harnesses and visibly invalidate affected reports. |
| FR-ADMIN-004 | P0 | Retry controls MUST distinguish bounded infrastructure retries from observed package failures. |
| FR-ADMIN-005 | P0 | Enforce client/IP throttles, package cooldowns, duplicate suppression, body/queue/work limits; add account throttles in P1. |
| FR-ADMIN-006 | P1 | Artifact redaction SHOULD preserve an audit record and original classification provenance. |
| FR-ADMIN-007 | P1 | A public status/incident page SHOULD distinguish service incidents from package failures. |

## 5. Security and privacy requirements

Assume package archives, manifests, dependencies, native binaries, probes, and output can be malicious. The boundary includes preparation as well as execution. Passing fixtures demonstrates tested controls, not the absence of unknown vulnerabilities.

| ID | Phase | Requirement |
|---|---|---|
| SEC-001 | P0 | Untrusted work MUST execute outside the control-plane host/boundary. |
| SEC-002 | P0 | Anonymous execution MUST use gVisor or a reviewed equivalent. |
| SEC-003 | P0 | Runtime egress MUST be disabled. |
| SEC-004 | P0 | Preparation egress MUST be allowlisted and logged without credentials. |
| SEC-005 | P0 | Jobs MUST NOT receive production secrets. |
| SEC-006 | P0 | Runtime root and workspace MUST be read-only. |
| SEC-007 | P0 | Job workspace/output/temp writes MUST be unique and bounded. An installer-only tarball cache is the explicit bounded exception, subject to section 6. |
| SEC-008 | P0 | Jobs MUST run non-root with no added capabilities. |
| SEC-009 | P0 | Host sockets, credentials, devices, arbitrary bind paths, and sibling directories MUST remain inaccessible. |
| SEC-010 | P0 | Resource/time/output limits MUST be enforced outside package control. |
| SEC-011 | P0 | Archive attacks MUST not escape job roots or access host/sibling data; hostile fixtures MUST verify this. |
| SEC-012 | P0 | Package text MUST be bounded, sanitized, and rendered as text. |
| SEC-013 | P0 | Stdout/stderr MUST NOT be parsed as results. Root or whole-batch success requires a valid completion file and successful process outcome; interrupted checkpoints follow section 3. In-process semantic attestation is explicitly excluded. |
| SEC-014 | P0 | A private-interface job API MUST enforce worker token, job, attempt, lease, and replay checks. It MUST NOT be internet-reachable. |
| SEC-015 | P0 | Runtime/preparation images and harness/probe revisions MUST be immutable and recorded. |
| SEC-016 | P0 | Lifecycle scripts MUST remain disabled. |
| SEC-017 | P0 | Execution hosts MUST be disposable and rebuildable. The supervisor/operator service is the only automated Docker-socket user; sandbox jobs MUST never receive it. |
| SEC-018 | P0 | Required hostile tests MUST cover network, metadata, host/sibling files, archives, CPU, memory, guest processes, disk, output, and delayed children. |
| SEC-019 | P1 | Release builds SHOULD publish SBOMs and signed provenance. |
| SEC-020 | P0 | Administrative mutations MUST create an audit record. |
| SEC-021 | P0 | Publish a security contact and disclosure process before launch. |
| SEC-022 | P1 | Review the expanded threat model before custom probes; private packages require a further external security review. |

Anonymous use requires no email. Limit IP retention or use rotating pseudonymous abuse identifiers. Public package reports are public; logs have explicit retention and a removal path. Tokens/cookies/host environments must not enter public evidence. Future accounts can remove monitors, repository links, and personal destinations. Private packages require tenant authorization, secret handling, encryption, deletion/backup policies, and a separate design review.

## 6. Architecture constraints and data

Use a TypeScript monorepo. The control plane is a modular Next.js application plus a small private control process. PostgreSQL owns metadata, state, jobs, bounded logs, locks, and immutable report revisions. A TypeScript supervisor uses the documented Docker/runsc integration on a dedicated Linux host. Preparation and runtime work initially share that execution host with separate sandbox profiles.

Use standard npm installation and archive handling inside the preparation sandbox; do not build a package manager, extractor, or registry gateway. Use an off-the-shelf allowlisting proxy such as Squid. No package code executes in the web/control process. Workers communicate over WireGuard/private networking with per-worker bearer tokens whose hashes are stored centrally. Operators use an SSH-protected CLI. Public maintainer authentication begins in P1.

Ready workspaces stay on the execution host. Route runs to their owning worker until a transfer/rebuild path exists. Adding another worker is supported by assigning complete new preparation/scan work to it. Object storage is deferred until shared workspaces or report retention need it; database backups still go off-host from the beginning.

Resolve new locks using a fresh job-local metadata cache. An installer-only shared tarball cache MAY accelerate `npm ci` with an already validated frozen lock, expected integrity for non-bundled artifacts, origin restrictions, cache-corruption tests, and storage limits. Do not use another job's writable cached metadata as authoritative resolution input. Runtime sandboxes never mount the npm cache. Disable reuse if the selected npm version cannot enforce this separation.

### Identity and reuse

Use root artifact integrity and lock digest plus composite natural keys: preparation includes artifact, lock, installer/profile/platform revisions and snapshot generation; scan includes preparation and an immutable matrix revision containing runtime/harness/probe/policy choices; run includes scan, runtime image and probe group; report includes scan and classifier revision. A pending preparation uses a unique artifact/profile/resolution-generation reservation before the lock exists.

The same lock can produce different installed bytes across platform, optional dependency, installer, or environment changes. Immediate comparisons therefore reuse the actual sealed workspace, not a reinstallation. Rebuilds receive a new snapshot generation unless a stored workspace digest confirms equality. A background tree digest supports replay verification but is not required before the initial hot-path execution of the shared snapshot. Its absence limits exact-replay claims.

Keep public evidence append-only. Report rows have nullable invalidation time/reason and optional replacement reference. Reclassification produces a new report revision. Cache eviction cannot change historical evidence. Future private-cache keys and authorization must include tenant scope.

### Initial limits and retention

Limits are versioned starting settings to validate under runsc, not measured service capabilities: 512 explicit executable subpaths; 30 seconds per import/require; 120 seconds per batch with at most 3 restarts per runtime/mode; a 15-minute scan deadline from first preparation/run start including subsequent waits; 1 GiB runtime job memory; 64 MiB runtime temp with a separately bounded result mount; preparation 180 seconds, 2 GiB memory/work area, 512 MiB retained tree and 50,000 files. Bound downloads/metadata/logs separately as specified in the build plan. Limits never silently expand mid-scan.

Retain normalized reports/locks/provenance indefinitely subject to removal policy; bounded sanitized logs 30 days; workspace/cache bytes up to 7 days with a total storage ceiling; ordinary service logs 14 days; pseudonymized admission data 7 days; administrator/security audits 180 days. Report cache/log expiry and reproduction availability. Daily encrypted off-host database dumps target a 24-hour recovery point and a four-hour restore; verify with a restore drill. Move to PITR when account/private or availability requirements justify it.

## 7. Non-functional requirements

All rows below apply to P0 unless a future capability is named. Targets are measured goals, not free-service SLAs.

| ID | Requirement |
|---|---|
| NFR-PERF-001 | Cached report pages SHOULD become interactive within 2 seconds from the primary region. |
| NFR-PERF-002 | Search SHOULD return within 1 second under normal registry conditions. |
| NFR-PERF-003 | Admitted scans SHOULD start preparation within 30 seconds when capacity exists. |
| NFR-PERF-004 | UI MUST remain responsive and restore current state after refresh/reconnect. |
| NFR-PERF-005 | Raw logs MUST load on demand. |
| NFR-REL-001 | Job/result operations MUST be idempotent. |
| NFR-REL-002 | Worker crashes MUST NOT produce conflicting accepted results. |
| NFR-REL-003 | Infrastructure retry MUST be bounded and explicit. |
| NFR-REL-004 | Historical evidence MUST NOT change silently. |
| NFR-REL-005 | Migrations MUST support compatible rollout and forward repair. |
| NFR-REL-006 | Stored artifacts MUST record size and integrity where applicable, independent of storage backend. |
| NFR-SCALE-001 | Web instances MUST scale independently of execution workers. |
| NFR-SCALE-002 | Additional workers MUST claim independent scans with explicit workspace locality. |
| NFR-SCALE-003 | Shared scheduling and local workers MUST enforce global/per-worker/runtime concurrency. |
| NFR-SCALE-004 | Duplicate requests MUST be suppressed before consuming work capacity. |
| NFR-SCALE-005 | Public report/catalog reads SHOULD be cacheable with invalidation support. |
| NFR-MAINT-001 | Public/stored schemas MUST be versioned. |
| NFR-MAINT-002 | Runtime behavior MUST sit behind small adapters. |
| NFR-MAINT-003 | Security/limit profiles MUST be versioned, reviewable configuration. |
| NFR-MAINT-004 | Maintain current architecture and threat-model documentation. |
| NFR-MAINT-005 | Generated code MUST be marked; cross-language generation is not required. |
| NFR-MAINT-006 | Privileged supervisor dependencies SHOULD be minimized. |
| NFR-A11Y-001 | Core flows SHOULD meet WCAG 2.2 AA. |
| NFR-A11Y-002 | Status MUST use more than color. |
| NFR-A11Y-003 | Matrices MUST be usable by keyboard and on small screens. |
| NFR-A11Y-004 | Explanations MUST define unfamiliar runtime terms. |
| NFR-A11Y-005 | Raw logs MUST have an accessible text view. |

Support current Chrome, Firefox, Safari, and Edge. Keep bounded correctness/saturation checks before public admission; broad load characterization is required before increasing public capacity. Start with structured logs, error tracking and CLI queries; add telemetry infrastructure when its measurements drive operational decisions.

## 8. Error taxonomy and public result example

Each classification defines phase, origin, retryability, safe summary, and evidence source. Use runtime error codes and supervisor observations before narrow tested text patterns. A package can throw arbitrary text; text alone cannot establish a specific unsupported API or capability attempt.

| Family | Initial classifications |
|---|---|
| Acquisition/preparation | `package_not_found`, `package_version_not_found`, `registry_unavailable`, `artifact_download_failed`, `artifact_integrity_mismatch`, `artifact_integrity_unavailable`, `archive_rejected`, `package_manifest_invalid`, `declared_platform_unsupported`, `dependency_source_unsupported`, `dependency_install_failed`, `install_script_required`, `native_compilation_required`, `preparation_limit_exceeded` |
| Loading | `package_resolution_failed`, `esm_import_failed`, `commonjs_require_failed`, `export_path_failed`, `unsupported_builtin`, `unsupported_runtime_api`, `native_addon_load_failed`, `unexpected_process_exit`, `unclassified_runtime_failure` |
| Policy/resources | `sandbox_policy_limited`, `process_timeout`, `process_out_of_memory`, `process_limit_exceeded`, `output_limit_exceeded`, `temporary_disk_limit_exceeded`, `coverage_limit_exceeded` |
| Infrastructure | `sandbox_start_failed`, `runner_unavailable`, `runtime_image_unavailable`, `harness_protocol_error`, `result_submission_failed`, `control_plane_error`, `job_cancelled`, `service_policy_rejected` |
| P1 assertions | `probe_assertion_failed` |

Runtime-specific permission categories and blanket `native_addon_unsupported` are not MVP classifications. Complete denied-capability tracing is not promised. Record a network/subprocess observation only when supported by concrete evidence; `--network=none` alone proves neither a recorded network attempt nor a blocked subprocess.

```json
{
  "schemaVersion": 1,
  "package": { "name": "example-package", "version": "1.2.3", "artifactIntegrity": "sha512-example" },
  "preparation": { "snapshotId": "prep-example", "lockDigest": "sha256-example", "profileRevision": "npm_linux_v1" },
  "environment": { "runtime": "node", "runtimeVersion": "exact-build-selected-version", "runtimeImageDigest": "sha256-example", "os": "linux", "architecture": "amd64" },
  "evidenceLevel": "smoke_tested",
  "root": { "esm": "pass", "commonjs": "fail" },
  "subpaths": { "status": "inconclusive", "tested": 100, "planned": 120, "method": "sequential_batch_v1" },
  "failure": { "phase": "module_evaluation", "classification": "commonjs_require_failed" },
  "limitations": ["Only loading was observed.", "Batch entries share a module cache.", "Harness observations are not adversarial attestation."]
}
```

This abbreviated example uses illustrative values, not measured package results. The complete schema also includes timestamps, harness/probe/policy revisions, provenance, coverage reasons, and bounded evidence references.

## 9. Public MVP acceptance criteria

The MVP is complete only after the following observable outcomes pass:

1. Anonymous search works for scoped and unscoped public packages.
2. Exact versions resolve; missing metadata does not break available packages.
3. The selected published artifact and supplied integrity are verified.
4. Archive attacks remain contained; static manifest observations are recorded.
5. Root/dependency install scripts do not execute.
6. Every runtime comparison uses the same sealed dependency snapshot and recorded lock/profile.
7. Root ESM/CommonJS and applicable batched subpaths produce independent visible results and coverage.
8. Shipped prebuilt addons can run; compilation/script prerequisites are labeled by cause.
9. Public execution uses a qualified gVisor profile with no network or production secrets.
10. Time/resource/output bounds terminate abusive work without exhausting the tested host.
11. Host, metadata, database, control-plane, sibling and internet access fixtures fail as intended.
12. Fake stdout JSON cannot become a verdict; zero exit without a valid result cannot pass. In-process tamper-proof attestation is not claimed.
13. Service errors never appear as package incompatibility.
14. Reports expose exact artifact, lock/snapshot, runtime, harness, probe, policy, platform, and timestamps.
15. Static, smoke, and later named behavioral evidence remain distinct.
16. Successful root loading does not imply subpath completeness or universal correctness.
17. Normalized details and bounded sanitized raw evidence remain accessible.
18. Duplicate requests converge; cached views execute no package work.
19. Polling and refresh recover the stored scan state and show terminal outcomes.
20. Stable report URLs and downloadable versioned JSON work.
21. A fresh developer can run the container-first CLI and understand replay availability/limits.
22. Core pages pass browser, responsive, and accessibility review.
23. Operator CLI exposes health and controls without manual database edits.
24. Off-host backup restoration and clean execution-host rebuild are demonstrated.
25. Methodology, limitations, privacy/retention, acceptable-use/terms, security contact, and abuse/removal paths are published.

Tests include authored ESM/CJS/conditional/TLA/Wasm/native/script fixtures; malicious archives; CPU/memory/process/disk/output abuse; network/metadata/host/sibling access; fake logs and missing results; late/duplicate submission; crash/cancellation cleanup; basic admission saturation; and browser flows. Scan 50 fixtures/real versions during engine qualification and 100 diverse public versions before launch, reviewing representative reports by hand.

Before public launch, include the repository license, security policy, contribution guide, result-schema documentation, runtime-image sources, and local reproduction instructions. Assign incident ownership and an incident communication path, even when one person operates the service. Review registry/GitHub integration terms before enabling the corresponding public integration.

## 10. Later workflow, validation, and start condition

P1 adds GitHub login through Better Auth, minimal GitHub App permissions, repository-control evidence, release reconciliation, qualified comparisons, deduplicated email/GitHub alerts, and badges. Commit-pinned custom probes use bounded offline fixtures and the same sandbox. Compare lock and environment changes before attributing regressions. Pre-publication CI results use a separate source kind; public upload remains excluded.

P2 team work needs an approved design for organizations/RBAC, private-registry credentials, tenant data/cache isolation, scoped tokens, policy enforcement, retention/deletion, billing and any stronger execution boundary. Build it after evidence of demand: useful differences across the package corpus, feedback from 10 developers/maintainers, and 5 concrete requests for recurring monitoring/probes. These are validation targets, not invented traction.

Pause or revise scope if results offer little value, policy exclusions dominate important packages, safe execution cannot be demonstrated, or recurring workflows attract no interest. Track viewed completed package versions, completion/coverage quality, reproduction availability, cache hits, service failures, and resource use.

The user approved the final plan and supplied the GitHub repository on October 3, 2026. Implementation follows the [fourteen-PR delivery sequence](docs/delivery-plan.md). Approval settles design choices; it does not certify unbuilt behavior or authorize public launch before the acceptance gates pass.
