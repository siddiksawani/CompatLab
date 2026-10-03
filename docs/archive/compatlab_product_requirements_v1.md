# CompatLab Product Requirements and Technical Specification

**Product:** JavaScript Package Runtime Compatibility Lab  
**Working name:** CompatLab  
**Document version:** 1.0  
**Status:** Build-ready baseline  
**Date:** October 3, 2026  
**Primary delivery model:** Public website plus open-source local engine  

---

## 1. Document purpose

This document defines the end goal, product scope, user experience, technical architecture, security model, implementation stack, data model, functional requirements, non-functional requirements, delivery milestones, and acceptance criteria for CompatLab.

It is intended to be the authoritative starting point for product design and implementation. It should be usable by a solo founder, human contributors, and AI coding agents without requiring them to reconstruct the product intent from earlier conversations.

### 1.1 Normative language

- **MUST / P0:** Required for the public MVP unless explicitly moved to a later milestone.
- **SHOULD / P1:** Important for the first production-quality release after the MVP.
- **MAY / P2:** Valuable later enhancement that must not delay the core product.
- **OUT:** Explicitly outside the initial product boundary.

When this document conflicts with an implementation shortcut, the safety, result-integrity, and compatibility-semantics requirements in this document take precedence.

---

## 2. Executive summary

CompatLab is a website where a user enters an npm package and version and receives an evidence-based compatibility report across JavaScript runtimes such as Node.js, Bun, and Deno.

The product does not merely inspect package metadata. It resolves the exact published package artifact, prepares a controlled dependency workspace, runs deterministic probes in isolated runtime environments, captures failures, normalizes the results, and presents a public report tied to exact runtime image digests and harness versions.

The free public utility answers:

> Does this exact published package artifact install and load under these exact runtime versions, and what evidence supports that result?

The longer-term SaaS helps maintainers answer:

> Did my new package release introduce a compatibility regression, and can I prove meaningful behavior with a maintainer-defined probe?

The core compatibility engine, result schema, runtime harnesses, and local CLI should be open source. The hosted product provides public discovery, safe execution infrastructure, caching, history, scheduled release monitoring, alerts, badges, team features, and later private-package support.

---

## 3. Product vision and end goal

### 3.1 End goal

The end goal is to become a trusted, searchable compatibility knowledge base for JavaScript packages across multiple runtimes.

A visitor should be able to:

1. Search for an npm package without creating an account.
2. Select an exact package version.
3. View an existing report instantly or request a new scan.
4. Watch the scan progress in real time.
5. Understand which runtime and module-loading combinations passed or failed.
6. See the exact evidence, environment, limitations, and reproduction information behind every result.
7. Share the report or use a badge in documentation.

A package maintainer should eventually be able to:

1. Associate a GitHub repository with a package.
2. add a small, versioned, meaningful compatibility probe;
3. automatically scan each newly published package version;
4. compare compatibility with the previous release;
5. receive alerts when behavior regresses;
6. expose a trustworthy compatibility badge;
7. integrate results into release and pull-request workflows.

### 3.2 Product promise

CompatLab shall make only claims supported by observable evidence. It shall never reduce compatibility to an unexplained universal green or red badge.

Every conclusion must be qualified by:

- the exact package artifact;
- the exact runtime version and image digest;
- the operating system and architecture;
- the probe type and probe version;
- the execution policy;
- the scan time;
- known limitations.

### 3.3 One clear core use case

The core use case is:

> Test an exact public npm package version under a fixed Node.js, Bun, and Deno matrix and publish a reproducible compatibility report.

Features that do not improve this use case or the recurring release-regression workflow must not enter the MVP.

---

## 4. Problem statement

JavaScript package compatibility is increasingly difficult to infer from package metadata alone. A package may:

- expose different files to CommonJS and ESM consumers;
- use conditional exports that resolve differently by runtime;
- import Node-specific built-in modules;
- depend on partially implemented runtime APIs;
- require lifecycle scripts or a native addon;
- assume a particular `node_modules` layout;
- access the filesystem, environment, network, or subprocesses during import;
- work under one runtime release and fail under the next;
- import successfully while failing during its actual core operation.

Today, users often discover these differences only after installing a package in a real project, reading runtime issue trackers, or manually creating test projects for each runtime.

Package maintainers also lack a simple hosted service that independently tests a published artifact across runtimes, preserves historical results, detects regressions, and displays the exact evidence publicly.

---

## 5. Product goals

### 5.1 Primary goals

- **G-001:** Give an anonymous visitor useful compatibility evidence without requiring installation or account creation.
- **G-002:** Test the exact published artifact rather than repository source or an inferred package configuration.
- **G-003:** Distinguish static inspection, smoke testing, and meaningful verified behavior.
- **G-004:** Produce reproducible reports tied to immutable package, runtime, harness, and policy identifiers.
- **G-005:** Safely execute untrusted package code without exposing the control plane, credentials, or other users.
- **G-006:** Make failures understandable through a stable taxonomy and plain-language evidence.
- **G-007:** Create a useful open-source portfolio project with a hosted SaaS path.
- **G-008:** Build a public compatibility history that becomes more valuable as package versions accumulate.
- **G-009:** Give maintainers a recurring reason to use the product through release regression monitoring.
- **G-010:** Keep AI optional and outside the authoritative compatibility decision.

### 5.2 Secondary goals

- Encourage maintainers to publish runtime compatibility evidence.
- Make runtime-specific regressions easier to report upstream.
- Provide reusable structured data for package managers, documentation sites, and CI systems.
- Support community-contributed compatibility probes after a trust model exists.

### 5.3 Non-goals

The MVP is not:

- a malware scanner;
- a vulnerability scanner;
- a complete package-quality score;
- a replacement for a package's own test suite;
- a universal guarantee that a package works in every application;
- a benchmark service;
- a browser compatibility laboratory;
- a package hosting registry;
- a package installation proxy;
- a code-generation assistant;
- a general-purpose untrusted-code execution platform.

---

## 6. Product principles

1. **Evidence before verdicts.** Every result must expose the observations behind it.
2. **Exact versions only.** Mutable labels such as `latest` must be resolved before a scan identity is created.
3. **No universal compatibility claim.** Reports describe tested behavior under a defined environment.
4. **Deterministic core.** Parsing, execution, classification, and assertions must be deterministic.
5. **AI is advisory.** Model output may explain evidence but may not create the authoritative result.
6. **Secure by isolation.** Runtime-level permission flags are defense in depth, not the primary security boundary.
7. **No secrets in untrusted sandboxes.** Package code must never receive production credentials.
8. **Same artifact, controlled comparison.** Runtime comparisons must minimize unrelated package-manager differences.
9. **Useful without signup.** Accounts are for ownership, history, monitoring, alerts, and private use cases.
10. **Open engine, hosted convenience.** The scanner should be inspectable and reproducible locally.
11. **Conservative language.** Unknown or unsupported cases must be marked inconclusive rather than guessed.
12. **Focused scope.** The product should be excellent for public npm packages before expanding to more ecosystems.

---

## 7. Target users

### 7.1 Package consumer

A developer deciding whether an npm package can be used under Bun or Deno instead of Node.js.

Needs:

- a fast answer;
- exact failure evidence;
- an indication of whether the problem is installation, module loading, runtime API support, permissions, or native code;
- a reproducible command or report to share.

### 7.2 Package maintainer

A maintainer publishing a package intended to work across runtimes.

Needs:

- testing of the published tarball, not only repository source;
- a historical matrix by release;
- regression notifications;
- a meaningful package-specific probe;
- a badge or public evidence page;
- a way to link failures to a release or issue.

### 7.3 Runtime maintainer or contributor

A Node.js, Bun, or Deno contributor investigating ecosystem compatibility.

Needs:

- groups of failures by API and runtime version;
- reproduction artifacts;
- package examples affected by the same incompatibility;
- normalized, searchable error data.

### 7.4 Engineering team

A team standardizing on a runtime or evaluating migration risk.

Needs:

- scanning for a dependency list;
- policies such as "all production dependencies must pass a maintained probe under the selected runtime";
- private package support;
- API and CI integration.

This is a later paid-user segment, not a requirement for the anonymous MVP.

---

## 8. Terminology

- **Package artifact:** The exact npm tarball associated with a package version and integrity value.
- **Runtime image:** An immutable OCI image containing one runtime version and the compatibility harness.
- **Automatic probe:** A generic service-generated test such as ESM import, CommonJS require, or export-subpath resolution.
- **Maintainer probe:** A package-specific assertion supplied by a verified repository maintainer.
- **Scan:** The top-level request for one package artifact against a runtime matrix.
- **Run:** One package artifact, one runtime image, one probe definition, and one execution policy.
- **Harness:** CompatLab code that invokes the package and emits a structured result.
- **Smoke tested:** Installation and generic module-loading behavior were exercised.
- **Probe verified:** A package-specific behavior assertion completed successfully.
- **Partial:** Some defined probes passed while others failed or required unsupported capabilities.
- **Inconclusive:** The service could not produce a valid compatibility conclusion.
- **Execution policy:** Resource limits, network policy, filesystem policy, environment policy, and sandbox version.
- **Compatibility regression:** A previously passing defined probe fails for a later package or runtime version under comparable conditions.

---

## 9. Scope and delivery phases

### 9.1 Phase 0: Local proof of concept

The local engine shall:

- accept `package@version`;
- resolve exact npm metadata;
- prepare an isolated dependency workspace;
- run at least Node.js, Bun, and Deno locally;
- execute ESM import and CommonJS require where applicable;
- produce normalized JSON;
- clean up all temporary resources.

No public website shall be launched until the engine can produce useful results and survive hostile test fixtures.

### 9.2 Phase 1: Public MVP

The public MVP shall support:

- public npm packages only;
- exact published versions;
- Linux x86-64 only;
- pure JavaScript and WebAssembly packages;
- a service-controlled runtime matrix containing two supported Node.js lines, one stable Bun line, and one stable Deno line;
- automatic static analysis;
- lifecycle-script detection;
- native-addon detection without executing native compilation;
- ESM import probes;
- CommonJS require probes where applicable;
- explicit public export-subpath probes;
- public report pages;
- live scan progress;
- immutable scan metadata;
- raw and normalized failures;
- caching and deduplication;
- no-login scanning with rate limits.

