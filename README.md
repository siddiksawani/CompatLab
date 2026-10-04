# CompatLab

CompatLab tests published npm artifacts across pinned JavaScript runtimes. Reports distinguish observed loading behavior, coverage, and environment limits from broader claims of compatibility.

The local engine resolves and prepares public npm artifacts with scripts disabled, seals their dependency tree, and probes them across pinned Node, Bun, and Deno runtimes. The CLI supports bounded checks and explicit snapshot reuse or lock-based rebuilds. The worker includes host ownership, capacity reservations, recovery and hostile-code qualification. The PostgreSQL catalog and private control service provide transactional admission, durable leases, authenticated result ingestion and snapshot-local dispatch. The anonymous website supports discovery, explicit scan requests, durable progress, report matrices, evidence and reproduction downloads. SSH operator controls, deployment packaging, encrypted off-host backups, retention and release-qualification gates are included; public admission defaults to disabled. See the [operations runbook](docs/operations.md) and [qualification record](docs/qualification.md). See [website setup](docs/website.md), [reports](docs/reports.md), [orchestration](docs/orchestration.md), [catalog and admission](docs/catalog.md), [worker lifecycle](docs/worker-lifecycle.md), [local execution](docs/probe-execution.md), [preparation](docs/preparation.md), and [runtime profiles](docs/runtime-profiles.md) for limits and prerequisites.

## Development

[Named assertions and CI artifacts](docs/assertions-and-ci.md) extend the maintainer workflow. Assertions use commit-pinned offline fixtures and separate behavioral evidence. The Linux/runsc CLI can check a pre-publication archive with a distinct source identity and caller-supplied provenance.

Optional [maintainer accounts](docs/maintainers.md) use GitHub App login, encrypted OAuth tokens, live repository authority checks, revocation and account quotas. Configure the App before enabling sign-in; public reports remain anonymous.

Use Node.js **24.21.0** from `.node-version` and pnpm **12.8.1** from `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm cli --help
pnpm cli doctor --json
```

`pnpm check` runs formatting/lint checks, a strict workspace build, test type checking, and unit/CLI tests. Build before running the CLI or tests directly. Development checks work on macOS and Linux; a Docker daemon is needed for `doctor`, sandbox tests and the local PostgreSQL test server. See [database qualification](docs/catalog.md#migrations-and-qualification) for the separate integration gate.

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
| `apps/cli` | Prerequisites, checks, CI archives, reproduction, SSH administration and backup encryption |
| `apps/web` | Anonymous discovery, scan requests, durable progress and report pages |
| `packages/engine` | Registry resolution, analysis, planning and bounded probe orchestration |
| `packages/catalog` | PostgreSQL identities, admission, leases, result validation, recovery and cache lookup |
| `packages/contracts` | Canonical vocabulary and bounded completion validation |
| `services/worker` | Preparation, sealed storage, runtime supervision and local evidence storage |
| `services/control` | Private WireGuard-bound worker API and reconciliation |
| `harnesses` | Automatic loading and separate named assertion completion protocols |
| `services/maintainer` | Release reconciliation, comparison and independently retried email |
| `runtime-images` | Digest-pinned minimal runtime image recipe |
| `fixtures` | Authored module/protocol and preparation archive fixtures |
| `infra` | Pinned service packaging, worker provisioning, backup and recovery configuration |
| `scripts` | Containment, corpus, deployment and recovery qualification |
| `docs` | Architecture, delivery sequence, research, and decision records |

## Delivery and contribution

The [fourteen-PR delivery plan](docs/delivery-plan.md) covers the public MVP and gated maintainer workflows. The [architecture plan](docs/compatlab-build-plan.md), [PRD v1.1](compatlab_product_requirements_v1.1.md), and [research notes](docs/research-notes.md) define the design. The [original PRD](docs/archive/compatlab_product_requirements_v1.md) is preserved as historical reference.

All project changes use feature branches and pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and review expectations, and [SECURITY.md](SECURITY.md) for reporting security issues. The repository is maintained by [siddiksawani](https://github.com/siddiksawani) and licensed under [MIT](LICENSE).

Maintainers can configure release reconciliation, compare immutable reports, request controlled rescans and opt into evidence-linked alerts. See [monitoring and deployment](docs/monitoring.md).
