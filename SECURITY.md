# Security policy

CompatLab is under active development. No release is qualified for untrusted package execution yet. The foundation CLI only inspects prerequisites; a registered runsc runtime is not proof that a host is secure.

Do not post exploit details, private package contents, tokens, or infrastructure addresses in public issues. Use [GitHub private vulnerability reporting](https://github.com/siddiksawani/CompatLab/security/advisories/new) when available, or request a private contact channel from [siddiksawani](https://github.com/siddiksawani).

Include the affected revision, environment, a minimal reproducer, expected impact, and whether the issue affects preparation, execution, result handling, or the control plane. There is no response-time commitment during development.

Containment, evidence limitations, and launch gates are defined in the [architecture plan](docs/compatlab-build-plan.md) and [PRD](compatlab_product_requirements_v1.1.md). Report a vulnerability if the implementation violates those boundaries; passing a package import is never a safety certificate.