### 9.3 Phase 2: Maintainer workflow

Phase 2 shall add:

- GitHub sign-in;
- repository association;
- package claim workflow;
- maintainer-defined probes;
- release monitoring;
- compatibility history and comparison;
- alerts;
- badges;
- GitHub Actions integration.

### 9.4 Phase 3: Team SaaS

Phase 3 may add:

- private npm registries;
- organization workspaces;
- dependency-set scans;
- compatibility policies;
- release gates;
- API tokens;
- usage plans and billing;
- stronger per-customer retention controls.

### 9.5 Explicitly deferred

The following are OUT of the MVP:

- arbitrary tarball URL submission;
- anonymous file upload;
- arbitrary anonymous JavaScript execution;
- full upstream package test suites;
- browser and DOM simulation;
- Windows and macOS runners;
- ARM64 runners;
- native addon compilation and execution;
- private packages;
- Cloudflare Workers and other edge runtimes;
- automated source-code modification;
- AI-generated compatibility verdicts;
- benchmark comparisons;
- package security or trust scoring.

---

## 10. Core user journeys

### 10.1 Anonymous visitor: cached result

1. User opens the homepage.
2. User searches for a package.
3. Autocomplete returns package metadata.
4. User selects a version or accepts the resolved current version.
5. The service finds a current report for the exact scan identity.
6. The result page loads immediately.
7. User reviews the matrix, evidence, limitations, and reproduction information.
8. User shares the report or copies a badge.

### 10.2 Anonymous visitor: new scan

1. User searches for a package and exact version.
2. The service resolves the package artifact and computes a scan key.
3. No reusable report exists.
4. The user requests a scan.
5. The service applies rate limits and creates one deduplicated scan.
6. The page displays live phase and runtime progress through Server-Sent Events.
7. Fetch and preparation complete inside the restricted preparation environment.
8. Runtime jobs execute independently.
9. Results are normalized and aggregated.
10. The page updates to the final public report.

### 10.3 Visitor: investigate a failure

1. User selects a failed runtime cell.
2. The interface displays the phase, classification, probe, entry point, normalized message, raw logs, and environment.
3. The user can copy a reproduction command or download structured JSON.
4. The page links to related package versions and equivalent failures under other runtime releases.
5. AI-generated explanation, if enabled later, is visually separated from deterministic evidence.

### 10.4 Maintainer: claim and monitor a package

1. User signs in with GitHub.
2. User selects a repository they can administer.
3. The service verifies the repository relationship advertised by the npm package and labels the level of verification.
4. User associates one or more packages with the repository.
5. User enables release monitoring.
6. New published versions trigger scans.
7. The service compares the new report with the previous version.
8. The maintainer receives an alert only for configured regressions or material changes.

### 10.5 Maintainer: add a meaningful probe

1. Maintainer adds a versioned probe manifest and probe source in the repository.
2. The service fetches it from an allowed repository reference.
3. The probe declares permitted capabilities and a timeout.
4. The service validates the schema and security policy.
5. The probe executes in the same sandbox model as automatic probes.
6. Reports distinguish maintainer-probe results from automatic smoke tests.
7. A probe change creates a new probe digest and never rewrites historical results.

### 10.6 Administrator: investigate abuse or runner failure

1. Administrator opens an internal operations view.
2. The view shows queued, running, timed-out, failed, and quarantined jobs.
3. Administrator can inspect sanitized infrastructure logs without accessing package secrets because none are present.
4. Administrator can block a package version, IP range, account, or probe digest.
5. Administrator can drain a runner, retry an infrastructure failure, or invalidate a faulty runtime image.
6. User-caused failures and infrastructure failures remain separately classified.

---

## 11. Functional requirements

### 11.1 Public discovery and package selection

- **FR-DISC-001 (P0):** The homepage MUST provide one primary package search input.  
  **Acceptance:** A new visitor can start a package search without signing in or navigating to another page.

- **FR-DISC-002 (P0):** Search MUST query public npm package metadata and support scoped package names.  
  **Acceptance:** Queries such as `zod` and `@scope/package` return correctly distinguished results.

- **FR-DISC-003 (P0):** Search results MUST display package name, description when available, current dist-tag version, and repository link when available.  
  **Acceptance:** Missing metadata is handled without breaking the result list.

- **FR-DISC-004 (P0):** The user MUST be able to select an exact published version.  
  **Acceptance:** A dist-tag is resolved to an immutable version before the scan is created.

- **FR-DISC-005 (P0):** Invalid, unpublished, deprecated, or unavailable versions MUST produce a clear state.  
  **Acceptance:** The UI does not create an execution job when the artifact cannot be resolved.

- **FR-DISC-006 (P0):** Existing reports SHOULD be visible from package search results.  
  **Acceptance:** A user can distinguish a cached report from an unscanned version.

- **FR-DISC-007 (P1):** Package pages SHOULD list recent versions and the latest report status for each.  
  **Acceptance:** The user can navigate version history without editing the URL manually.

- **FR-DISC-008 (P1):** Search SHOULD tolerate minor typing errors without silently selecting the wrong package.  
  **Acceptance:** Suggestions are labeled and require explicit selection.

- **FR-DISC-009 (P2):** Public reports MAY be indexed by web search engines.  
  **Acceptance:** Canonical URLs and structured metadata are present, while active scan-progress pages are not indexed.

### 11.2 Scan request, identity, caching, and orchestration

- **FR-SCAN-001 (P0):** A scan MUST be identified by immutable inputs, including package artifact digest, runtime image digests, harness version, probe digest, and execution-policy version.  
  **Acceptance:** Two requests with the same immutable identity reuse one result.

- **FR-SCAN-002 (P0):** Mutable tags such as `latest` MUST NOT be part of the durable scan identity.  
  **Acceptance:** The service stores the resolved exact package version and artifact integrity value.

- **FR-SCAN-003 (P0):** Concurrent requests for the same missing scan MUST be deduplicated.  
  **Acceptance:** Only one execution graph is created and all visitors observe the same progress.

- **FR-SCAN-004 (P0):** Scan creation MUST be subject to per-IP, per-account, per-package, and global capacity limits.  
  **Acceptance:** Excess requests receive a retryable response without creating unbounded queue entries.

- **FR-SCAN-005 (P0):** A scan MUST expose a stable state machine.  
  **Acceptance:** States include requested, resolving, preparing, queued, running, aggregating, completed, inconclusive, failed-infrastructure, rejected, and cancelled.

- **FR-SCAN-006 (P0):** The service MUST distinguish package-caused failure from infrastructure-caused failure.  
  **Acceptance:** A runner outage does not cause a package to be labeled incompatible.

- **FR-SCAN-007 (P0):** Scan progress MUST be available through a one-way event stream suitable for Server-Sent Events.  
  **Acceptance:** A browser reconnect can resume from the current stored state.

- **FR-SCAN-008 (P0):** Completed immutable results MUST be cacheable.  
  **Acceptance:** Repeated views do not re-run package code.

- **FR-SCAN-009 (P1):** The system SHOULD permit a controlled rescan when a runtime image, harness, or execution policy changes.  
  **Acceptance:** Historical results remain available and are not overwritten.

- **FR-SCAN-010 (P1):** Administrators SHOULD be able to invalidate reports generated by a faulty service component.  
  **Acceptance:** Invalidated reports are visibly marked and excluded from default current results.

### 11.3 Package resolution and artifact acquisition

- **FR-PKG-001 (P0):** The service MUST resolve package metadata using the public npm registry.  
  **Acceptance:** Scoped and unscoped packages resolve consistently.

- **FR-PKG-002 (P0):** The service MUST record package name, exact version, distribution tags observed, tarball URL, integrity/checksum data, publication metadata, repository metadata, and package manifest.  
  **Acceptance:** The report can identify the exact artifact independently of a mutable tag.

- **FR-PKG-003 (P0):** Tarball integrity MUST be verified when the registry supplies a verifiable integrity value.  
  **Acceptance:** A mismatch rejects the preparation job and creates no runtime runs.

- **FR-PKG-004 (P0):** Artifact downloads MUST enforce compressed size, expanded size, file count, path length, and extraction time limits.  
  **Acceptance:** Oversized or archive-bomb-like packages are rejected with an inconclusive reason.

- **FR-PKG-005 (P0):** Extraction MUST prevent absolute paths, parent-directory traversal, unsafe symlinks, device files, and special host filesystem objects.  
  **Acceptance:** Security fixtures cannot write outside the temporary extraction root.

- **FR-PKG-006 (P0):** Package acquisition MUST occur in an isolated preparation environment rather than in the web process.  
  **Acceptance:** The web application never executes a package manager against untrusted input.

- **FR-PKG-007 (P0):** The acquisition stage MUST use an egress allowlist limited to required registry and artifact endpoints.  
  **Acceptance:** A package cannot use the preparation network to contact arbitrary destinations.

- **FR-PKG-008 (P0):** No package-registry credential MUST be exposed for public packages.  
  **Acceptance:** Public scans use unauthenticated or service-proxied fetches with no reusable secret inside the sandbox.

- **FR-PKG-009 (P1):** The service SHOULD retain artifact metadata longer than raw package contents.  
  **Acceptance:** A report remains reproducible by digest after temporary package files are deleted.

### 11.4 Static package analysis

- **FR-STATIC-001 (P0):** The analyzer MUST parse the published `package.json`.  
  **Acceptance:** Invalid JSON produces a structured package-metadata failure.

- **FR-STATIC-002 (P0):** The analyzer MUST record `type`, `main`, `module`, `exports`, `imports`, `engines`, `os`, `cpu`, `libc`, `bin`, dependencies, optional dependencies, peer dependencies, bundled dependencies, and lifecycle scripts when present.  
  **Acceptance:** Results expose the relevant values without claiming unsupported semantics.

- **FR-STATIC-003 (P0):** The analyzer MUST classify a package as CommonJS, ESM, dual-mode, conditional, or indeterminate where possible.  
  **Acceptance:** The generated probe plan explains why each module-loading probe was selected.

- **FR-STATIC-004 (P0):** The analyzer MUST enumerate explicit public export subpaths that can be resolved without pattern expansion ambiguity.  
  **Acceptance:** Each enumerated subpath receives an independent probe result.

