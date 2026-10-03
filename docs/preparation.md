# Sandboxed preparation

The worker exposes `prepareArtifact` and `reuseSnapshot`. Both require a local Linux amd64 Docker/runsc host with root privileges for bounded filesystems and firewall rules. They refuse remote Docker endpoints and unsupported hosts. Bridge netfilter must be loaded, with `net.bridge.bridge-nf-call-iptables=1`; the worker checks this before creating a network. There is no host npm or ordinary-Docker fallback.

This is the preparation implementation and its qualification suite. Public execution remains disabled; the wider process, network, resource, cancellation, and recovery qualification belongs to delivery slice 06.

## Installation

The worker creates a private consumer with one exact dependency. It runs npm 11.19.0 from the pinned Node 24.21.0 image in two separate runsc containers:

1. `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` resolves a fresh lock.
2. After the first container is removed, the worker validates the lock.
3. `npm ci --ignore-scripts --no-audit --no-fund` installs the frozen dependency graph.
4. After the second container is removed, the worker verifies unchanged lock bytes, validates the tree and installed root identity, removes the cache, and seals the volume.

Registry, configuration, cache, retry, and concurrency flags are fixed by the preparation profile. npm receives no host npm configuration or credentials. The cache is private to the preparation and never mounted by runtime tests. Lifecycle scripts and compilation are excluded. Shipped native files remain eligible for the later runtime probes.

Lock validation requires npm lock version 3, the exact consumer dependency, public-registry HTTPS origins, and strong integrity for each non-bundled artifact. npm aliases retain their installation paths. Bundled dependencies must have a verified containing artifact. Optional dependencies may be omitted by npm; their omission is recorded. A different root digest is an integrity failure, not another artifact silently accepted under the original request.

## Enforced bounds

| Resource | Preparation profile |
|---|---|
| Installer memory / CPU | 2 GiB / 1 CPU |
| Writable filesystem | 2 GiB ext4 loop volume, bounded inode count |
| Temporary filesystem | 64 MiB |
| Package-work deadline | 180 seconds across both phases and inspection |
| Retained tree | 512 MiB, 50,000 entries, bounded path depth |
| Lock | 16 MiB, 10,000 dependency records |
| Installed manifest | 2 MiB, bounded JSON structure |
| Proxy return traffic | 512 MiB including TLS and metadata overhead |
| Logs | 128 KiB stdout; 112 KiB stderr prefix plus 16 KiB tail; stop after 8 MiB emitted per command |

A successful npm exit is insufficient when extraction reports an entry error or the filesystem exhausts bytes/inodes. The supervisor rejects partial installations, including npm warning-only `ENOSPC` outcomes. Terminal npm error codes are observed throughout the bounded stream and retained in the stderr tail.

The ext4 backing file is sparse, so the supervisor must reserve its maximum growth and maintain disk headroom. Host-wide reservation and low-disk admission arrive in slice 06. Cleanup removes containers before unmounting. A failed cleanup or unmount leaves resources for investigation instead of deleting an active mount.

Preparation has a private internal bridge. The job can reach only its Squid proxy on TCP 3128, with host-input and forwarding rules blocking bypass. The listener binds only to its private job interface and accepts requests only from that job's IP. The proxy allows CONNECT to exactly `registry.npmjs.org:443`, rejects private IPv4/IPv6 destinations, and has bounded memory, requests, timeouts, and logs. The proxy uses explicit public DNS resolvers (1.1.1.1 and 1.0.0.1), with ICMP/ARP discovery helpers disabled. TLS verification remains npm's responsibility; there is no interception certificate or custom registry gateway. Runtime networking is separate and disabled.

## Snapshot identity and reuse

The stopped tree is inspected without following untrusted files into host paths. Special files, escaping or dangling symlinks, and hard links outside the tree are rejected. Internal symlinks and hard links are supported. A deterministic tree digest includes paths, file kinds, executable mode, link targets, and file bytes.

The volume is remounted read-only before returning a snapshot. The snapshot has a random immutable generation, the exact lock digest, installer/profile/platform identity, and a tree digest. A reuse request names a retained snapshot explicitly; it verifies the read-only mount and both digests and returns the same generation and workspace. It does not reinstall packages. An unavailable snapshot cannot silently turn into a new generation under the old identity.

Local metadata lives outside the sealed filesystem and is readable only by the supervisor. Filesystem operations and Docker arguments are internal worker interfaces; they are not public request payloads. Persistent catalog ownership and durable job authorization arrive in slices 07 and 08.

Profile `npm_11_19_0_linux_amd64_v2` reserves an empty `.compatlab` directory in the consumer for the read-only harness mount. It is included in tree verification. Snapshots from the earlier layout require fresh preparation; they cannot be reused under this profile.

## Qualification

On a disposable Linux amd64 execution host with runsc, after `pnpm build`:

```sh
sudo "$(command -v node)" scripts/preparation-smoke.mjs
```

The suite pulls the pinned installer and proxy, verifies npm's version, prepares a small public artifact without loading it, reopens its actual snapshot, and attempts writes through two independent read-only mounts. Authored archives exercise root/transitive/bundled lifecycle sentinels, aliases, platform-omitted optional dependencies, traversal and symlink handling, compression-ratio rejection, expanded bytes, inode exhaustion, traffic quota exhaustion, a container OOM kill, proxy source isolation, and npm integrity rejection. Fixture tarballs are seeded into a private cache by npm inside runsc; no archive is extracted on the developer host.

Unit tests separately cover lock policy, safe file reads, tree inspection, stream limits, and cancellation. These tests supplement the Linux suite; they do not replace it or certify the full worker boundary.

Implementation references: [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), [npm lock format](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/), [Docker firewall rules](https://docs.docker.com/engine/network/firewall-iptables/), and [Squid access controls](https://www.squid-cache.org/Doc/config/acl/).
