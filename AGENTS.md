# Working on CompatLab

Read the current [PRD](compatlab_product_requirements_v1.1.md), [architecture](docs/compatlab-build-plan.md), and [delivery sequence](docs/delivery-plan.md) before changing behavior. Documents under `docs/archive` are historical.

- Work on a feature branch and submit a pull request. Never push project changes directly to `main` or merge without the user's instruction.
- Keep a PR within one delivery slice. Explain behavior, relevant validation, and material limitations.
- Run `pnpm check` before submitting. Run `pnpm test:sandbox` on Linux amd64 with runsc when changing the sandbox smoke path; do not substitute ordinary Docker or silently skip failures.
- Keep TypeScript strict, boundaries validated, and comments limited to non-obvious reasons. Prefer readable names and small functions over explanatory banners.
- Never execute downloaded packages in the web/control process or on the developer host. Fixture smoke tests are not production sandbox qualification.
- Use the canonical contract vocabulary and preserve evidence separately from classifications. Package stdout is never a verdict.
- Pin dependencies, actions, images, and execution policies. Add dependencies only when they remove meaningful maintenance work.
- Update documentation when behavior or prerequisites change. Do not describe future features as implemented.