- **FR-STATIC-005 (P0):** The analyzer MUST detect native-addon indicators such as `.node` files, `binding.gyp`, and known native build dependencies.  
  **Acceptance:** Native packages are labeled unsupported or inconclusive in the MVP rather than executed.

- **FR-STATIC-006 (P0):** The analyzer MUST detect lifecycle scripts and identify install-time scripts separately.  
  **Acceptance:** The report states that scripts were disabled and whether the package appears to require them.

- **FR-STATIC-007 (P0):** The analyzer SHOULD identify direct imports of known runtime-specific built-in modules.  
  **Acceptance:** Static observations are labeled as observations, not proof of failure.

- **FR-STATIC-008 (P0):** The analyzer MUST detect obvious platform restrictions declared by `os`, `cpu`, and `libc`.  
  **Acceptance:** An incompatible declared target prevents misleading execution results.

- **FR-STATIC-009 (P1):** The analyzer SHOULD identify top-level files, package size, dependency count, and export count for report context.  
  **Acceptance:** These values do not contribute to a quality score.

- **FR-STATIC-010 (P1):** Static analysis SHOULD produce a versioned machine-readable probe plan.  
  **Acceptance:** The same artifact and analyzer version produce equivalent plan output.

### 11.5 Dependency workspace preparation

- **FR-PREP-001 (P0):** Each package version MUST be installed into a temporary private project rather than executed directly from the unpacked tarball.  
  **Acceptance:** Dependency resolution resembles an ordinary consumer installation.

- **FR-PREP-002 (P0):** Lifecycle scripts MUST be disabled for public MVP dependency preparation.  
  **Acceptance:** `preinstall`, `install`, `postinstall`, and dependency lifecycle scripts do not execute.

- **FR-PREP-003 (P0):** The service MUST record the package-manager version and dependency lock data used for preparation.  
  **Acceptance:** The exact preparation environment is visible in the report metadata.

- **FR-PREP-004 (P0):** The prepared workspace MUST be immutable during runtime comparison except for a separate temporary directory.  
  **Acceptance:** One runtime cannot change files observed by another runtime.

- **FR-PREP-005 (P0):** The same prepared dependency tree SHOULD be used across runtime runs when technically valid.  
  **Acceptance:** Differences caused only by separate package-manager resolution are minimized.

- **FR-PREP-006 (P0):** Preparation failures MUST be classified separately from runtime failures.  
  **Acceptance:** A dependency installation failure does not become an ESM import failure.

- **FR-PREP-007 (P0):** Packages that require install scripts or native compilation MUST be reported as unsupported or inconclusive under the MVP policy.  
  **Acceptance:** The service does not enable scripts automatically to make a scan pass.

- **FR-PREP-008 (P1):** Prepared workspaces SHOULD be content-addressed and reusable for identical scan inputs.  
  **Acceptance:** Reuse never permits mutable cross-scan state.

### 11.6 Runtime matrix management

- **FR-RUNTIME-001 (P0):** The service MUST maintain an explicit supported runtime matrix.  
  **Acceptance:** Every report names the runtime, semantic version, image digest, OS, architecture, and build date.

- **FR-RUNTIME-002 (P0):** Runtime images MUST be immutable and referenced by digest for execution.  
  **Acceptance:** A moving image tag cannot silently change a historical result.

- **FR-RUNTIME-003 (P0):** The initial matrix MUST include two supported Node.js release lines, one stable Bun release line, and one stable Deno release line selected at implementation time.  
  **Acceptance:** The precise versions are configured centrally and displayed publicly.

- **FR-RUNTIME-004 (P0):** Runtime images MUST contain only the runtime, harness dependencies, certificates required by the preparation model, and minimal operating-system utilities.  
  **Acceptance:** Images do not contain production credentials or development convenience tools unnecessary for execution.

- **FR-RUNTIME-005 (P0):** Updating a runtime version MUST create new scan identities.  
  **Acceptance:** Existing results remain tied to the old digest.

- **FR-RUNTIME-006 (P1):** The service SHOULD maintain a runtime lifecycle status: active, preview, deprecated, or retired.  
  **Acceptance:** Deprecated runtime results remain visible but are not used as the default matrix.

- **FR-RUNTIME-007 (P1):** Runtime image build provenance SHOULD be published.  
  **Acceptance:** Users can identify the Dockerfile or source commit for each image.

### 11.7 Automatic probes

- **FR-PROBE-001 (P0):** The service MUST generate an ESM import probe when the package exposes an ESM-compatible entry point.  
  **Acceptance:** The result records success, duration, exported names, and failure evidence.

- **FR-PROBE-002 (P0):** The service MUST generate a CommonJS require probe when the package exposes or plausibly supports CommonJS.  
  **Acceptance:** Non-applicable cases are labeled not applicable, not failed.

- **FR-PROBE-003 (P0):** The service MUST test each safely enumerable explicit public export subpath.  
  **Acceptance:** The report identifies the exact failing subpath.

- **FR-PROBE-004 (P0):** Generic probes MUST NOT automatically invoke arbitrary exported functions.  
  **Acceptance:** Smoke tests stop at module loading and safe introspection unless a verified probe defines behavior.

- **FR-PROBE-005 (P0):** Probe output MUST be structured and must separate harness output from package stdout and stderr.  
  **Acceptance:** A package cannot forge the authoritative result by printing matching JSON.

- **FR-PROBE-006 (P0):** Every probe MUST have a wall-clock timeout, process limit, output limit, memory limit, and disk limit.  
  **Acceptance:** Infinite loops, fork bombs, and output floods terminate predictably.

- **FR-PROBE-007 (P0):** The service MUST capture observable attempts to access denied capabilities when supported by the runtime or sandbox.  
  **Acceptance:** The report may identify filesystem, environment, network, or subprocess denial without claiming complete behavior tracing.

- **FR-PROBE-008 (P0):** Probe source and generated files MUST be versioned by digest.  
  **Acceptance:** A harness update creates a new result identity.

- **FR-PROBE-009 (P1):** The service SHOULD support package `bin` entry smoke testing under a separate capability policy.  
  **Acceptance:** CLI testing is not mixed with library import results.

- **FR-PROBE-010 (P2):** The service MAY support standardized ecosystem probe templates for parsers, serializers, schema libraries, and other common package categories.  
  **Acceptance:** Templates remain explicit assertions rather than heuristic API calls.

### 11.8 Maintainer-defined probes

- **FR-VERIFY-001 (P1):** Authenticated verified maintainers SHOULD be able to define a versioned package-specific probe.  
  **Acceptance:** Anonymous users cannot upload arbitrary executable probes.

- **FR-VERIFY-002 (P1):** A maintainer probe MUST declare package version range, entry file, timeout, required capabilities, and expected assertion behavior.  
  **Acceptance:** Invalid or overbroad capability requests are rejected before execution.

- **FR-VERIFY-003 (P1):** Maintainer probes SHOULD be loaded from a linked public repository commit rather than pasted into the web interface.  
  **Acceptance:** Probe source is reviewable and tied to an immutable commit.

- **FR-VERIFY-004 (P1):** A change to probe code or permissions MUST create a new probe digest.  
  **Acceptance:** Historical reports preserve the earlier probe definition.

- **FR-VERIFY-005 (P1):** Reports MUST distinguish automatic smoke tests from maintainer-verified probes.  
  **Acceptance:** A user cannot mistake import success for a meaningful behavior assertion.

- **FR-VERIFY-006 (P1):** Maintainer probes MUST execute under equal or stricter isolation than automatic probes.  
  **Acceptance:** Verification status never weakens sandbox controls.

- **FR-VERIFY-007 (P1):** The service MUST display the declared capability set used by each probe.  
  **Acceptance:** A probe with filesystem permission is visibly different from a zero-capability probe.

- **FR-VERIFY-008 (P2):** Community-contributed probes MAY be supported after moderation and trust policies exist.  
  **Acceptance:** Community probes are labeled separately from maintainer probes.

### 11.9 Sandboxed runtime execution

- **FR-EXEC-001 (P0):** The control-plane web process MUST never directly execute package or probe code.  
  **Acceptance:** All untrusted execution occurs on dedicated runner infrastructure.

- **FR-EXEC-002 (P0):** Runtime jobs MUST execute inside a strong operating-system isolation boundary, initially gVisor or an equivalent OCI-compatible sandbox.  
  **Acceptance:** Plain unsandboxed Docker is not the only boundary for public untrusted execution.

- **FR-EXEC-003 (P0):** Runtime containers MUST run as an unprivileged user with no added Linux capabilities.  
  **Acceptance:** Effective capabilities are empty or minimized according to the sandbox platform.

- **FR-EXEC-004 (P0):** Runtime jobs MUST NOT mount host directories, container sockets, cloud credentials, SSH keys, service tokens, or control-plane configuration.  
  **Acceptance:** Host-sensitive paths are absent in sandbox inspection tests.

- **FR-EXEC-005 (P0):** The root filesystem MUST be read-only, with a small isolated writable temporary filesystem.  
  **Acceptance:** Package writes outside the allowed temporary area fail.

- **FR-EXEC-006 (P0):** Outbound network access MUST be disabled during package execution.  
  **Acceptance:** Network-exfiltration fixtures cannot reach the public internet, local services, metadata endpoints, or other jobs.

- **FR-EXEC-007 (P0):** Each run MUST enforce CPU, memory, process-count, wall-time, file-size, output-size, and temporary-disk quotas.  
  **Acceptance:** Hostile resource fixtures terminate without affecting runner availability.

- **FR-EXEC-008 (P0):** Each run MUST use an isolated process namespace, filesystem namespace, and network namespace or equivalent sandbox mechanism.  
  **Acceptance:** Jobs cannot observe sibling job processes or files.

- **FR-EXEC-009 (P0):** Runtime-level permissions SHOULD be used as defense in depth where supported.  
  **Acceptance:** The report records the runtime permission flags without treating them as the primary isolation boundary.

- **FR-EXEC-010 (P0):** A runner MUST destroy all per-job resources after completion, timeout, cancellation, or crash recovery.  
  **Acceptance:** Automated cleanup tests find no reusable writable job state.

- **FR-EXEC-011 (P0):** The runner MUST authenticate control-plane work and result submission.  
  **Acceptance:** Arbitrary network clients cannot submit forged scan results.

- **FR-EXEC-012 (P0):** The runner's database or API credentials MUST have the minimum privileges required to claim jobs and submit results.  
  **Acceptance:** Compromise of a runner cannot read user authentication data or modify unrelated reports.

