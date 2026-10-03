# ADR 0001: isolate package execution from the control plane

Status: accepted for implementation, October 3, 2026.

The web application, database and account credentials must remain outside the package-execution host. The worker is a small TypeScript service that drives Docker with gVisor/runsc using approved images and fixed argument arrays. It does not execute shell strings or pass the Docker socket into jobs. Preparation and runtime execution have separate profiles.

Ordinary Docker alone is insufficient for public package execution. Runtime permission flags differ across Node, Bun and Deno, so the default comparison relies on the common OS policy; denied-capability diagnostics are a separate future profile.

Harness JSON is an observation from a package-visible process. Zero exit and a valid expected completion file are required for a successful root observation; stdout cannot supply that file. This does not establish adversarial semantic attestation. Worker authentication protects submissions, not the honesty of imported code.

PR 1 checks these protocol basics with fixed authored fixtures. Its smoke Dockerfile and output bind directory are test infrastructure, not production images or quota enforcement. Do not accept arbitrary packages until preparation, hostile fixtures, resource accounting, process cleanup and recovery pass their delivery gates.

Revisit this decision if runsc cannot contain the tested workload on the deployment host, unsupported behavior makes reports unusable, or future private/tenant work needs a stronger boundary. A microVM migration requires its own implementation and qualification.
