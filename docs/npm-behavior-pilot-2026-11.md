# November npm behavior pilot results (historical)

This records the initial eleven-package pilot, not the completed study. See the
[full-cohort results and triage](studies/npm-behavior-2026-11/README.md) and
[published follow-up](https://compatlab.me/articles/npm-behavior-study-2026-11).

The [November behavior protocol](studies/npm-behavior-2026-11/README.md)
pins 24 versions. This pilot covered eleven of them. It attempted six
upstream suites and six named behavior checks, with bcrypt in both tiers.
The [Linux amd64 gVisor run and raw evidence](https://github.com/siddiksawani/CompatLab/actions/runs/43816868728)
record the exact commands, image, lock digest, logs, and fresh-container
replays. The measured source commit is `0f9496172144761103f0797f902e6b99e03d9ffe`.

| Package | Tier | Node.js 26.10.0 | Bun 1.4.2 | Deno 2.9.7 |
| --- | --- | --- | --- | --- |
| pump 3.0.4 | Upstream | Both scripts passed | Both scripts passed | Both scripts passed |
| split2 4.2.0 | Upstream | 59 assertions passed | 59 assertions passed | 59 assertions passed |
| end-of-stream 1.4.5 | Upstream | 18 assertions passed | 18 assertions passed | 18 assertions passed |
| bcrypt 6.0.0 | Upstream | 75 tests passed | 75 tests passed | 75 tests passed |
| require-from-string 2.0.2 | Upstream | 5 of 7 passed | 5 of 7 passed | 5 of 7 passed |
| spdy 4.0.2 | Upstream | Stopped before tests | Stopped before tests | Suite failed |
| bcrypt 6.0.0 | Hash and verify | Passed | Passed | Passed |
| esbuild 0.28.2 | TypeScript transform | Passed | Passed | Passed |
| sharp 0.35.5 | Native image resize | Passed | Passed | Passed |
| thread-stream 4.2.1 | Worker writes a file | Passed | Passed | Passed |
| canvas 3.2.3 | Pixel readback | Passed | Passed | Passed |
| better-sqlite3 13.2.0 | Insert and readback after a release build | Passed | Binding rejected | Passed |

The locked npm preparation passed. The bounded offline preparation ran
bcrypt's install and esbuild's postinstall hooks, built better-sqlite3,
and installed canvas from its digest-pinned Linux release asset. Sharp used
its shipped native binary. Each runtime started from the same prepared tree.

The better-sqlite3 root returned its constructor on all four profiles in
the focused check. Bun 1.4.2 and 1.4.4 rejected the from-source binding on
the call to open a database, including fresh replays. Both versions passed
with the npm tarball's bundled binary and with a byte-identical copy of the
locally built binary under a different filename. Both Node.js 26 and Deno
passed all three variants. The Bun 1.4.4 source checks for the original
filename suffix when loading a native addon. This independently reproduces the
filename check already documented in [Bun PR #47648](https://github.com/oven-sh/bun/pull/47648),
opened November 1, 2026. That proposed fix remained open and unmerged when
checked November 16, 2026. The [reply on our issue](https://github.com/oven-sh/bun/issues/49082#issuecomment-6909379788)
links the earlier work.

The same two error-reporting assertions in the require-from-string
suite failed on all three runtimes, including fresh
replays. The tests expected particular error text and filenames. Five
other tests passed, including module loading through the package.

SPDY stopped before executing tests on both Node.js 24.21.0 and 26.10.0
because its dependency requested the old `http_parser` binding.
Bun stopped at an unimplemented `stream_wrap` binding. Deno reached
the suite and reported TLS disconnects, socket errors and timeouts.
The fresh replays reproduced those outcomes. Node's baseline failure
precludes a matched runtime comparison for this package.
[Existing SPDY report](https://github.com/spdy-http2/node-spdy/issues/403) ·
[Existing Bun binding report](https://github.com/oven-sh/bun/issues/4957)

The separate Yargs diagnostic reproduced the offline browser-entry failure
on Deno six times, including three runs that first loaded `yargs/helpers`.
Every run returned `ERR_MODULE_NOT_FOUND` with the same unsupported-HTTPS
message. This used the pinned Yargs tarball with the pilot's dependency
lock. The previously reported variation did not reproduce in this setup.

At the end of this pilot, thirteen pinned versions had not run. The completed
study subsequently covered all 24 versions, added root-import controls and
three more upstream suite attempts, and reran the original cases with the
expanded lock. This historical table is not a current task list. Most native
packages still have only named behavior coverage; their full upstream suites
remain outside the published study. The selected cases do not estimate a
registry-wide failure rate.