- **FR-EXEC-013 (P1):** Runner capacity SHOULD scale horizontally.  
  **Acceptance:** Additional runners can claim independent jobs without duplicate execution.

- **FR-EXEC-014 (P1):** The architecture SHOULD support migration to Firecracker or an equivalent microVM boundary.  
  **Acceptance:** Execution contracts do not assume direct access to a shared host filesystem.

### 11.10 Result normalization and compatibility semantics

- **FR-RESULT-001 (P0):** The service MUST store raw execution evidence and a normalized result separately.  
  **Acceptance:** Reclassification can occur without losing original logs.

- **FR-RESULT-002 (P0):** Results MUST use a versioned error taxonomy.  
  **Acceptance:** Every failed run has either a defined classification or `UNCLASSIFIED_RUNTIME_FAILURE`.

- **FR-RESULT-003 (P0):** The service MUST distinguish pass, partial, failed, inconclusive, unsupported, not applicable, and infrastructure error.  
  **Acceptance:** Infrastructure errors never appear as package failures.

- **FR-RESULT-004 (P0):** Each result MUST identify the phase in which it occurred: resolution, acquisition, extraction, preparation, static analysis, sandbox startup, module resolution, module evaluation, probe assertion, or teardown.  
  **Acceptance:** The report does not present all failures as generic runtime failures.

- **FR-RESULT-005 (P0):** Compatibility confidence MUST be represented by evidence level: static only, smoke tested, or probe verified.  
  **Acceptance:** A public badge includes the evidence level or links to it.

- **FR-RESULT-006 (P0):** A package MUST NOT receive a universal "compatible" label based only on one successful import.  
  **Acceptance:** The UI says what passed, not that every use case is guaranteed.

- **FR-RESULT-007 (P0):** Normalization MUST remove unstable absolute temporary paths, sandbox identifiers, and terminal control sequences from the user-facing summary.  
  **Acceptance:** Reports are readable and cannot inject terminal or HTML behavior.

- **FR-RESULT-008 (P0):** Raw logs MUST be size limited and sanitized before storage and display.  
  **Acceptance:** Oversized output is truncated with an explicit marker.

- **FR-RESULT-009 (P0):** Aggregate package results MUST be derived from individual probe results by documented rules.  
  **Acceptance:** Users can inspect why a runtime cell is partial or failed.

- **FR-RESULT-010 (P1):** The service SHOULD detect regressions only between comparable results.  
  **Acceptance:** A runtime-image change, probe change, or policy change is shown separately from a package-version change.

- **FR-RESULT-011 (P1):** Equivalent normalized failures SHOULD be groupable across package and runtime versions.  
  **Acceptance:** The system can later identify packages affected by the same missing API.

### 11.11 Public report and sharing

- **FR-REPORT-001 (P0):** Every completed public scan MUST have a stable human-readable URL.  
  **Acceptance:** The URL includes package identity and exact version or an opaque stable report identifier.

- **FR-REPORT-002 (P0):** The report MUST display a runtime matrix with installation/preparation, ESM, CommonJS, export-subpath, and verified-probe status where applicable.  
  **Acceptance:** Non-applicable cells are visually distinct from failures.

- **FR-REPORT-003 (P0):** Selecting a result cell MUST reveal phase, classification, entry point, normalized message, raw log excerpt, duration, resource outcome, and reproduction metadata.  
  **Acceptance:** A user can understand the failure without inspecting backend logs.

- **FR-REPORT-004 (P0):** The report MUST display exact package artifact integrity, runtime image digest, harness version, probe digest, execution-policy version, OS, architecture, and scan date.  
  **Acceptance:** Evidence is sufficient to distinguish two otherwise similar scans.

- **FR-REPORT-005 (P0):** The report MUST display limitations and explain the evidence level.  
  **Acceptance:** Smoke-tested reports state that meaningful API behavior may remain untested.

- **FR-REPORT-006 (P0):** The report MUST provide downloadable machine-readable JSON.  
  **Acceptance:** JSON conforms to a versioned public schema.

- **FR-REPORT-007 (P0):** The report SHOULD provide a reproducible local CLI command when the open-source CLI supports the scan configuration.  
  **Acceptance:** The command uses exact versions rather than mutable tags.

- **FR-REPORT-008 (P1):** The report SHOULD provide embeddable Markdown and HTML badges.  
  **Acceptance:** The badge links to the full evidence page and does not imply more than the evidence level.

- **FR-REPORT-009 (P1):** The report SHOULD compare the selected package version with adjacent scanned versions.  
  **Acceptance:** Changes in runtime matrix, probe, or policy are clearly labeled.

- **FR-REPORT-010 (P1):** Public report pages SHOULD have appropriate Open Graph and structured metadata.  
  **Acceptance:** Shared links produce a useful preview without exposing raw logs in preview text.

- **FR-REPORT-011 (P1):** The interface SHOULD meet WCAG 2.2 AA for core public flows.  
  **Acceptance:** Matrix state is conveyed by text and icons, not color alone.

### 11.12 Authentication, ownership, and accounts

- **FR-AUTH-001 (P1):** GitHub OAuth SHOULD be the initial authentication mechanism.  
  **Acceptance:** Users can sign in without creating a separate password.

- **FR-AUTH-002 (P1):** Authentication MUST NOT be required for viewing reports or requesting normal public scans within anonymous limits.  
  **Acceptance:** The primary product remains useful without signup.

- **FR-AUTH-003 (P1):** The service SHOULD allow a user to associate a GitHub repository they can administer.  
  **Acceptance:** Repository access is requested with the minimum OAuth or GitHub App permissions.

- **FR-AUTH-004 (P1):** Package ownership verification MUST be represented as levels rather than a binary claim if absolute npm ownership cannot be proven.  
  **Acceptance:** Labels distinguish repository maintainer, organization administrator, and npm-verified owner when available.

- **FR-AUTH-005 (P1):** Sensitive OAuth tokens MUST be encrypted at rest or avoided through short-lived GitHub App credentials.  
  **Acceptance:** Tokens never enter runtime sandboxes or logs.

- **FR-AUTH-006 (P1):** Users MUST be able to revoke repository association and delete account-linked configuration.  
  **Acceptance:** Public immutable reports may remain when lawfully retained, but personal linkage is removed according to policy.

- **FR-AUTH-007 (P2):** Organization workspaces MAY support roles such as owner, maintainer, viewer, and billing administrator.  
  **Acceptance:** Role permissions are enforced server-side.

### 11.13 Release monitoring and notifications

- **FR-MON-001 (P1):** A verified maintainer SHOULD be able to enable monitoring for new package versions.  
  **Acceptance:** A new exact version triggers at most one scan for the configured matrix.

- **FR-MON-002 (P1):** The monitor MUST use registry publication data and periodic reconciliation rather than relying on one unreliable event source.  
  **Acceptance:** Missed transient notifications are repaired by reconciliation.

- **FR-MON-003 (P1):** The service SHOULD compare the new version with the most relevant previous scanned version.  
  **Acceptance:** Comparisons disclose non-package variables that changed.

- **FR-MON-004 (P1):** Users SHOULD configure alert conditions, including any failure, pass-to-fail regression, evidence-level reduction, or selected runtime only.  
  **Acceptance:** Users are not notified for every unchanged scan.

- **FR-MON-005 (P1):** Initial notification channels SHOULD include email and GitHub status/comment integration.  
  **Acceptance:** Notification failures are retried without re-running the scan.

- **FR-MON-006 (P1):** Alerts MUST link to the immutable comparison report.  
  **Acceptance:** An alert does not summarize a different later scan.

### 11.14 API, exports, badges, and integrations

- **FR-API-001 (P0):** The frontend MUST consume versioned server contracts rather than scraping rendered report pages.  
  **Acceptance:** Public report JSON and internal UI data share stable typed schemas where appropriate.

- **FR-API-002 (P1):** A read-only public API SHOULD expose package/version summary and immutable report details.  
  **Acceptance:** API responses are rate limited and documented.

- **FR-API-003 (P1):** Badges MUST be generated from immutable or clearly current report references.  
  **Acceptance:** A badge cannot silently represent an unrelated runtime matrix.

- **FR-API-004 (P1):** The open-source CLI SHOULD be able to emit the same result schema as the hosted service.  
  **Acceptance:** Local and hosted reports are comparable.

- **FR-API-005 (P1):** A GitHub Actions integration SHOULD support scanning a package artifact before or after publication.  
  **Acceptance:** Pre-publication results are clearly distinct from registry-artifact results.

- **FR-API-006 (P2):** API tokens MAY support private organization use in a later paid plan.  
  **Acceptance:** Tokens are scoped, revocable, and never displayed after creation.

### 11.15 Administration, moderation, and abuse handling

- **FR-ADMIN-001 (P0):** Administrators MUST be able to view queue depth, job state, runner health, failure rates, and recent abuse events.  
  **Acceptance:** Operations do not require direct database editing.

- **FR-ADMIN-002 (P0):** Administrators MUST be able to block a package version or probe digest from execution.  
  **Acceptance:** Blocked items display a neutral service-policy state rather than a compatibility failure.

- **FR-ADMIN-003 (P0):** Administrators MUST be able to quarantine a runtime image or harness release.  
  **Acceptance:** New jobs stop using it and affected reports can be invalidated.

- **FR-ADMIN-004 (P0):** Retry controls MUST distinguish retryable infrastructure failures from deterministic package failures.  
  **Acceptance:** A deterministic package failure is not automatically retried indefinitely.

- **FR-ADMIN-005 (P0):** Abuse controls MUST include IP throttling, account throttling, package cooldowns, duplicate suppression, input size limits, and global concurrency limits.  
  **Acceptance:** A single user cannot consume all runner capacity with duplicate requests.

- **FR-ADMIN-006 (P1):** Administrators SHOULD be able to redact accidentally retained sensitive output from a report artifact while preserving an audit record.  
  **Acceptance:** Redaction does not rewrite the result classification without an explicit new version.

- **FR-ADMIN-007 (P1):** The system SHOULD expose a public service status and incident history.  
  **Acceptance:** Users can distinguish platform incidents from package incompatibility.

---

## 12. Compatibility model

### 12.1 Evidence levels

