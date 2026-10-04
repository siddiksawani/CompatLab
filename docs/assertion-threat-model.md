# Maintainer assertion threat review

Reviewed October 4, 2026, before implementing delivery slice 14. This extends the existing sandbox model; it is not an external security audit.

## Boundaries and decisions

Repository-authorized users select an immutable GitHub commit and a manifest. The web process fetches bounded Git commit/tree/blob data with the current App user token. It never imports source, extracts repository archives, runs a build or forwards credentials to a worker. Source and fixtures remain hostile even when their author controls the repository.

Registration and scan admission recheck the authority revision in their database transaction. Link revocation and account deletion disable retained revisions. Worker claims, renewals and submissions check revision policy. Workers must advertise `assertion_v1`; old workers cannot acquire a preparation that requires it. Existing capacity, deadlines, cleanup, snapshot locality and account quotas apply.

Only regular Git blobs are accepted. Reject moving refs, traversal, symlinks, submodules, truncated trees, duplicate/prefix paths and inconsistent hashes. Limit registration to ten retained revisions per account and 1,000 globally. Each bundle has at most sixteen files and 2 MiB decoded data, with a 64 KiB entry, 512 KiB individual fixtures and a 16 KiB manifest. HTTP calls and elapsed time are bounded.

The approved capability profile has no network, a read-only package/fixture workspace, bounded temporary/output storage and bounded processes. Requests cannot supply environments, mounts, commands or weaker limits. A source, fixture, capability, commit or harness change creates a new digest. The first profile permits one named assertion per observation and one fresh process per runtime.

Assertions invoke a default async function. Normal completion without throwing is an observed pass. Captured assertion errors, supervisor stops and incomplete completion are separate results. Stdout is never a verdict. Source and packages share a process and can tamper with observations; `probe_verified` describes the named assertion actually observed, not adversarial attestation or a package safety certificate. Automatic loading cells retain their own evidence and outcome.

## CI artifacts

Pre-publication artifacts enter through the local Linux amd64/runsc CLI, with no hosted upload endpoint. Read a bounded regular archive through a no-follow descriptor, copy and hash it into private staging, and mount only that copy read-only. Extraction and installation occur inside preparation isolation with scripts disabled. Only the selected root may use the fixed local tarball source; transitive dependencies retain public registry and integrity rules. Reject packages marked private.

A distinct `ci_artifact` identity records archive hashes and caller-supplied workflow provenance. It is neither a registry publication nor service-verified provenance. Private packages and tenant credentials remain outside this design. The original archive and provenance can be checked again as a new observation; registry reproduction cannot reinterpret a CI report.

## Required evidence

Tests must cover authority and revocation races; source/path/hash/fixture bounds; immutable revision and scan lineage; worker capability exclusion; input/result mismatches; and separate assertion classification and comparisons. Real runsc qualification must cover assertion success, failure, timeout, early exit, fake stdout, read-only fixtures and network denial, plus CI archive identity and disabled install scripts. Existing containment, database, browser, recovery and corpus gates remain required.

Public deployment requires configuring and checking a real GitHub App. No test fixture substitutes for that integration or for external security review before private/team execution.
