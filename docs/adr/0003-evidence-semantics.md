# Evidence and classification revisions

Status: accepted, implemented through PR 11.

Keep package observations separate from the versioned classifier. Preparation is shared evidence; root ESM, root CommonJS and the two subpath groups are independent cells for each selected runtime. Incomplete enumeration or execution remains visible even when root loading succeeds. Native/script prerequisites, policy restrictions and infrastructure failures retain their causes instead of being flattened into package incompatibility.

Store immutable raw observations, exact artifact/lock/snapshot/runtime/harness/policy identities and the execution-completion timestamp. Report classification has its own revision and timestamp. Reclassification creates a new report revision and links the prior revision; it does not rewrite what executed. Runtime quarantine and report invalidation affect current reuse without erasing historical observations. Logs have separate sanitization, byte and retention bounds and can be removed with an audit.

We rejected a single mutable pass/fail row because it would lose coverage and execution context, and rejected package stdout as a verdict because packages control it. The completion protocol limits accidental or out-of-process forgery; it does not attest against all code running in the same package process. Future behavioral assertions must retain their names and distinct evidence level. Revisit storage shape when evidence volume requires object storage, preserving stable identities and immutable report revisions.

Validation: contract/classifier tests, report PostgreSQL integration, sandbox protocol smoke, engine fixture qualification and public report browser flows.