| Evidence level | Meaning | Allowed claim |
|---|---|---|
| Static only | Package metadata and structure were inspected, but no valid runtime execution completed | "Inspected" |
| Smoke tested | Installation/preparation and generic module-loading probes completed | "Loaded under the tested configuration" |
| Probe verified | A package-specific meaningful assertion passed | "Verified for the named behavior under the tested configuration" |

### 12.2 Runtime outcome states

| State | Meaning |
|---|---|
| Pass | Every required probe for the displayed category succeeded |
| Partial | Some applicable probes succeeded and others failed or required unavailable capabilities |
| Fail | A defined applicable probe reproducibly failed because of package/runtime behavior |
| Inconclusive | A valid conclusion could not be produced, for example because install scripts were required |
| Unsupported | The package type is outside the current service boundary, for example a native addon in MVP |
| Not applicable | The probe does not apply, for example CommonJS require for an ESM-only package |
| Infrastructure error | The service failed before a package conclusion could be reached |

### 12.3 Aggregate rules

- A runtime must not be shown as Pass if any required applicable probe failed.
- A runtime may be Partial when optional or secondary export paths fail while the root path passes.
- A runtime must be Inconclusive when the service policy prevented the package from reaching a valid test state.
- A package requiring disabled install scripts must not be labeled incompatible solely because scripts were disabled.
- A package with a native addon must be Unsupported in the MVP unless the native boundary is later explicitly added.
- A successful import is Smoke tested, not Probe verified.
- A verified probe result applies only to the named behavior and declared permissions.

### 12.4 Comparison rules

A comparison is directly attributable to a package-version change only when these remain equal:

- runtime image digest;
- harness version;
- probe digest;
- execution-policy version;
- operating system and architecture;
- dependency-preparation policy.

If any differ, the UI must disclose the confounding change.

---

## 13. User interface requirements

### 13.1 Homepage

The homepage must include:

- clear one-sentence explanation;
- package search input;
- example searches;
- recently scanned or illustrative reports;
- explanation of evidence levels;
- concise safety and limitation statement;
- link to open-source CLI and methodology.

The homepage must not lead with account creation or pricing.

### 13.2 Package page

The package page should include:

- package name, description, repository, and npm link;
- selected version;
- version selector;
- latest report summary;
- runtime matrix;
- report freshness and immutable identifiers;
- version history;
- maintainer-verification state;
- request-scan action when no current report exists.

### 13.3 Live scan page

The progress interface must show at least:

1. resolving metadata;
2. validating artifact integrity;
3. inspecting package structure;
4. preparing dependencies;
5. queuing runtime jobs;
6. per-runtime execution;
7. result aggregation;
8. completion or inconclusive state.

Progress must represent stored facts. It must not show fabricated percentages when the service cannot estimate them.

### 13.4 Result detail

Each result detail must show:

- runtime and exact version;
- probe name and type;
- phase;
- status;
- normalized classification;
- normalized message;
- raw log excerpt;
- package entry point or subpath;
- duration and resource termination reason;
- declared permissions;
- reproduction metadata;
- known limitations.

### 13.5 Comparison page

The comparison page should show:

- package version A and B;
- runtime matrix differences;
- probe-level changes;
- new or resolved failures;
- artifact, runtime, harness, probe, and policy differences;
- a statement when causality cannot be isolated.

### 13.6 Dashboard

The maintainer dashboard should show:

- monitored packages;
- latest release status;
- unresolved regressions;
- recent scans;
- probe status;
- alert configuration;
- linked repositories;
- plan and quota information when billing exists.

---

## 14. Technical architecture

### 14.1 High-level architecture

```text
Browser
  |
  | HTTPS + Server-Sent Events
  v
Web and Control Plane
  |- Public website and API
  |- Authentication and package ownership
  |- Scan orchestration
  |- Report aggregation
  |- PostgreSQL
  |- Object storage
  |- Notification service
  |
  | restricted job contract
  v
Preparation Worker
  |- Registry metadata retrieval
  |- Integrity verification
  |- Safe extraction
  |- Static analysis
  |- Dependency workspace creation
  |- Lifecycle scripts disabled
  |
  | immutable prepared workspace reference
  v
Runner Supervisor
  |- Claims runtime job
  |- Creates sandbox
  |- Applies limits and policy
  |- Launches pinned runtime image
  |- Captures structured result
  |- Destroys sandbox
  |
  v
Isolated Runtime Sandbox
  |- Node.js, Bun, or Deno
  |- Read-only package workspace
  |- Writable temporary directory
  |- No credentials
  |- No outbound network
  |- Strict CPU, memory, process, disk, time, and output limits
```

### 14.2 Control plane

The control plane is responsible for:

- user-facing pages;
- public APIs;
- package search;
- scan identity and deduplication;
- job state;
- authentication;
- package ownership;
- report assembly;
- notifications;
- administrative controls.

It must never execute untrusted package or probe code.

### 14.3 Preparation plane

The preparation worker is responsible for:

- fetching registry metadata and tarballs;
- verifying integrity;
- safe extraction;
- static analysis;
- dependency installation with scripts disabled;
- producing a content-addressed read-only workspace;
- generating the automatic probe plan.

Preparation has limited egress and no access to application secrets beyond a narrowly scoped job credential.

### 14.4 Execution plane

The execution plane is responsible for:

- claiming one runtime run at a time;
- retrieving the prepared workspace;
- creating an isolated sandbox;
- starting a pinned runtime image;
- enforcing policy and quotas;
- capturing authoritative harness output separately from package output;
- submitting a signed result;
- destroying all job resources.

The execution plane should be deployed separately from the web application and primary database.

### 14.5 Storage

- PostgreSQL stores product state, metadata, normalized results, users, configuration, and job state.
- S3-compatible object storage stores bounded raw logs, result artifacts, and optional reproduction bundles.
- Prepared workspaces may use short-lived content-addressed object storage or runner-local cache with strict isolation.
- Public static assets and report pages may be cached through a CDN.

### 14.6 Communication

- Browser progress uses Server-Sent Events.
- Control plane and runner communicate through a restricted job API or limited database queue role.
- Result submission is authenticated and idempotent.
- Large artifacts are transferred through short-lived signed object-storage URLs rather than the primary API process.

---

## 15. Recommended implementation stack

### 15.1 Web and control plane

- **Language:** TypeScript.
- **Framework:** Next.js using the App Router.
- **UI:** React with Tailwind CSS and a restrained accessible component system.
- **Validation:** Zod or an equivalent runtime schema validator.
- **Authentication:** Auth.js with GitHub OAuth initially; GitHub App credentials for repository automation later.
- **Database:** PostgreSQL.
- **Database access:** Drizzle ORM or typed SQL with explicit migrations.
- **Queue:** PostgreSQL-backed jobs using transactional claim semantics and a least-privilege runner role. Redis is not required for the MVP.
- **Live updates:** Server-Sent Events.
- **Object storage:** S3-compatible storage such as an S3 service, R2, or self-hosted MinIO in development.

### 15.2 Runner and sandbox

- **Runner supervisor:** Go.
- **Reason for Go:** Small static deployment, strong concurrency, predictable process supervision, and good Linux systems integration.
- **Runtime harnesses:** JavaScript or TypeScript compiled to simple JavaScript files that can execute under each target runtime.
- **Container runtime:** OCI-compatible runtime with gVisor `runsc` or an equivalent strong sandbox for public alpha.
- **Long-term isolation:** Firecracker or an equivalent microVM platform when anonymous volume, custom probes, or private packages justify the added complexity.
- **Runtime images:** Minimal pinned OCI images for each supported runtime.

### 15.3 Observability

- **Structured logging:** JSON logs with correlation IDs.
- **Tracing and metrics:** OpenTelemetry.
- **Metrics backend:** Prometheus-compatible system.
- **Dashboards:** Grafana or equivalent.
- **Error reporting:** Sentry or equivalent for control-plane application errors, with sensitive-data filtering.

### 15.4 Development and CI

- **Monorepo:** pnpm workspace or equivalent for TypeScript packages, with Go service in the same repository.
- **Task runner:** Turborepo, Make, or a small explicit task script; avoid unnecessary build orchestration.
- **Testing:** Vitest for TypeScript units, Playwright for browser flows, Go standard testing for runner code, integration tests for sandbox behavior.
- **Local environment:** Docker Compose for PostgreSQL, object storage, control plane, preparation worker, and development runner.
- **Infrastructure as code:** Terraform or OpenTofu after the first production deployment is understood.

### 15.5 Deployment model

- Web/control plane: managed container host or small Kubernetes-free container deployment.
- PostgreSQL: managed PostgreSQL where practical.
- Object storage: managed S3-compatible storage.
- Runner: dedicated Linux VM or bare-metal host with the required sandbox support.
- Preparation worker: separate container or VM with restricted registry egress.
- CDN and web protection: managed CDN, TLS termination, rate limiting, and basic bot protection.

The MVP should avoid Kubernetes unless operational evidence shows it is necessary.

---

## 16. Data model

### 16.1 Core entities

| Entity | Purpose | Key fields |
|---|---|---|
| `packages` | Stable npm package identity | name, scope, description, repository, npm URL |
| `package_versions` | Exact published artifacts | package ID, version, tarball URL, integrity, manifest, publication time |
| `runtime_images` | Immutable runtime environments | runtime, version, OCI digest, OS, architecture, lifecycle status |
| `harness_versions` | Compatibility harness releases | version, source commit, artifact digest |
| `execution_policies` | Sandbox and resource policy | version, limits, network policy, filesystem policy |
| `probe_specs` | Automatic or maintainer probes | type, digest, source reference, version range, capabilities |
| `scans` | Top-level requested matrix | package version, requester, state, created time |
| `scan_runs` | One runtime/probe execution | scan, runtime image, probe, state, timestamps, runner |
| `run_results` | Normalized evidence | status, phase, classification, summary, duration, resources |
| `run_artifacts` | Bounded raw artifacts | log key, JSON key, reproduction key, size, retention date |
| `users` | Authenticated users | GitHub identity, profile, account state |
| `repository_links` | User-to-repository authority | repository, GitHub installation, verification level |
| `package_claims` | Package ownership relationship | package, repository link, status, verification evidence |
| `monitors` | Release monitoring configuration | package claim, runtime matrix, alert rules |
| `notifications` | Delivery state | channel, destination, event, status, retry count |
| `api_tokens` | Later organization API access | owner, scope, hash, expiry, revoked time |
| `audit_events` | Sensitive configuration changes | actor, action, target, time, metadata |

