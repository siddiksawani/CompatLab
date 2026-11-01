# Contributing

Use Node.js from `.node-version` and the pnpm version in `package.json`.
Use Python 3.12 or newer as `python3` on your `PATH` for the infrastructure tests. Apple's bundled
Python 3.9 on macOS cannot run them; use a separately installed supported Python.

```sh
python3 --version
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs formatting/lint checks, builds the workspace with strict type checking, type-checks tests, and runs the unit/CLI and Python infrastructure tests. Use `pnpm format` for mechanical formatting. Build before invoking `pnpm cli` or running tests directly; workspace imports resolve compiled package exports.

Create a branch from current `main`, keep changes within a [delivery slice](docs/delivery-plan.md), and open a PR. All code and documentation changes go through PR review. Use a short imperative title and explain the problem, behavior, checks, and remaining limitations. Keep comments for non-obvious decisions; avoid generated banners and redundant narration.

CI uses disposable GitHub-hosted runners with read-only repository permissions. The Linux sandbox job installs a checksum-pinned gVisor distribution and runs only authored fixtures. On a prepared Linux amd64 host, run `pnpm test:sandbox`; it fails if runsc is unavailable. Do not run the CI installer on an existing development or production host.

The first smoke image and host output directory are fixture infrastructure, not a public package runner. Public package execution remains blocked on preparation, isolation, resource, and recovery gates in the architecture plan.

Use squash merges after checks pass and review is complete. The maintainer is `siddiksawani`. Do not merge your own PR or bypass checks without an explicit maintainer instruction.
