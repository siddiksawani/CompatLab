# ADR 0002: Install once and reuse sealed local workspaces

Status: accepted for delivery slice 03.

A frozen npm lock identifies dependency inputs. It does not establish that separate installations produce identical bytes, particularly with platform-optional and bundled dependencies. A comparison therefore uses one actual installed tree mounted read-only by every runtime.

Preparation uses standard npm with scripts disabled, fresh private metadata/cache state, and source/integrity validation between lock resolution and installation. The first implementation disables shared tarball caching. Ready snapshot reuse provides the initial optimization without sharing another job's mutable metadata.

The worker retains the exact lock bytes in the sealed workspace and records their SHA-256 digest, installer/profile/platform revision, and an immutable snapshot generation. It computes a tree digest during bounded inspection to verify local reuse. Rebuilding an evicted snapshot creates a new generation; lock equality never implies replay equality.

A sparse, size-limited ext4 volume bounds extraction while avoiding a custom archive handler. This requires a privileged supervisor on a dedicated Linux host. Filesystem limits complement gVisor and network policy; they do not replace host capacity reservations or the worker qualification gate.

The database will reserve preparations by artifact and configuration identity before the lock is known. Runtime jobs will retain locality to the worker owning the sealed snapshot. Cross-host transfer and shared caches remain outside this slice.
