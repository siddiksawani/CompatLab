# Four retained assertions, three causes

The November 16, 2026 follow-up distinguishes the remaining Import-fresh 4.0.1
suite failures on Deno 2.9.7 and 2.9.8. These are the same pinned upstream tests
and Node 26.10.0 baseline as the [timeout investigation](README.md). No assertion
is removed or weakened: the context-bound suite still completes with **65 passes
and four failures** on each Deno version; Node passes all 69.

## Hook-registration spy: export synchronization

The upstream fixture patches the default `Module.registerHooks` property,
calls `syncBuiltinESMExports()`, then expects the package's named import to use
the spy. Deno's synchronization method is a no-op in both tested versions:
the default property changes, but the named binding does not. The spy therefore
cannot observe those calls. Its zero count is not evidence that registration
was absent or duplicated.

A separate, explicitly instrumented package copy increments a counter directly
at the original registration call. Three fresh nested imports produce values
`[1, 1, 1]` with exactly one registration on all three profiles. This is a
diagnostic of the call path, not an unmodified upstream-suite pass. The ordinary
suite uses untouched package code and retains the failed spy assertion.

The earlier [Deno PR #34593](https://github.com/denoland/deno/pull/34593) added
the export's availability; it did not implement synchronization. We distinguish
that completed work from the remaining behavior gap, reported as
[Deno #37185](https://github.com/denoland/deno/issues/37185).

## Two type-attribute failures: rejection preserved, error code lost

For `{type: 'json'}` and `{type: 'commonjs'}`, Import-fresh throws its intended
attribute error before executing the CommonJS target. The side-effect counter
stays zero on Node and both Deno versions. Deno transports the load-hook error
as text and surfaces `ERR_MODULE_NOT_FOUND`, losing the package's error code.

A package-free hook throwing a known error reproduces the loss. Node preserves
the thrown error and its code; Deno returns a different error carrying
`ERR_MODULE_NOT_FOUND`. These two failed assertions concern error-code fidelity,
not a missing fixture or observed execution despite rejection. The independent
hook-error reproduction is [Deno #37186](https://github.com/denoland/deno/issues/37186).

## Unknown attribute: discarded before the package can validate it

Without hooks, both runtimes reject an unknown attribute before the target runs.
With hooks active, Deno's dynamic import passes an empty attribute map to the
resolve hook. The load hook receives `type` when present, but loses the unknown
key. Import-fresh's validation therefore sees no attribute to reject, and the
CommonJS target executes once. Node forwards the full map and rejects the call.

The package-free virtual-module reduction has the same result. The empty-map
control succeeds and executes once on all profiles; invalid-attribute cases
remain separately recorded. This is not a claim that Deno accepts every unknown
attribute: its direct-import control correctly rejects it.

[Deno PR #35028](https://github.com/denoland/deno/pull/35028) explicitly scoped
its attribute transport work to static imports and left dynamic imports out.
This follow-up reproduces the remaining dynamic-import gap and its consequence
for package validation; it does not present the limitation as a new discovery.
The dynamic case is reported as [Deno #37187](https://github.com/denoland/deno/issues/37187).

## What changed in CompatLab

The study now records actual target execution independently of rejection and
error codes. The registration counter is kept separate from the untouched suite.
Publication checks require complete evidence, exact expected controls, both
fresh attempts, offline execution and the unchanged suite inventory. An
intentional assertion failure remains nonzero on every profile. Tests reject
missing evidence, false zero exits, truncation, timeouts and lost side effects.

The [48-measurement receipt](assertions.json) contains two fresh attempts at
each reduction on each runtime, positive/negative controls and a complete
context-bound suite per runtime. The earlier [exploration](assertions-exploration.json)
is retained separately. Source commits, workflow URLs, runtime versions, lock
identity and hashes are in the receipts and [manifest](manifest.json).

All measurements ran in disposable GitHub-hosted Linux amd64 gVisor containers
with execution networking disabled and Deno `-A`. Preparation reused the frozen
lock with lifecycle scripts disabled. These reductions have not been verified
outside gVisor or on other operating systems. No runtime binary is patched.
The original 189 observations, CSV, cohort, lock and previous follow-up receipts
are unchanged. Public scanner and badge semantics remain loading-only.

Dispatch **Import-fresh Deno assertion triage** to reproduce the qualified run.
Its [runner](../pilot/import-fresh-assertions.py) checks the results with the
[evidence verifier](assertions-verify.py). A successful workflow means the
diagnostics and their expected failures were recorded correctly; it does not
mean the Deno suite passed.
