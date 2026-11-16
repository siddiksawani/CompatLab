# Import-fresh timeout follow-up — November 16, 2026

The original 189 observations remain unchanged. This follow-up investigates
Import-fresh 4.0.1's full-suite timeout separately from its passing named probe.
It uses Node 26.10.0, Deno 2.9.7 and Deno 2.9.8, the retained dependency lock,
and the same pinned upstream tests and fixtures. Every execution uses a fresh,
network-disabled Linux amd64 gVisor container with Deno `-A`. No runtime or
package implementation is patched in the context-bound suite measurements.

## What stalled

The unmodified Deno suite stops after two tests on both tested versions.
The third test, a nested top-level-await import, passes when selected alone.
The same first two cases followed by the nested import pass outside the test
runner. This is not a claim that nested imports always deadlock.

A package-free reproduction shows a dynamic import inside an AsyncLocalStorage
scope in one `node:test` callback leaking that scope into the next callback
under Deno. The first callback itself sees the expected empty outer context
before returning. Node does not leak the scope. A timer-only control without
the dynamic import passes. A pass-through loader hook is unnecessary.

Instrumentation of a disposable package copy shows why this matters:
Import-fresh treats the stale scope as an active parent. The subsequent nested
import is queued behind its own unfinished outer import. That queue explanation
is an inference from the trace and matched controls, not a diagnosis of a
specific line in Deno's implementation.

The context-leak reproduction is reported upstream as [37184](https://github.com/denoland/deno/issues/37184).
An upstream runtime fix has not shipped; the binding below is a research-runner workaround.

## Bounded workaround, not a compatibility pass

The follow-up binds each test callback to its registration-time async context
with `AsyncResource.bind`. It changes only the `node:test` import/registration
adapter in a disposable copy of the two test files. Test bodies, assertions,
fixtures, package bytes, test order, and per-file process boundaries stay intact.
No cases are filtered, skipped, or retried until green in this adapted suite.

Both files now complete: 65 tests in `test.js` and four in
`skip-node-modules.js`. Node passes all 69. Each tested Deno version passes 65
and fails four. This is **69 completed**, not **69 passed**, and is explicitly
an adapted suite. Deno's unmodified whole-file timeout remains in the original
published table and raw data.

The four retained failures have now been [triaged separately](assertions.md):
a no-op export-synchronization method disconnects the registration spy, two
attribute rejections lose their error codes without executing the target, and
an unknown dynamic-import attribute is discarded with hooks active, allowing
the target to execute. These are three causes, not four independent runtime bugs.
The original isolated replays and the 65-pass/four-failure suite count remain
unchanged; the new reductions and side-effect controls are separate evidence.

## Evidence and controls

- [Initial isolation](isolation.json): original Node suite, original Deno
  timeout, isolated third case, standalone async-context and nested-import controls.
- [Deno 2.9.8 comparison](current-deno.json): latest stable checked on November 16
  also times out; standalone ordered imports pass. Its instrumented Deno stdout
  does not retain the trace, so it is not used to infer absent execution.
- [Retained queue trace](queue-trace.json): trace written to a separate output
  file survives timeout; the package copy is instrumented only in labeled rows.
- [Initial context binding](binding.json): package-free leak, hook control,
  two-import timeout/control, and all 69 adapted tests.
- [Verification and independent replays](verification.json): minimal dynamic
  import/control, intentional assertion failure, two fresh adapted-suite attempts,
  and the four failures individually selected from unmodified test files.
- [Manifest](manifest.json): file hashes and source/run provenance.

An earlier attempt to remove the dynamic import entirely passed on Deno and
stopped its diagnostic workflow at an over-specific expected-failure assertion
([run 43872925382](https://github.com/siddiksawani/CompatLab/actions/runs/43872925382)).
That exploratory run did not establish a timer-only defect. The final workflow
retains the passing timer-only case as a control.

The verifier checks the exact ordered test names and TAP plan against the
[frozen inventory](../pilot/import-fresh-tests.json), exit status, log completeness,
timeout, OOM and container errors. A deliberately failing assertion must remain
nonzero with a failed TAP case under the binding adapter. Assertions and coverage
are not inferred from zero exit alone.

## Reproduce

Dispatch **Import-fresh Deno follow-up** in GitHub Actions. The
[runner](../pilot/import-fresh-diagnostic.py) refuses developer-host execution,
builds the pinned image, prepares the retained npm lock with lifecycle scripts
disabled, and records commands, versions, limits, source commit and run URL.
The [reduction](../pilot/async-context-repro.mjs) and its
[child module](../pilot/async-context-child.mjs) use only runtime built-ins.
Inside a disposable sandbox, run:

```sh
node --test --test-reporter=tap /pilot/async-context-repro.mjs
deno test -A --no-config --no-lock --cached-only --no-check --reporter=tap /pilot/async-context-repro.mjs
BIND_CONTEXT=1 deno test -A --no-config --no-lock --cached-only --no-check --reporter=tap /pilot/async-context-repro.mjs
```

Use the workflow for exact environment reproduction. The public scanner and
README badges remain loading-only; they do not execute this adapter or these
upstream suites.