### 16.2 Identity constraints

The immutable run key must include at minimum:

```text
package artifact digest
+ runtime image digest
+ harness digest
+ probe digest
+ execution policy version
+ preparation policy version
+ operating system
+ architecture
```

A change to any component creates a new run identity.

### 16.3 Data retention

- Normalized public results: retained indefinitely unless legally or operationally removed.
- Package metadata: retained and periodically reconciled.
- Raw package tarballs: deleted after preparation or held only in short-lived cache.
- Prepared workspaces: short retention, content-addressed, and automatically expired.
- Raw logs: bounded and retained for a defined period, then compacted or deleted.
- Authentication and billing data: retained only as required for the account and legal obligations.
- Deleted-account personal linkage: removed according to privacy policy.
- Security audit events: retained longer than ordinary application logs.

---

## 17. Service interfaces

### 17.1 Public web API

The initial public API should include conceptually:

- package search;
- package metadata;
- package versions;
- current report summary;
- immutable report detail;
- scan request;
- scan state;
- Server-Sent Events progress;
- result JSON download;
- badge response.

All interfaces must use versioned schemas and explicit error objects.

### 17.2 Runner job contract

A runtime job contract must include only:

- immutable job identifier;
- prepared workspace reference and digest;
- runtime image digest;
- harness and probe references;
- execution policy;
- result submission target or job token;
- expiration time.

It must not contain user OAuth tokens, registry credentials, database credentials, billing data, or unrelated package information.

### 17.3 Result contract

A run result must include:

- job and scan identifiers;
- start and end time;
- runtime identity;
- probe identity;
- exit status;
- termination reason;
- phase;
- normalized classification;
- normalized summary;
- structured harness payload;
- bounded stdout and stderr artifact references;
- resource usage when available;
- sandbox and runner version;
- result signature or authenticated submission evidence.

### 17.4 CLI contract

The open-source CLI should support:

```text
compatlab check package@version
compatlab check package@version --runtime <runtime-spec>
compatlab report --format json
compatlab reproduce <report-id-or-result-file>
```

The exact command shape may change, but hosted and local engines should share the result schema.

---

## 18. Security requirements

### 18.1 Threat model

The service must assume that a public npm package, dependency, lifecycle script, archive, package manifest, maintainer probe, and printed output may be intentionally malicious.

Threats include:

- remote code execution against the host;
- container or sandbox escape;
- credential theft;
- cloud metadata access;
- lateral movement to control-plane services;
- network exfiltration;
- denial of service through CPU, memory, disk, process, output, or queue exhaustion;
- archive traversal and decompression bombs;
- log, HTML, terminal, or JSON injection;
- forged harness results;
- supply-chain compromise of runtime images or the harness;
- cross-job data leakage;
- persistent runner modification;
- malicious repository probe updates;
- abuse of the service as a free compute or network platform.

### 18.2 Mandatory security controls

- **SEC-001 (P0):** Untrusted code MUST execute outside the control-plane trust boundary.
- **SEC-002 (P0):** Public runtime execution MUST use gVisor, a microVM, or an equivalent strong sandbox rather than ordinary containers alone.
- **SEC-003 (P0):** Runtime execution MUST have no outbound network.
- **SEC-004 (P0):** Preparation egress MUST be allowlisted and monitored.
- **SEC-005 (P0):** No production secret MUST enter a package runtime.
- **SEC-006 (P0):** Runtime root filesystem MUST be read-only.
- **SEC-007 (P0):** Writable state MUST be ephemeral, size limited, and unique per run.
- **SEC-008 (P0):** Jobs MUST run without root and without unnecessary Linux capabilities.
- **SEC-009 (P0):** Host container sockets, device nodes, and sensitive filesystems MUST not be mounted.
- **SEC-010 (P0):** CPU, memory, process, disk, time, and output quotas MUST be enforced outside package control.
- **SEC-011 (P0):** Archive extraction MUST reject traversal, unsafe links, and special files.
- **SEC-012 (P0):** Logs MUST be encoded and sanitized before browser display.
- **SEC-013 (P0):** Harness results MUST use a channel package stdout cannot impersonate.
- **SEC-014 (P0):** Runner-to-control-plane communication MUST be authenticated, authorized, and replay resistant.
- **SEC-015 (P0):** Runtime and harness artifacts MUST be pinned by digest.
- **SEC-016 (P0):** Dependency lifecycle scripts MUST remain disabled in the public MVP.
- **SEC-017 (P0):** Runner hosts MUST be patchable, replaceable, and treated as disposable.
- **SEC-018 (P0):** Security fixtures MUST test network access, host filesystem access, process explosion, memory exhaustion, output flooding, infinite loops, and archive attacks.
- **SEC-019 (P1):** Runtime image and harness builds SHOULD produce SBOMs and signed provenance.
- **SEC-020 (P1):** Administrative actions SHOULD be recorded in an append-only audit log.
- **SEC-021 (P1):** A responsible disclosure process and security contact SHOULD exist before public launch.
- **SEC-022 (P1):** Periodic external security review SHOULD occur before enabling arbitrary custom probes or private packages.

### 18.3 Security launch gate

The service must not accept anonymous public scans until automated fixtures demonstrate that package code cannot:

- access the public internet;
- access cloud metadata endpoints;
- read host files;
- read another job's files;
- access runner or control-plane credentials;
- reach the primary database;
- reach object storage without job-scoped authorization;
- leave persistent state after teardown;
- exhaust the host through the tested resource-abuse scenarios.

---

## 19. Privacy requirements

- The public MVP should avoid collecting personal data beyond ordinary service logs and optional account identity.
- Anonymous scans should not require email addresses.
- GitHub permissions must be minimized and explained.
- Public package reports are public by design.
- Raw logs may contain package-generated text and must be sanitized, bounded, and covered by retention policy.
- IP addresses used for abuse protection should have limited retention or be pseudonymized when feasible.
- Analytics should be privacy-respecting and must not expose package search behavior to unnecessary third parties.
- Private package support must not launch until encryption, secret handling, tenant isolation, deletion controls, and contractual terms are defined.
- An account holder must be able to remove monitors, repository associations, notification destinations, and other personal configuration.

---

## 20. Non-functional requirements

### 20.1 Performance

- **NFR-PERF-001:** Cached public report pages SHOULD become interactive within 2 seconds under normal conditions from the primary deployment region.
- **NFR-PERF-002:** Package search SHOULD return initial results within 1 second under normal registry conditions.
- **NFR-PERF-003:** A normal uncached public scan SHOULD begin preparation within 30 seconds when capacity is available.
- **NFR-PERF-004:** The UI MUST remain responsive during long scans and reconnect to progress after refresh.
- **NFR-PERF-005:** Raw logs MUST load on demand rather than block the summary page.

These are service targets, not guaranteed user-facing SLAs for the free MVP.

### 20.2 Reliability

- **NFR-REL-001:** Scan and run jobs MUST be idempotent.
- **NFR-REL-002:** Worker crashes MUST not produce duplicate authoritative results.
- **NFR-REL-003:** Infrastructure failures MUST be retryable according to bounded policy.
- **NFR-REL-004:** Historical immutable reports MUST not change silently.
- **NFR-REL-005:** Database migrations MUST support rollback or forward repair.
- **NFR-REL-006:** Object-storage artifacts MUST be referenced by digest and size.

### 20.3 Scalability

- **NFR-SCALE-001:** Web instances MUST scale independently from runner capacity.
- **NFR-SCALE-002:** Runtime runners MUST scale horizontally by claiming independent jobs.
- **NFR-SCALE-003:** The scheduler MUST enforce global and per-runtime concurrency.
- **NFR-SCALE-004:** Identical scans MUST be deduplicated before consuming runner capacity.
- **NFR-SCALE-005:** Package and report reads SHOULD be cacheable at the CDN and application layers.

### 20.4 Maintainability

- **NFR-MAINT-001:** Public contracts and stored result schemas MUST be versioned.
- **NFR-MAINT-002:** Runtime-specific behavior MUST be isolated behind adapters.
- **NFR-MAINT-003:** Security policy MUST be configuration-backed and reviewable.
- **NFR-MAINT-004:** The codebase MUST include architecture and threat-model documentation.
- **NFR-MAINT-005:** Generated code MUST be clearly separated from maintained source.
- **NFR-MAINT-006:** Dependencies SHOULD be minimized in privileged runner components.

### 20.5 Accessibility and usability

- **NFR-A11Y-001:** Core pages SHOULD meet WCAG 2.2 AA.
- **NFR-A11Y-002:** Status MUST not be communicated only through color.
- **NFR-A11Y-003:** Tables and matrices MUST be keyboard navigable and usable on small screens.
- **NFR-A11Y-004:** Error explanations MUST avoid unnecessary runtime jargon or define it nearby.
- **NFR-A11Y-005:** Raw logs MUST have an accessible text view.

### 20.6 Browser and device support

- The website should support current stable versions of Chrome, Firefox, Safari, and Edge.
- Core report viewing must work on mobile, but scan-detail investigation may be optimized for desktop.
- JavaScript-disabled full functionality is not required, but public report metadata and a useful fallback message should render server-side.

### 20.7 Cost efficiency

- Cached reports should be served without runner work.
- Package artifacts and workspaces should use short retention and content-addressed reuse.
- Public scan concurrency should be controlled by budget.
- Expensive features must require authentication or quotas.
- The MVP should operate on a small control plane plus one dedicated runner host before adding orchestration platforms.

---

## 21. Error taxonomy

The initial taxonomy should include at least:

### Resolution and preparation

- `PACKAGE_NOT_FOUND`
- `PACKAGE_VERSION_NOT_FOUND`
- `REGISTRY_UNAVAILABLE`
- `ARTIFACT_DOWNLOAD_FAILED`
- `ARTIFACT_INTEGRITY_MISMATCH`
- `ARCHIVE_REJECTED`
- `PACKAGE_MANIFEST_INVALID`
- `DECLARED_PLATFORM_UNSUPPORTED`
- `DEPENDENCY_INSTALL_FAILED`
- `INSTALL_SCRIPT_REQUIRED`
- `NATIVE_ADDON_UNSUPPORTED`
- `PREPARATION_LIMIT_EXCEEDED`

