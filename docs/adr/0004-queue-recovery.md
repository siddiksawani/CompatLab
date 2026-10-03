# Durable queue and recovery authority

Status: accepted, implemented through PR 11.

Use PostgreSQL jobs and bounded transactions for admission, claims and reconciliation. A short transaction-level advisory lock serializes shared quotas and scheduling decisions across control instances. Package execution holds no database transaction or connection. Worker/session/job/attempt identities fence submissions; lease expiration alone cannot release execution capacity, because a partitioned worker may still run code.

Release capacity only after verified cleanup, startup recovery, or an explicit audited operator assertion that the old host has been destroyed and fenced. Draining stops new claims while current leases can finish. Cancellation preserves cleanup obligations, and cancellation of unfinished shared preparation affects every dependent active scan. Infrastructure retry creates a new observation after cleanup rather than resetting a historical scan. Reports aggregate asynchronously from durable evidence.

Sealed workspaces remain on their owner. Another worker can accept a new complete preparation/scan, but cannot claim an existing snapshot is local. Retained locks support an explicit rebuild with a new generation. Database backups are encrypted and copied off-host; worker workspaces are disposable. Recovery targets are operational goals verified by drills, not a high-availability promise.

Redis and a separate queue service were deferred because PostgreSQL already supplies atomic identity, quota and lease transitions at the initial volume. Revisit queue contention, object storage and finer lock granularity using measured wait/throughput data before raising limits. Do not weaken cleanup fencing as a throughput optimization.

Validation: PostgreSQL concurrency and orchestration suites, real remote-worker qualification, cancellation/retry/retirement tests, bounded admission burst, off-host restore and runsc rebuild drills.
