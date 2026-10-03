# CompatLab

CompatLab tests published npm artifacts across pinned JavaScript runtimes. Reports will distinguish observed loading behavior, coverage, and environment limits from broader claims of compatibility.

The project resolves public npm artifacts, prepares them with scripts disabled inside runsc, seals the workspace for verified local reuse, and plans runtime probes from ordered package exports. Pinned Node, Bun, and Deno profiles share the same read-only workspace. Probe execution and CLI reporting, the website, and full worker qualification are still in progress. See [registry resolution](docs/registry-resolution.md), [preparation](docs/preparation.md), and [runtime profiles](docs/runtime-profiles.md) for supported inputs and limits.

## Development

Use Node.js **24.21.0** from `.node-version` and pnpm **12.8.1** from `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm cli --help
pnpm cli doctor --json
```

`pnpm check` runs formatting/lint checks, a strict workspace build, test type checking, and unit/CLI tests. Build before running the CLI or tests directly. Development checks work on macOS and Linux; a Docker daemon is only needed for `doctor` and sandbox tests.

`doctor` reports whether a Linux amd64 Docker server has a registered runsc runtime. It returns exit code 1 when prerequisites are missing and never executes package code. Passing it does not qualify a host for untrusted execution. There is no fallback to running packages on the developer's machine.

On a prepared Linux amd64 host with runsc:

```sh
pnpm build
pnpm test:sandbox
```

The smoke test builds a digest-pinned fixture image and checks ESM/CommonJS completion, module failure, fake stdout success, missing results, and abnormal exit. It uses authored fixtures only. CI installs a checksum-pinned gVisor release on a disposable GitHub-hosted runner; that installer is not for development or production machines.

## Repository structure

| Path | Implemented responsibility |
|---|---|
| `apps/cli` | CLI argument handling and prerequisite reporting |
| `packages/engine` | Registry resolution, static manifest analysis, export planning and runtime profiles |
| `packages/contracts` | Canonical vocabulary and bounded completion validation |
| `services/worker` | Docker prerequisites, sandboxed preparation, sealed storage and runtime image verification |
| `runtime-images` | Digest-pinned minimal runtime image recipe |
| `fixtures` | Authored module/protocol and preparation archive fixtures |
| `scripts` | Linux smoke test and disposable-CI runsc setup |
| `docs` | Architecture, delivery sequence, research, and decision records |

## Delivery and contribution

The [fourteen-PR delivery plan](docs/delivery-plan.md) covers the public MVP and gated maintainer workflows. The [architecture plan](docs/compatlab-build-plan.md), [PRD v1.1](compatlab_product_requirements_v1.1.md), and [research notes](docs/research-notes.md) define the design. The [original PRD](docs/archive/compatlab_product_requirements_v1.md) is preserved as historical reference.

All project changes use feature branches and pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and review expectations, and [SECURITY.md](SECURITY.md) for reporting security issues. The repository is maintained by [siddiksawani](https://github.com/siddiksawani) and licensed under [MIT](LICENSE).
