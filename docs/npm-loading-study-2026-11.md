# How published npm packages load on Node.js, Bun, and Deno

This is the November 2026 study protocol. The package list is frozen before
execution. The pilot checks whether the measurements and exports are usable for
a data post.

## Package selection

The [frozen cohort CSV](studies/npm-loading-2026-11/cohort.csv) records the
snapshot taken November 13, 2026 at 15:24 UTC. It starts with the first 250 names
from the community-maintained [npm-high-impact downloads list][seed]. Rerank
that pool by [npm download counts][downloads] for
November 2–8, 2026 UTC, inclusive, breaking ties by package name. Download counts
include CI and transitive installs. They rank candidates in this pool and do not
measure individual users or establish a registry-wide top 100.

Take the first 100 eligible names in that order. Pin the exact stable version
pointed to by npm's `latest` tag at the snapshot and the published artifact
integrity. Exclude declaration-only `@types/*`, deprecated latest versions,
unavailable manifests, prerelease latest tags, artifacts without usable
integrity, and packages that declare a CLI but explicitly expose no root module.
A package with both an importable entry and a CLI is eligible. Keep the download
order and record the excluded rows and reasons. Any eligibility limitation
discovered after the freeze stays visible in the results.

The CSV preserves source rank, recalculated rank, and download count for all
250 candidates. The first 102 ranked rows produced 100 eligible packages and
two `@types/*` exclusions. Rows after the cutoff were not screened for inclusion.

The first six eligible rows are the operational pilot. Use the ordinary
audited, idle-only coverage queue while it protects public scans. Check the
active worker and matrix before each batch. Advance in bounded batches after
reviewing pilot evidence, provenance, failures, and foreground impact. Keep
later batches on the same execution profile. A change in profile or an artifact
integrity mismatch is a separate observation and must not silently fill a row.

## Measurements

| Tier | Observation |
| --- | --- |
| Shared npm preparation | Did npm prepare a sealed dependency tree under the pinned profile with lifecycle scripts disabled? This is one install observation per artifact, shared by all runtimes. |
| Module loading | Did the root `import` or CommonJS `require` load and evaluate? Count each mode separately. Record explicitly tested subpaths, omitted paths, and incomplete coverage separately. Deno uses `createRequire()` for its CommonJS check. |
| Behavioral smoke test | Outside the study. The automatic harness loads entries without invoking their exports. CompatLab's separate named assertion support can test specific behavior when an offline probe exists. |
| Upstream test suite | Outside the study. The published tarball may not contain the suite or its fixtures and this pipeline does not run it. |

Use the deployed Linux amd64/glibc matrix with Node.js 24.21.0 and 26.10.0,
Bun 1.4.2, and Deno 2.9.7. Deno uses `-A` in the same network-disabled gVisor
boundary as the other runtimes. For each row retain the observed time, actual
image IDs and flags, package integrity, lock digest and snapshot generation,
preparation profile, harness, policy, classifier revision, and report ID. Store
the report JSON beside a flat CSV of aggregate inputs. Never use packages'
printed output as verdicts.

The candidate headline is the number out of the frozen 100 whose root
`import` passed on **all four** pinned profiles. Count a package toward that
number only with four observed passes and a matching preparation. Show, next
to that count, the number of eligible observations still missing, inapplicable
paths, preparation limits, and confirmed non-passes. Also publish the
per-runtime and per-mode results and matched differences on the same tree.
Keep any subpath omissions separate from the root result. Do not extrapolate a
percentage to the registry or infer a runtime defect from a package outcome.

## Failure review and publication

Review every cross-runtime root discrepancy and all pilot non-passes. Inspect
the recorded phase, entry and condition, normalized failure, and matching
report. Tag prerequisite failures such as missing peers, native or lifecycle
requirements, module resolution or interop, environmental limits, and
infrastructure separately. Keep unknowns explicit. Before a result is featured,
reproduce the exact path and mode in a fresh qualified sandbox using the
retained snapshot when available, or document a lock-based rebuild as a new
observation. If there are at least 20 distinct informative non-passes across
the cohort, review and replay at least 20. If there are fewer, review the entire
set. Record which results were confirmed, changed, or remain unresolved.

Publish the post with the denominator, a few verified examples, matching
report links, and the CSV/JSON. Link any already confirmed upstream reports.
Separate functional outcomes from load results in both the title and the
examples. The publication and any community sharing follow the applicable
submission rules. Show HN is for an interactive project people can try.

## After the post

Add an opt-in Shields endpoint for exact package versions with a snippet on
pages that have eligible evidence. Link the badge to the dated observation it
describes, label the loading mode and handle missing, partial, or superseded
evidence explicitly. Check scoped packages and cache behavior.

Build a GitHub Action only after maintainers ask for it. Start from the
existing pre-publication archive CLI and qualify its runner before proposing a
workflow. The intended addition is a readable job summary and minimal setup.
Measure independent questions, citations and badge use after launch.

[seed]: https://github.com/wooorm/npm-high-impact/blob/9e29478332833af97b0e96801a5187cfd3c28382/lib/top-download.js
[downloads]: https://github.com/npm/registry/blob/main/docs/download-counts.md
