# November npm behavior pilot results

The [November behavior protocol](studies/npm-behavior-2026-11/README.md)
pins 24 versions. This pilot covered nine of them. It attempted six
upstream suites and four named behavior checks, with bcrypt in both tiers.
The [Linux amd64 gVisor run and raw evidence](https://github.com/siddiksawani/CompatLab/actions/runs/43814486573)
record the exact commands, image, lock digest, logs, and fresh-container
replays. The measured source commit is `d8b7afd8b9e2c9ea3690adf26e94cae29e01ad6f`.

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

The locked npm preparation passed. The bounded offline preparation executed
bcrypt's install hook and esbuild's postinstall hook. Sharp used its shipped
native binary. Each runtime started from the same prepared tree.

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

Fifteen pinned versions still need a first run. The next suite work is
to verify the matching source and fixtures for packages whose npm
tarballs omit them, and pin the native prerequisites for
better-sqlite3 and canvas. The cohort was chosen to exercise those APIs,
so the results describe only the cases tested here.
