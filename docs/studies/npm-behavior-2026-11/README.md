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

The pilot uses two upstream JavaScript suites packaged with the exact npm
artifacts. Run both scripts listed by Pump's test command. For Split2, run
the same TAP assertions as its unit command and record assertion counts,
with lint and coverage instrumentation outside the observation. Run a
bcrypt hash and verify case and an esbuild transform as separately labeled
behavior smoke tests. Keep the npm tarball, digest, and dev-tool lock.
Later cohorts may use an upstream source checkout for tests missing from
the tarball. Pin and verify the release commit, test assets, and dependency
lock before executing those files.

## Execution

Use identical published package bytes and a shared Node-prepared dependency
tree on the three pinned Linux amd64 profiles. The pilot uses Node.js
26.10.0, Bun 1.4.2 and Deno 2.9.7. Record pinned runtime image references,
actual versions, image ID, kernel, runsc version, commands, and timestamps.
Preparation starts with a locked, script-disabled npm install from the
public registry in a disposable gVisor container. The second preparation
runs only the pinned bcrypt install and esbuild postinstall lifecycle
hooks in a network-disabled gVisor container. Report failures during
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
