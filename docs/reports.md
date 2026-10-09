# Classified reports and read API

`classifier_v2` turns accepted observations into immutable reports. It does not execute packages, parse stdout for verdicts, or infer missing APIs from arbitrary error messages. Structured captured error codes identify known resolution, export, built-in and native-loading failures; otherwise the failed ESM/CommonJS operation remains the classification. Codes and harness files can be forged by code in the observed process, so they are evidence rather than adversarial attestations.

An `optional_peer_missing` result requires three retained inputs: an optional-peer declaration in the installed root manifest, a preparation inventory showing that peer absent, and a recognized missing-dependency error naming the same package. Resolution codes and narrowly matched resolver messages take precedence; a bounded wrapped `missing "name" dependency.` error is also supported. An empty error, an unrelated failure, missing inventory, a non-optional peer, or a dependency present anywhere in the snapshot does not qualify. This conservative classifier handles root-package peer declarations; transitive-only declarations and unrecognized error formats remain generic failures. It does not infer one runtime's cause from another runtime's result.

Matching entries have compatibility outcome `inconclusive`, origin `prerequisite`, and an `optionalPeer` name/range. Coverage `failed` remains the number of actual failed loading observations. The additive `prerequisiteLimited` field counts the subset explained by missing optional peers; it is not added to `failed`. Display counts separate that subset from other failures. Completed observations can have complete coverage while compatibility remains inconclusive. Missing messages receive an explicit unknown-cause explanation; raw evidence is unchanged.

Optional peers are never added to the baseline snapshot. Testing an added peer requires a separate future profile and new preparation identity. Reclassify retained scans with the audited `compatlab admin reclassify SCAN_ID --reason REASON` operation after deploying this revision. The CLI records the operator identity automatically. Existing report URLs retain their original payload and link to the replacement. No package code runs during reclassification.

## Outcomes and coverage

Each approved runtime has separate root ESM/CommonJS and subpath ESM/CommonJS cells. A complete applicable group passes only when every planned entry passed. Mixed observed successes and failures are partial. Interrupted or omitted executable coverage is inconclusive, even when roots passed. Inapplicable groups do not count toward coverage. Missing planning evidence uses unknown counts, not invented zero-work success.

Supervisor time, memory and output limits remain policy-limited observations. Service/harness failures remain infrastructure errors. Preparation prerequisites appear separately: required compilation is unsupported; required disabled scripts and declared platform restrictions are inconclusive. Native indicators alone do not suppress execution. A report records loading evidence as `smoke_tested`; named behavioral assertions are not implemented in this slice.

The control reconciler reserves aggregation work for successful and terminal scans. Aggregation uses a short catalog transaction, one report per scan/classifier revision, and a bounded retry budget. One faulty aggregation does not stop other scans. Exhausted report-generation attempts are tracked separately from execution failures, so operator recovery can still publish successful retained observations. Evidence completion is stamped when execution leaves its active lifecycle; publication and reclassification have a separate timestamp. Legacy evidence without a retained completion time has `observedAt: null`. Reclassification appends a revision, preserves raw evidence and observation time, links the previous report, and inherits invalidation. It never retries package execution. Operators invoke it through the audited SSH CLI.

## Reads and downloads

The `createReportApi` Request/Response handler provides these public read routes through the website. The private worker server does not expose them.

| Route | Content |
|---|---|
| `GET /api/v1/scans/:id` | Durable lifecycle, counts, revision and final report ID |
| `GET /api/v1/reports/:id` | Immutable report plus current policy, invalidation, replacement and snapshot availability |
| `GET /api/v1/reports/:id/json` | The same versioned envelope as an attachment |
| `GET /api/v1/reports/:id/logs?runId=…` | Separately loaded sanitized logs, truncation and expiry |
| `GET /api/v1/reports/:id/evidence?runId=…` | Sanitized retained group evidence, excluding duplicated logs |
| `GET /api/v1/reports/:id/cell?runId=…` | One classified cell with per-entry details, loaded on demand |
| `GET /api/v1/reports/:id/reproduction` | Exact artifact, snapshot, runtime and policy inputs |
| `GET /api/v1/reports/:id/lock` | Byte-exact lock with its SHA-256 digest header |

GET and HEAD validate UUIDs and enforce report/run ownership. Four reads may be in flight per handler; excess work receives 503 with Retry-After. Progress responses support revision ETags. Report ETags include live quarantine, invalidation and availability metadata. Clients revalidate with `Cache-Control: no-cache`; a cached payload cannot silently retain current status after quarantine.

Raw stored evidence and classifications remain separate. Display sanitization removes terminal escape sequences, control characters and bidi overrides; messages/logs normalize temporary locations and random identifiers. Exact artifact names, specifiers and identities remain intact. Entry `specifier` fields and evidence `entries` preserve machine-readable identity; render `displaySpecifier` or `displayEntries`, which escape control and bidi characters without collapsing distinct paths. Omission labels also retain their exact values and require display escaping. HTML-looking strings remain text and must be escaped by the renderer. One log read has a shared 256 KiB UTF-8 display budget and reports truncation. Thirty-day log expiry is enforced during reads even before retention deletes the bytes. Immutable normalized reports are capped at 20 MiB and never embed full logs.

## Reproduction

Download the reproduction descriptor and lock using the routes above, then on a qualified Linux amd64/runsc execution host:

```sh
sudo "$(command -v node)" apps/cli/dist/bin.js reproduce ./reproduction.json \
  --rebuild --lockfile ./package-lock.json --json
```

The CLI validates the descriptor and lock digest, uses the retained exact artifact and pinned runtime images, disables scripts, and records a new snapshot generation. Runtime images must already be available and approved locally. A rebuild may differ from the original installed bytes; it is explicitly labeled `rebuilt_from_lock`. Without `--rebuild`, reproduction requires the actual retained sealed snapshot in the selected local state directory. Server `snapshotAvailable` is its last verified inventory state, not a promise that the client has those bytes. The CLI accepts downloaded files; automatic fetching of arbitrary report URLs is not supported.

## Validation

Unit tests cover taxonomy, coverage, interruption, malicious error codes and display bounds. PostgreSQL tests cover concurrent aggregation, terminal reports, immutable diagnostics, reclassification, variable matrices, invalidation/ETags, ownership, expiry and downloads. The Linux orchestration gate verifies stored classification and downloads after a real worker crash/restart; the engine gate executes downloaded-format reproduction inputs with an explicit lock under runsc.
