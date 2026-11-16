# npm package behavior after a successful load

The November loading study found that 97 of 100 selected versions passed the
root import check on all four tested profiles. This study asks what happens
when code calls the package or runs its upstream tests.

## Frozen cohort

The [cohort](cohort.json) pins 24 npm artifacts across native addons and
lifecycle scripts, workers, HTTP and HTTP/2, module internals, async context,
subprocesses and signals, and streams. The selection deliberately stresses
Node APIs. Keep all 24 rows when publishing results, including unavailable
tests and installation prerequisites. Record how many versions are evaluable
in every reported tier. Registry-wide compatibility is outside this sample.

The pilot and full-cohort run use upstream JavaScript suites packaged with the exact npm
artifacts. Run both scripts listed by Pump's test command. For Split2, run
the same TAP assertions as its unit command and record assertion counts,
with lint and coverage instrumentation outside the observation. Run a
bcrypt hash and verify case and an esbuild transform as separately labeled
behavior smoke tests. Add a Sharp resize check through its shipped native
binary and a ThreadStream check that reads back a file written by its worker.
Build better-sqlite3 against the pinned Node headers and try an in-memory
insert and select through that same binary on each profile.
Repeat with the npm tarball's bundled Linux prebuild as a control. Also
load an identical copy of the rebuilt binary under a different filename
through the package's `nativeBinding` option. Repeat the three modes on Bun
1.4.4 to check the later runtime release.
Give canvas its pinned Linux release prebuild and check image pixel output.
Run the bcrypt Jest suite in-band from a copy of the published package
outside `node_modules`, where Jest discovers its tests. Run the SPDY client
and server suites with their pinned Mocha runner. Keep the npm tarball,
digest, and dev-tool lock.
The end-of-stream and require-from-string tarballs omit their suites. The
pilot fetches their tests from the package's published source commit,
verifies the pinned file hashes, and runs them against the npm artifacts.
The released entry files match the corresponding source files byte for byte.
End-of-stream uses its pinned Tape 4 dependency in its test directory.

As a separate control, repeat the loading study's offline Deno import of
`yargs/browser` with the browser entry alone and after `yargs/helpers`.
Record the raw error codes and messages for each fresh container. This
control uses the same pinned Yargs tarball with a newly locked dependency
tree. It stays outside the behavior cohort.

## Execution

Use identical published package bytes and a shared Node-prepared dependency
tree on the three pinned Linux amd64 profiles. The pilot uses Node.js
26.10.0, Bun 1.4.2 and Deno 2.9.7. SPDY also runs on Node.js 24.21.0 to
check whether the Node.js baseline is version-dependent. Record pinned runtime image references,
actual versions, image ID, kernel, runsc version, commands, and timestamps.
Preparation starts with a locked, script-disabled npm install from the
public registry in a disposable gVisor container. The second preparation
runs only the pinned bcrypt install, esbuild postinstall, better-sqlite3
release build, and canvas install steps in network-disabled gVisor containers. The
pinned Node Bookworm image supplies the compiler and headers for the SQLite
build. The canvas prebuild is downloaded as data and checked against the
release digest before offline preparation. Report failures during
preparation separately from runtime checks. Add further hooks only
alongside the pinned inputs that the packages need. A missing compiler,
shared library, prebuild or fixture is a prerequisite observation.

Each runtime uses its own disposable container and a fresh copy of the
prepared inputs. Use no external network, no service credentials, no
writable host binds, non-root execution, and CPU, memory, process, log
and wall-time limits. Permit local loopback fixtures when required by
a suite. Deno uses full permissions inside this OS sandbox and offline
dependency resolution. Bun's automatic package installation stays off.
This research runs separately from hosted reports and public scanning.

The pilot image runs commands with `/bin/sh -ec`, so a failed script stops
a multi-script suite and its exit code reaches the receipt. Before running
the suites, the pilot verifies this in a sandbox with an intentionally
failing first command and a second command that would otherwise pass.

## Interpretation

| Tier | What counts |
| --- | --- |
| Preparation | The locked install and any separately recorded lifecycle hooks finish. |
| Named behavior | A defined call reaches its expected observable result. |
| Upstream suite | The listed upstream tests run and their assertions pass. Report the suite scope, skips and unavailable fixtures. |

Use Node as the baseline. Compare only when its corresponding test passes
with the same inputs. Runner incompatibility, a missing prerequisite,
different test coverage, and infrastructure failures each get their own
label. A repeatable difference in Bun or Deno is a candidate until isolated
from the test harness, install process, and sandbox. Replay every
non-pass in a fresh container. Reduce actionable differences to a small
standalone reproduction, check for an existing report, and file upstream
after the cause reproduces. Publish commands and raw evidence with the
study, alongside the denominator, provenance, and coverage limits.

## Full-cohort extension

All 24 frozen versions receive an attempted upstream suite or a named
behavior probe. The 13 additional probes cover Piscina worker arithmetic,
Workerpool thread arithmetic, HTTP2-wrapper local TLS HTTP/2, Undici local
HTTP, Pirates require-hook installation and removal, Import-fresh cache
reset, CLS-hooked concurrent context isolation, Async-hook-domain timer
error capture, Cross-spawn synchronous and asynchronous children, Execa
success and nonzero exits, Foreground-child exit callbacks, Signal-exit
callbacks, and Readable-stream backpressure and error propagation.
These are bounded cases, not complete upstream suite coverage.

Named probes must exit zero and produce the expected completion file after
their assertions finish. The supervisor reads this file from a disposable
output volume; stdout is retained only as evidence. An early zero exit
without this file is not a pass. Asynchronous probes default to a nonzero
exit until their awaited work completes. Child-process and worker probes
check the runtime identity returned from their children. Deno subprocesses
receive the same permission and offline flags as their parent. Runtime
options spawned internally by a package remain part of the observation.

The expanded lock remains exact. It adds the remaining frozen packages to
the shared consumer tree, so results are rerun for the earlier 11 versions.
The full run has a 2 GiB memory cap and 768 MiB private workspace tmpfs.
The checked-in localhost TLS key is a public test fixture used only inside
network-disabled containers. It has no production use or trust authority.

The completed study also runs a separate root import for all 24 versions
in fresh containers. Named cases use the same completion rule, and the
cohort remains fixed even when its Node baseline fails.

Additional source suites are pinned at the frozen npm metadata commits.
Workerpool runs its seven top-level JavaScript test files with Mocha
11.7.6. Import-fresh runs both JavaScript unit files as separate processes
and requires both test summaries for a pass. CLS-hooked runs eight of its
nine Mocha files; the HTTP-agent file requires public Google access and is
excluded before execution, along with its separately configured TAP suite.
It is labeled an upstream subset. The runner records tests and skips and
flags unequal passing coverage. Lint, type tests, coverage instrumentation,
and source rebuilding are outside all suite observations. Published package
implementation files are retained; only tests and fixtures are added.
