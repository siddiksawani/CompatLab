# Named assertions and CI artifacts

Named assertions add an explicit behavioral observation to an existing package report. Automatic root and subpath loading results keep their own outcome and `smoke_tested` evidence. A completed named assertion records `probe_verified` with a separate pass or fail; interrupted or invalid completion cannot earn that label. A failing assertion can reflect a probe error as well as package behavior.

## Register and run a probe

Sign in, link the package's public GitHub repository and open **Named assertions** on `/account`. Commit a manifest, an `.mjs` entry and any offline fixtures. Register the full 40-character commit SHA and the manifest path from the repository root. Moving branches and tags are rejected. The package's published repository metadata must match the authorized repository, and at least one published version must match the range.

Example `manifest.json`:

```json
{
  "schemaVersion": 1,
  "name": "number-recognition",
  "packageName": "is-number",
  "packageRange": "^7.0.0",
  "entry": "probe.mjs",
  "timeoutMs": 10000,
  "capabilities": {
    "network": "none",
    "filesystem": "read_only_workspace_and_bounded_temporary_output",
    "processes": "bounded"
  },
  "fixtures": ["examples.json"],
  "expectedBehavior": "Recognizes the recorded numeric examples."
}
```

Example `probe.mjs`, with `examples.json` containing `[0,42,-1]`:

```js
import { readFileSync } from 'node:fs';
import isNumber from 'is-number';

export default async function () {
  const examples = JSON.parse(readFileSync(new URL('./examples.json', import.meta.url), 'utf8'));
  if (!examples.every(isNumber)) throw new Error('A numeric example was rejected.');
}
```

The default function may be synchronous or async. Normal completion without throwing records an observed pass; its return value is ignored. Bare imports use the prepared package's sealed `node_modules`; assertion paths cannot introduce a shadowing `node_modules` directory. Only the entry and declared fixture files are copied. No repository build, package installation or code execution occurs in the web process.

Supply a terminal previous scan ID beside the registered assertion to request a controlled rescan. The exact package version must match the manifest, and live repository authority is required again. An observation accepts one assertion revision; it runs once per runtime in a fresh process on the same actual dependency snapshot as that observation's automatic groups. Existing cooldowns, account quotas and the fifteen-minute scan deadline apply. Repeating the same parent/revision request reuses its child; different inputs return a conflict. Use the child's scan ID for another observation.

The initial monitoring scheduler selects automatic loading scans. Named assertions are explicitly selected through controlled rescans. Their immutable reports can be compared publicly; behavioral regression comparisons require the same assertion digest. Changing the assertion is disclosed as an input change and does not by itself establish a regression.

## Source, authority and execution limits

The server follows only GitHub commit/tree/blob API paths within the authorized repository. It rejects symlinks, submodules, traversal, truncated trees, inconsistent Git/SHA-256 hashes and ambiguous paths. A manifest is at most 16 KiB, the entry 64 KiB, each fixture 512 KiB, and all sixteen files together 2 MiB. Paths have at most eight segments and 256 characters. The fetch has a sixty-second deadline and at most 64 Git object requests, after the separate authority check.

Each account may retain ten revisions, including revoked ones. The initial installation cap is 1,000 retained revisions; raising it requires a storage/capacity review and an explicit policy change. Source, fixtures, capabilities, commit identity and harness participate in the digest. Re-registering identical active inputs is idempotent. Revocation is permanent for that registration; a new commit creates a new identity.

Only the displayed offline capability profile is accepted. The runtime has no network, a read-only package/source mount, bounded temporary/output storage, bounded processes, fixed environment and the same CPU/memory restrictions as automatic probes. A custom timeout can only reduce the existing thirty-second root limit. Package and probe code share a process and can tamper with observations; this is not adversarial attestation. Stdout is retained text, never a verdict.

Revoking a probe, revoking/removing its repository link or deleting the account stops future claims and lease renewals. Revoked revisions remain as historical public evidence, with account ownership removed on deletion. Operators can block a digest using the existing `probe` block scope or block `assertion_v1` using the `harness` scope. Reports retain their original observations and show policy changes separately.

Reproduction downloads include the exact bundle when an assertion was selected. `compatlab reproduce` validates its files, runs it through the same sandbox and returns a failing exit status if any selected assertion does not pass. Rebuilding from the lock creates a new snapshot generation. Never interpret a replay as byte-for-byte recovery of an unavailable old workspace.

An infrastructure failure on an assertion observation also uses the maintainer-authorized rescan flow. The operator retry command refuses these scans so it cannot silently omit the selected assertion or bypass its repository authority check.

## Pre-publication CI

`compatlab ci` accepts a local npm archive on a qualified Linux amd64/runsc host. It does not upload the archive or create a hosted scan. Package extraction and installation run only in the preparation sandbox, with lifecycle scripts disabled. Transitive dependencies remain restricted to public npm tarballs with integrity. Private packages and private-registry credentials are unsupported.

Create the archive using your own build workflow, then supply the exact package name/version and a provenance JSON file:

```json
{
  "provider": "github_actions",
  "confidence": "caller_supplied",
  "repository": "owner/package",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "workflow": ".github/workflows/ci.yml",
  "runId": "12345",
  "runAttempt": 1
}
```

```sh
sudo node apps/cli/dist/bin.js ci package-name@1.0.0 \
  --artifact /absolute/path/package-name-1.0.0.tgz \
  --provenance /absolute/path/provenance.json \
  --state-dir /var/lib/compatlab-ci --json > report.json
```

The command rejects symlink/special-file inputs and archives over 32 MiB. It hashes a private staged copy, mounts only that copy read-only, validates the root lock integrity and checks the installed package name/version. A package marked `private: true` is rejected. The report's `ci_artifact` source includes SHA-256, SHA-512 integrity, byte size and caller-supplied provenance. That provenance is not a verified GitHub attestation, and the artifact is not a registry publication.

CI exits zero only when all planned loading observations are complete and pass. It uses the same explicit-export coverage limits as `compatlab check`. Keep the archive, provenance and report as CI artifacts. Re-running `ci` makes a new observation; registry reproduction intentionally rejects CI reports. For a published release, use `compatlab check package@exact-version` or the hosted public scan flow. There is no anonymous upload endpoint.

## Rollout and qualification

Read the [threat review](assertion-threat-model.md). Apply migration 0007 and the role grants, then deploy control/web before enabling new worker capabilities. Drain/update workers and register their capability JSON with `"assertionRevision":"assertion_v1"`. Workers without that capability cannot claim any job belonging to an assertion observation, including preparation. Existing automatic scans remain compatible.

`pnpm check` covers contracts, source/hash boundaries, classifications and CLI refusal paths. PostgreSQL tests cover registration, ownership, immutable identities, conflicting rescans, revocation during a lease and result forgery. Browser checks cover account controls and report separation. The required `Maintainer qualification` job runs `pnpm test:maintainers` on disposable Linux amd64/runsc; the orchestration gate runs named assertions through the authenticated worker and restart recovery path. Fixture tests do not replace a real deployment App login/source fetch/revocation check.

References checked October 4, 2026: [GitHub Git trees](https://docs.github.com/en/rest/git/trees), [GitHub Git blobs](https://docs.github.com/en/rest/git/blobs), [GitHub Git commits](https://docs.github.com/en/rest/git/commits), [npm lockfile format](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/), [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/).
