# Runtime planning and images

The planner reads the bounded installed manifest without loading package code. It preserves conditional export order and explicit subpath order. Root ESM and CommonJS applicability are independent; `type: module` does not make `require()` inapplicable. Synchronous ESM can load through require, while top-level await may fail at runtime.

The initial profiles are Node 24.21.0 (LTS), Node 26.10.0 (Current), Bun 1.4.2, and Deno 2.9.7 on Linux amd64 glibc. Versions, source image digests, binary paths, flags, and conditions are maintained in `packages/engine/src/runtime/profiles.ts`. The matrix contract supports one to sixteen distinct profiles and records each actual derived image ID. Channel labels describe this pinned revision, not a moving latest version.

## Planning rules

Only explicit public executable subpaths are selected, up to 512 across the chosen matrix. Wildcards are not expanded. Assets, declarations, blocked exports, invalid subpaths, and overflow have separate omission counts and bounded samples. A path can be applicable for one runtime or mode and excluded for another. Invalid or uncertain target syntax stays eligible for a runtime resolution attempt, preserving diagnostic evidence.

Conditions are runtime-specific: Deno's `deno` condition applies to ESM imports, while its `createRequire()` follows Node conditions without `node-addons`. Bun includes `bun` and `node-addons`; its pinned profile does not select `module-sync`. These differences are checked against real runtimes, not inferred from a shared Node condition list.

Manifest fields and Linux/x64/glibc declarations are static evidence. Shipped `.node` files remain eligible. Lifecycle scripts and build files are indicators, not proof of an unmet prerequisite. Loading and classification arrive in subsequent slices.

## Image boundary

`runtime-images/Dockerfile` copies the pinned runtime binary into a common digest-pinned distroless Debian 13 image. All profiles also receive the same `libatomic` library from the pinned Node 26 support image; Node 26 requires it at startup. Images contain no shell, npm, compiler, or Docker socket. The build records the local immutable Docker image ID, source/base/support digests, creation time, recipe revision, and platform. Verification checks image platform and recipe labels against approved profiles. These supervisor-owned records are not public request parameters or cryptographic attestations of package behavior.

Runtime containers use runsc, disabled networking, a read-only root and workspace, UID 65534, no capabilities, no-new-privileges, 1 GiB memory, one CPU, 128 processes, and private 64 MiB temporary storage. The harness mount is read-only. A separately bounded result filesystem and execution supervision arrive with the probe runner.

Deno uses `-A` inside this OS boundary, manual `node_modules`, `--cached-only`, no config/lock discovery, and a private `/tmp/deno` derived cache. Bun receives `--no-install`. Node uses ordinary runtime semantics without experimental permission restrictions. All runtimes see the same actual sealed npm tree.

## Qualification

After `pnpm build`, run `sudo "$(command -v node)" scripts/runtime-smoke.mjs` on a disposable Linux amd64/runsc host. CI builds all four derived images and checks exact versions, conditional export behavior, synchronous ESM, TLA require failures, a shipped N-API addon, missing native prerequisites, read-only workspace enforcement, and Deno's private offline cache. A small published package is prepared once and loaded by every runtime from the same verified snapshot.

This gate qualifies the selected runtime profiles. Full hostile-code containment and lifecycle qualification remain delivery slice 06; public execution stays disabled until the launch gates pass.

Primary references: [Node package exports](https://nodejs.org/api/packages.html), [Deno run flags](https://docs.deno.com/runtime/reference/cli/run/), [Deno Node compatibility](https://docs.deno.com/runtime/fundamentals/node/), [Bun automatic installation](https://bun.sh/docs/runtime/auto-install), and [distroless image contents](https://github.com/GoogleContainerTools/distroless/blob/main/README.md).