### Module loading and execution

- `PACKAGE_RESOLUTION_FAILED`
- `ESM_IMPORT_FAILED`
- `COMMONJS_REQUIRE_FAILED`
- `EXPORT_PATH_FAILED`
- `UNSUPPORTED_BUILTIN`
- `UNSUPPORTED_RUNTIME_API`
- `PERMISSION_REQUIRED`
- `FILESYSTEM_ACCESS_DENIED`
- `ENVIRONMENT_ACCESS_DENIED`
- `NETWORK_ACCESS_ATTEMPTED`
- `SUBPROCESS_ATTEMPTED`
- `PROBE_ASSERTION_FAILED`
- `UNEXPECTED_PROCESS_EXIT`
- `PROCESS_TIMEOUT`
- `PROCESS_OUT_OF_MEMORY`
- `PROCESS_LIMIT_EXCEEDED`
- `OUTPUT_LIMIT_EXCEEDED`
- `TEMPORARY_DISK_LIMIT_EXCEEDED`
- `UNCLASSIFIED_RUNTIME_FAILURE`

### Infrastructure

- `SANDBOX_START_FAILED`
- `RUNNER_UNAVAILABLE`
- `RUNTIME_IMAGE_UNAVAILABLE`
- `HARNESS_PROTOCOL_ERROR`
- `RESULT_UPLOAD_FAILED`
- `CONTROL_PLANE_ERROR`
- `JOB_CANCELLED`
- `SERVICE_POLICY_REJECTED`

Each classification must have:

- a human explanation;
- phase mapping;
- package-fault versus infrastructure-fault category;
- retryability;
- safe public message;
- optional documentation link.

---

## 22. Observability and operations

### 22.1 Correlation

Every request, scan, run, runner allocation, artifact, and notification must have correlated identifiers.

### 22.2 Metrics

The service should measure:

- scan requests and deduplicated scans;
- cache hit rate;
- queue depth by runtime;
- preparation duration;
- runtime duration;
- completion, package failure, inconclusive, and infrastructure failure rates;
- sandbox startup failure rate;
- timeout and resource-limit rate;
- report page views;
- package/version coverage;
- runner utilization;
- cost per completed uncached scan;
- notification success rate;
- abuse throttling events.

### 22.3 Logs

- Control-plane logs must exclude OAuth tokens, cookies, package credentials, and full unbounded package output.
- Runner logs must be structured and distinguish supervisor events from package output.
- Sensitive values must be redacted before error reporting.
- Log retention must be documented.

### 22.4 Alerts

Operations alerts should cover:

- queue age beyond threshold;
- no healthy runner for an active runtime;
- elevated infrastructure-error rate;
- sandbox startup failures;
- cleanup failures;
- object-storage failures;
- database saturation;
- unusual network-denial volume;
- repeated package or account abuse;
- runtime image integrity mismatch.

### 22.5 Backups and recovery

- PostgreSQL must have automated backups and tested restoration.
- Object-storage configuration and critical report artifacts must have a recovery strategy.
- Runtime images and harness builds must be reproducible from source.
- A documented procedure must rebuild runners from a clean host.

---

## 23. Testing strategy

### 23.1 Unit tests

Unit tests must cover:

- npm package/version parsing;
- exact-version resolution;
- artifact identity;
- package manifest parsing;
- export-map enumeration;
- native-addon and install-script detection;
- scan-key generation;
- state transitions;
- result normalization;
- aggregate compatibility rules;
- error sanitization;
- rate-limit decisions;
- permission validation.

### 23.2 Integration tests

Integration tests must cover:

- public registry metadata retrieval through a controlled fixture or replay;
- tarball integrity verification;
- safe extraction;
- dependency preparation with scripts disabled;
- execution under each runtime image;
- result ingestion;
- cached report reuse;
- concurrent scan deduplication;
- worker crash and retry behavior;
- object-storage upload and retention;
- SSE reconnect.

### 23.3 Compatibility fixtures

The repository must include packages representing:

- CommonJS only;
- ESM only;
- dual ESM/CommonJS;
- conditional exports;
- multiple explicit subpath exports;
- invalid manifest;
- missing dependency;
- lifecycle script requirement;
- native addon;
- WebAssembly;
- environment access;
- filesystem access;
- network access;
- subprocess access;
- unsupported Node API;
- runtime-specific conditional behavior;
- import-time exception;
- assertion failure.

### 23.4 Hostile fixtures

Security fixtures must include:

- infinite loop;
- memory exhaustion attempt;
- process explosion attempt;
- output flood;
- temporary disk flood;
- network exfiltration attempt;
- cloud metadata access attempt;
- host filesystem traversal attempt;
- unsafe archive paths;
- unsafe symlink archive;
- terminal escape output;
- fake harness JSON output;
- delayed child process after parent exit;
- cross-job observation attempt.

### 23.5 End-to-end tests

Browser tests must cover:

- package search;
- exact-version selection;
- cached report;
- new scan progress;
- result exploration;
- JSON download;
- responsive layout;
- sign-in and repository linking when implemented;
- monitoring configuration when implemented.

### 23.6 Load tests

Before public launch, load tests must verify:

- duplicate requests collapse into one scan;
- queue limits hold;
- web reads remain responsive while runners are saturated;
- global concurrency protects the runner host;
- result ingestion remains idempotent;
- one abusive package does not block unrelated reports indefinitely.

---

## 24. Product plans and monetization

### 24.1 Free public product

The free product should include:

- public package search;
- cached report viewing;
- limited on-demand public scans;
- current default runtime matrix;
- public JSON reports;
- shareable links;
- community documentation;
- local open-source CLI.

### 24.2 Maintainer plan

A paid or sponsor-supported maintainer plan may include:

- automatic scan on every release;
- regression alerts;
- longer history and comparisons;
- custom maintainer probes;
- higher scan priority;
- GitHub checks;
- custom badge policy;
- more monitored packages.

### 24.3 Team plan

A later team plan may include:

- private packages;
- organization workspaces;
- dependency-set scanning;
- policy enforcement;
- API tokens;
- audit logs;
- configurable retention;
- priority runners;
- support.

### 24.4 Monetization principles

- One-off public scans should remain free within abuse limits.
- Payment should be attached to recurring operational value, not access to basic evidence.
- Private package support must be priced to cover stronger isolation, secret handling, and retention obligations.
- The product must not sell a misleading universal compatibility certificate.

---

## 25. Product metrics

### 25.1 North-star behavior

The primary product-use metric should be:

> Number of distinct package versions with a viewed, completed, current compatibility report during the measurement period.

This captures both useful scans and actual report consumption.

### 25.2 Activation metrics

- Search-to-report completion rate.
- Percentage of uncached scans that complete with a valid package conclusion.
- Percentage of visitors who open a failure detail.
- Percentage of report viewers who share, download JSON, or copy a reproduction command.
- Time from homepage to useful evidence.

### 25.3 Retention and SaaS metrics

- Maintainers with monitoring enabled.
- Monitored packages with at least two scanned releases.
- Alert-to-report engagement.
- Badge installations.
- Maintainer-defined probe adoption.
- Weekly returning authenticated maintainers.

### 25.4 Quality metrics

- Infrastructure-error rate.
- Inconclusive rate by cause.
- False or disputed classification reports.
- Reproduction success rate.
- Security fixture pass rate.
- Scan cache hit rate.
- Cost per completed uncached scan.

### 25.5 Initial validation thresholds

Before investing in private packages or billing, target evidence such as:

- useful scans across at least 100 varied public packages;
- at least 10 maintainers confirming that reports are understandable;
- at least 5 maintainers requesting automatic release monitoring, badges, or probes;
- repeated organic report views or shares;
- meaningful runtime differences rather than identical results for nearly every package.

These are validation goals, not hard product guarantees.

---

## 26. Delivery roadmap

### Milestone A: Local engine

Deliverables:

- CLI accepts exact public package versions.
- Package resolution and integrity verification.
- Safe extraction.
- Static analyzer.
- Dependency preparation with scripts disabled.
- Node.js, Bun, and Deno runtime adapters.
- ESM, CommonJS, and export-subpath probes.
- Normalized JSON output.
- Cleanup.

Exit criteria:

- At least 50 ordinary package fixtures and real packages scanned.
- Results reveal useful runtime differences.
- No website dependency.

### Milestone B: Security-hardened runner

Deliverables:

- Go runner supervisor.
- Strong sandbox integration.
- Network isolation.
- resource quotas;
- authenticated result channel;
- hostile fixture suite;
- runner health and metrics.

Exit criteria:

- All mandatory security launch-gate fixtures pass.
- Runner crashes and cleanup are recoverable.
- Control plane is not reachable from package jobs.

### Milestone C: Public website MVP

Deliverables:

- package search;
- exact-version page;
- scan request and deduplication;
- live progress;
- runtime matrix;
- result details;
- immutable metadata;
- JSON download;
- rate limiting;
- public documentation.

Exit criteria:

- End-to-end scans complete from browser.
- Cached reports are fast and stable.
- Infrastructure errors are separated from package results.
- Accessibility and responsive-layout review pass.

### Milestone D: Maintainer workflow

Deliverables:

- GitHub sign-in;
- repository links;
- package claim levels;
- release monitoring;
- comparisons;
- email alerts;
- badges;
- maintainer probes.

Exit criteria:

- At least several real maintainers monitor packages.
- A probe change creates new immutable results.
- Alerts are low-noise and link to comparable evidence.

### Milestone E: Team SaaS

Deliverables are conditional on validated demand:

- private registry access;
- organization roles;
- policies;
- API tokens;
- billing;
- tenant-specific retention;
- stronger microVM isolation if not already deployed.

---

## 27. MVP acceptance criteria

The public MVP is complete only when all of the following are true:

