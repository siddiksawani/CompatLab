# Registry resolution

`@compatlab/engine` exposes `RegistryClient.search`, `versions`, and `resolve`. Requests use only `https://registry.npmjs.org`, omit credentials, and reject redirects. Scoped names are encoded as one path component. Optional descriptions and repository links are bounded; absent publication times and repository fields do not prevent resolution.

`versions` requests abbreviated metadata and returns descending exact semver versions plus observed dist-tags. `resolve` accepts an exact version or a tag, never a range. A tag is read afresh, then the selected-version endpoint is fetched and its name/version checked. An exact version skips the packument. Observed tags are discovery information, separate from immutable artifact identity.

Artifact URLs must use registry HTTPS without credentials, query parameters, or fragments. Integrity requires a single usable digest at the strongest supplied SHA-256/384/512 level; ambiguous digests at that level and SHA-1-only metadata are rejected. This validates registry metadata. npm must still verify downloaded bytes during sandboxed preparation. This module never downloads or executes package code.

| Response | Decoded limit |
|---|---|
| Search | 1 MiB, at most 20 returned entries |
| Abbreviated metadata | 32 MiB |
| Selected manifest | 2 MiB |

Limits apply while streaming, including decompressed responses. JSON is limited to 32 nested containers and 64 KiB of UTF-8 source bytes per string, including escapes, before constructing objects. The string limit applies to keys and values and is deliberately conservative for escaped text. Invalid UTF-8, invalid JSON, and unexpected content types fail explicitly. The default overall request deadline is ten seconds across at most three attempts. Only transport failures, HTTP 429, and server errors are retried. Retry delays are bounded and respect caller cancellation. Resolution may involve two separately bounded requests.

The injected fetch option is for trusted transport adapters and tests; it is not an end-user registry setting. Tests use a local HTTP registry to exercise actual streaming, gzip decoding, cancellation, redirect behavior, and retry bounds without relying on live registry availability.

The client follows npm's [registry API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md) and [package metadata formats](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md).