1. A visitor can search for a public scoped or unscoped npm package without an account.
2. The visitor can select an exact version.
3. The service resolves and verifies the exact published artifact.
4. The service safely extracts and statically analyzes the package.
5. Dependency preparation runs with lifecycle scripts disabled.
6. The same controlled workspace is tested under the configured Node.js, Bun, and Deno matrix.
7. Applicable ESM, CommonJS, and explicit export-subpath probes execute.
8. Native addons and install-script-dependent packages are labeled unsupported or inconclusive rather than incorrectly failed.
9. Runtime code executes in a strong sandbox with no outbound network or production credentials.
10. CPU, memory, time, process, output, and disk limits are externally enforced.
11. Hostile fixtures cannot reach the host, metadata endpoints, control plane, database, other jobs, or public internet.
12. Package output cannot forge the authoritative harness result.
13. Infrastructure failures are never displayed as package incompatibility.
14. Every report displays the exact artifact, runtime image, harness, probe, policy, OS, architecture, and scan time.
15. Reports distinguish static inspection, smoke testing, and meaningful verified probes.
16. A successful import is not presented as a universal guarantee.
17. Reports expose normalized and bounded raw failure evidence.
18. Identical scan requests are deduplicated and cached.
19. Live progress survives browser refresh or reconnect.
20. A report has a stable public URL and downloadable versioned JSON.
21. The core engine and schema are documented sufficiently for local reproduction.
22. Core pages pass accessibility, responsive, and browser smoke tests.
23. An operations view exposes queue, runner, and infrastructure health.
24. Backup and runner-rebuild procedures are documented and tested.
25. The service has a published methodology, limitation statement, privacy policy, terms, security contact, and abuse-reporting path.

---

## 28. Risks and rejection conditions

### 28.1 Major product risks

- Simple import tests may be too shallow to be useful.
- Most pure JavaScript packages may already behave identically across runtimes.
- Package maintainers may prefer their own CI and not adopt hosted monitoring.
- Untrusted execution may consume disproportionate security and operations effort.
- Runtime behavior may change too quickly for reports to remain current.
- Native addons and install scripts may account for many high-value packages but remain outside MVP scope.
- Public reports may be misread as guarantees despite qualification.
- Registry rate limits or outages may affect preparation.
- A competing runtime or registry may add equivalent official compatibility reporting.

### 28.2 Mitigations

- Use clear evidence levels and narrow claims.
- Add maintainer probes to improve meaningfulness.
- Publish exact immutable environment metadata.
- Keep the open-source CLI useful independently of the hosted service.
- Deduplicate and cache aggressively.
- Treat security as a launch gate, not a later enhancement.
- Start with public packages and no arbitrary user code.
- Build a regression-monitoring workflow rather than only a one-time checker.

### 28.3 Conditions to pause or reject the project

Pause or substantially change the project when:

- a 100-package prototype finds almost no meaningful runtime differences;
- normalized reports do not help developers understand failures;
- safe execution cannot be demonstrated with hostile fixtures;
- runner operating cost is too high for the expected public usage;
- maintainers show no interest in release monitoring, badges, or verified probes;
- the service cannot prevent users from interpreting results as unsupported guarantees;
- a mature official service covers the same workflow with better data and direct runtime integration.

---

## 29. Open product and engineering decisions

The following decisions should be resolved through prototypes rather than assumptions:

1. Which two Node.js release lines form the initial default matrix at implementation time?
2. Should dependency preparation use npm only, or should an alternative deterministic installer be evaluated?
3. Can one npm-created dependency tree be used fairly across every initial runtime, or are runtime-specific preparation modes required?
4. Which explicit export-map patterns can be safely enumerated?
5. How should optional dependencies affect aggregate results?
6. Which denied capability attempts can be detected reliably without invasive tracing?
7. Should gVisor be sufficient for public alpha, or is Firecracker required before any anonymous execution?
8. What is the maximum acceptable package size and dependency-tree size?
9. Which result fields are permanent public API commitments?
10. How will package ownership be represented without overstating npm ownership?
11. Should maintainer probes live in the package repository, a dedicated compatibility repository, or both?
12. How will probes request fixtures without enabling arbitrary large downloads?
13. What is the initial raw-log retention period?
14. What scan quota keeps the free public service useful but abuse resistant?
15. Which notifications are valuable enough to avoid alert fatigue?
16. What constitutes a compatible comparison when dependency lock output changes?
17. Should reports include inferred remediation suggestions without AI?
18. At what usage level should the runner move from gVisor to microVMs?

---

## 30. Launch checklist

### Product

- [ ] Core package search and report flows are complete.
- [ ] Compatibility semantics and evidence levels are publicly documented.
- [ ] At least 100 diverse packages have been tested.
- [ ] Common failure categories have understandable explanations.
- [ ] No screen implies universal compatibility.
- [ ] Public examples include pass, partial, failed, inconclusive, unsupported, and infrastructure states.

### Security

- [ ] Threat model reviewed.
- [ ] Strong sandbox enabled in production.
- [ ] No outbound execution network.
- [ ] No secrets in runtime jobs.
- [ ] Archive-security tests pass.
- [ ] Hostile resource fixtures pass.
- [ ] Cross-job isolation tests pass.
- [ ] Runner rebuild and patch process documented.
- [ ] Responsible disclosure channel published.
- [ ] Administrative credentials protected with strong authentication.

### Reliability

- [ ] Scan deduplication verified.
- [ ] Idempotent result submission verified.
- [ ] Worker-crash recovery tested.
- [ ] Cleanup failures alert operators.
- [ ] Database backup restoration tested.
- [ ] Runtime-image rollback procedure tested.
- [ ] Status page or incident communication path exists.

### Legal and privacy

- [ ] Terms of service published.
- [ ] Privacy policy published.
- [ ] Acceptable-use policy published.
- [ ] Data-retention policy documented.
- [ ] npm and GitHub integration terms reviewed.
- [ ] Public-report removal and abuse-contact process defined.

### Operations

- [ ] Queue, runner, and error dashboards exist.
- [ ] Capacity and global concurrency limits configured.
- [ ] Cost alerts configured.
- [ ] Registry failure behavior tested.
- [ ] Object-storage retention configured.
- [ ] On-call or incident ownership defined, even if it is the solo founder.

### Open source

- [ ] Repository license selected.
- [ ] Security policy added.
- [ ] Contribution guide added.
- [ ] Local reproduction documented.
- [ ] Result schema documented.
- [ ] Runtime image sources published.
- [ ] Architecture and threat-model documents included.

---

## 31. Requirements traceability summary

| Goal | Primary requirements | Verification |
|---|---|---|
| Useful without signup | FR-DISC, FR-SCAN, FR-REPORT | Anonymous end-to-end browser tests |
| Exact and reproducible evidence | FR-PKG, FR-RUNTIME, FR-PROBE, FR-RESULT | Immutable identity and reproduction tests |
| Safe untrusted execution | FR-EXEC, SEC requirements | Hostile fixture suite and security review |
| Understandable failures | FR-RESULT, FR-REPORT, error taxonomy | Developer usability sessions and fixture reports |
| Recurring maintainer value | FR-AUTH, FR-VERIFY, FR-MON | Real release-monitoring pilot |
| Open-source portfolio value | CLI, shared schema, published harnesses | Local reproduction from public repository |
| SaaS path | Monitoring, teams, private packages later | Willingness-to-pay and retention validation |

---

## Appendix A. Initial scan state machine

```text
REQUESTED
  -> RESOLVING
  -> PREPARING
  -> QUEUED
  -> RUNNING
  -> AGGREGATING
  -> COMPLETED

Terminal alternatives:
  -> INCONCLUSIVE
  -> FAILED_INFRASTRUCTURE
  -> REJECTED
  -> CANCELLED
```

A completed scan may contain pass, partial, failed, unsupported, not-applicable, and inconclusive individual runs. `FAILED_INFRASTRUCTURE` means no authoritative package conclusion was produced.

---

## Appendix B. Example result structure

```json
{
  "schemaVersion": 1,
  "package": {
    "name": "example-package",
    "version": "4.2.1",
    "artifactIntegrity": "sha512-..."
  },
  "environment": {
    "runtime": "bun",
    "runtimeVersion": "pinned-version",
    "runtimeImageDigest": "sha256:...",
    "os": "linux",
    "architecture": "x86_64",
    "harnessDigest": "sha256:...",
    "executionPolicy": "public-v1"
  },
  "evidenceLevel": "smoke-tested",
  "status": "partial",
  "probes": [
    {
      "name": "root-esm-import",
      "type": "automatic",
      "status": "pass",
      "durationMs": 84
    },
    {
      "name": "root-commonjs-require",
      "type": "automatic",
      "status": "fail",
      "phase": "module-evaluation",
      "classification": "UNSUPPORTED_RUNTIME_API",
      "summary": "The package called an API not available in this runtime image."
    }
  ],
  "limitations": [
    "The package's exported functions were not called by the automatic probe.",
    "The result applies only to the named runtime image and execution policy."
  ]
}
```

---

## Appendix C. Example maintainer probe manifest

```json
{
  "schemaVersion": 1,
  "package": "example-parser",
  "versionRange": "^4.0.0",
  "probes": [
    {
      "name": "parses-basic-configuration",
      "entry": "./compatlab/basic.mjs",
      "timeoutMs": 5000,
      "permissions": {
        "network": false,
        "subprocess": false,
        "environment": [],
        "filesystem": "temporary-only"
      }
    }
  ]
}
```

The exact schema may change before Phase 2. The important requirements are immutability, explicit permissions, bounded execution, and a visible distinction from automatic probes.

---

## Appendix D. Suggested repository structure

```text
compatlab/
  apps/
    web/
  services/
    preparation-worker/
    runnerd/
  packages/
    contracts/
    database/
    npm-registry-client/
    static-analyzer/
    probe-planner/
    result-normalizer/
    report-ui/
  harnesses/
    common/
    node/
    bun/
    deno/
  runtime-images/
    node-a/
    node-b/
    bun-stable/
    deno-stable/
  fixtures/
    compatibility/
    hostile/
  infra/
    development/
    production/
  docs/
    architecture.md
    threat-model.md
    compatibility-semantics.md
    result-schema.md
```

---

## Appendix E. Reference materials for implementation

The implementation team should review the current official documentation at build time because runtime and registry behavior changes:

- npm registry API and package metadata documentation
- npm lifecycle-script and configuration documentation
- Node.js package, conditional exports, and permission-model documentation
- Bun Node.js compatibility documentation
- Deno npm compatibility and security documentation
- gVisor architecture and `runsc` documentation
- Firecracker microVM and jailer documentation
- GitHub OAuth and GitHub App permission documentation

The product must pin exact versions and must not assume that current documentation remains unchanged.
