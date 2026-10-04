# Production deployment

This is the approved design for `compatlab.me`. The [production runbook](production-operations.md) contains concrete commands and recovery procedures. Launch verification is recorded separately; this plan is not evidence that installation has finished. Public maintainer accounts and monitoring stay disabled and marked coming soon.

## Placement

| Location | Services | Initial allocation |
|---|---|---|
| Leaseweb VPS | Caddy, Next.js, PostgreSQL, private control, deploy and backup timers | Database 2 GiB; web 768 MiB; control 512 MiB; proxy 256 MiB |
| Devbox | KVM/libvirt, dedicated Ubuntu 24.04 amd64 worker VM, encrypted backup destination outside that VM | VM 4 vCPU, 8 GiB RAM, 60 GiB disk, initially two CPU cores in aggregate |
| Worker VM | Pinned Docker/runsc, supervisor and job storage | One active job initially; increase only after measuring contention |

Use Compose project `compatlab-prod`, `/opt/compatlab/releases/<commit>`, `/opt/compatlab/current`, and private `/etc/compatlab` configuration. Preserve existing applications, preview services, Docker data and host firewall policies. Do not prune shared storage, restart shared Docker, reset a firewall or reboot either shared host during installation.

Only the VM prepares or executes npm packages. Run the fresh execution-host provisioning recipe only inside that VM. Give it a separate NAT bridge, no host directories/sockets or database credentials, and interface-scoped firewall rules denying host, LAN, Tailscale, container, metadata and private IPv4/IPv6 destinations. Permit required public registry/update traffic and the VPS WireGuard endpoint. Verify restrictions from inside the VM and after its restart.

## WireGuard and database

Use `wg-compatlab`: VPS `10.44.0.1`, worker VM `10.44.0.2`, devbox backup host `10.44.0.3`, narrow `/32` routes. The VPS listens on UDP 51820; home peers initiate outbound with 25-second keepalives. No router forwarding or default-route changes are needed.

Allow worker-to-control TCP 4871, VPS-to-worker SSH deployment and VPS-to-devbox SSH backup transfer. Deny peer forwarding. Control verifies the WireGuard interface and binds only to its private address. Each worker has its own token, separate from SSH and database credentials.

PostgreSQL remains loopback-only at `127.0.0.1:55432` because host-network control and SSH operator/migration tools require it. Web uses the Docker network. Never publish PostgreSQL publicly. Remove the mapping if all host consumers later move to the private Docker network.

## Worker-outage admission

Enable `compatlab admin worker-guard-enable --reason 'Enable production outage protection'` before public launch. Catalog-only development and disposable fixtures may leave it disabled. The operator status exposes the guard for each enabled matrix.

The control process checks every five seconds for workers with fresh heartbeats, matching preparation/runtime/harness/policy capabilities, completed recovery, and permission to accept work. Revoked, drained and quarantined workers do not count. Busy workers remain eligible; existing capacity and queue limits still apply.

After three minutes without an eligible heartbeat, stop new scans. The admission transaction also checks heartbeat age, so a stopped control loop cannot leave admission open indefinitely. Cached reports and existing progress remain accessible. A newly enabled or empty guard starts closed.

Reopen automatically only after two minutes of continuously observed healthy operation. A missed observation resets recovery. Automatic state is separate from manual admission pause and worker drain/quarantine, and never clears them. Audit transitions. Before launch, stop the real worker/link, verify admission closes and cached reads succeed, then verify delayed recovery.

## Domain and Cloudflare

Keep GoDaddy as registrar and use Cloudflare Free for DNS, TLS proxying and static assets.

1. Add `compatlab.me` to Cloudflare, select Free, preserve existing mail/verification records.
2. Add `A @ 95.211.43.107` and `CNAME www compatlab.me`, initially DNS only. Remove conflicting website A/AAAA records. Add IPv6 only after separate testing.
3. Remove old DNSSEC DS configuration if enabled. In GoDaddy Domain Portfolio → domain → DNS → Nameservers, enter the exact two Cloudflare-assigned nameservers.
4. Once authoritative DNS resolves correctly, start Caddy and verify origin certificates for both names. Redirect `www` to the apex, preserving paths and queries.
5. Enable Cloudflare proxying and **Full (strict)**. Verify HTTPS, redirects, admission and client-IP throttling before tightening origin access.
6. Restrict origin TCP 80/443 to Cloudflare networks with service-scoped, Docker-aware IPv4/IPv6 firewall rules. Do not replace existing host rules or leave unused public origin QUIC enabled.
7. Caddy trusts only approved Cloudflare CIDRs, reads `CF-Connecting-IP`, and overwrites internal proxy-authentication/client-IP headers. Never trust arbitrary client forwarding headers or all private networks.
8. Cache only `/_next/static/*` initially. Bypass HTML, API, reports, scans, badges and health. Do not use Cache Everything or challenges that break the API or ACME renewal.
9. Once stable, enable Cloudflare DNSSEC, enter its DS values at GoDaddy, and verify the chain.

### Cloudflare IP updates

Check the official IPv4 and IPv6 lists weekly. Download to temporary files with time/size limits, parse every CIDR, reject empty/private/overly broad ranges and unexpected large changes, and record their digest and retrieval time. Alert on changes or fetch failures. Review the candidate diff before applying it.

Serialize policy refresh with deployment. Validate candidate Caddy configuration and prepare new firewall sets before changing active rules. Apply a versioned policy, verify Caddy and external HTTPS, then retain the prior version for rollback. Failed fetches, validation or health checks must preserve/restore the last working policy. Never remove origin restrictions temporarily or run downloaded lists as shell input. Update Caddy trust and firewall policy together through the documented operator procedure.

## Automatic deployment

All changes use feature branches and PRs under `siddiksawani`. Protect `main`, require quality/qualification checks, dismiss stale reviews, require resolved conversations, enforce protection for admins, and prohibit force pushes/deletion. Explicit solo-maintainer self-review is permitted; CI is mandatory. Pin actions to immutable full SHAs, disable persisted checkout credentials, and grant minimal permissions per job.

For every merge, qualify the exact merged SHA, publish web/control/proxy images by digest, and create an immutable manifest identifying source and worker artifacts. Publishing/deploy credentials belong only to those jobs and are never exposed to PR workflows. Do not install a GitHub runner on the shared hosts.

A dedicated SSH key with pinned host identity invokes a restricted, root-owned deployment command accepting a validated release identity. Take a lock, check disk/artifacts, retain the previous release, back up before migrations, apply backward-compatible migrations, start the new app and verify health. Failed app health restores the previous application release. Repair database schemas forward; never automatically restore or downgrade the database on application rollback. Support the current and previous application version through schema transitions.

For worker changes, drain new claims, finish active jobs, deploy the matching artifact, restart, reconcile, verify heartbeats and then resume. Runtime/image/policy changes require a qualified immutable matrix and matching worker capabilities before selection changes. A failed worker rollout leaves reports online and admission closed. Serialize deployments and prevent an older delayed release overwriting a newer merge. Record source SHA, digests and results. Initial Compose replacement can briefly interrupt requests; this design does not promise zero downtime or high availability.

## Persistence and recovery

Enable Docker, WireGuard, VM/network autostart, worker systemd restart and CompatLab timers. Use container restart policies and one boot reconciliation unit rather than competing supervisors. Preserve operator maintenance pauses through deploy/reboot. Test VM and app-stack restarts; shared-host reboot needs a separate maintenance window.

Create encrypted database dumps daily at 02:00 UTC (07:30 India time) and before migrations. Keep seven days locally and on the devbox outside the execution VM. Verify transfer checksum before auditing success. Retain completed encrypted archives during home outages and retry hourly; remove incomplete plaintext output. Bound retention/disk consumption and keep the decryption key separately in an operator recovery location, never on the worker.

Restore into a disposable PostgreSQL volume, apply roles, compare report counts and representative reads. RPO 24 hours/RTO 4 hours are goals until measured. Never practice restore by overwriting the live database.

Use bounded project logs; do not change global journald retention on shared hosts. Preserve deploy/audit records, request IDs and release identities. Monitor external HTTPS, heartbeat/queue, infrastructure failures, backups older than 24 hours, low disk and failed deployments. External monitoring must be outside the VPS/home network. Email alerts require a verified sender and a successful delivery test before they are described as active.

## Search discovery

Set the canonical `https://compatlab.me` origin, descriptive page titles/descriptions, canonical links and social metadata. Publish robots and a sitemap containing public editorial pages and eligible completed reports. Exclude progress, arbitrary search/filter combinations, APIs, errors and account scaffolding from indexing. Keep report content server-rendered, internally linked and accurate about its limited evidence.

After launch, add a Domain property in Google Search Console, publish its TXT verification record in Cloudflare, verify ownership and submit `https://compatlab.me/sitemap.xml`. Inspect the homepage and a representative report. Indexing and ranking are search-engine decisions.

## Execution order

1. Merge tested readiness, deployment automation and SEO changes through protected PRs.
2. Provision the isolated VM/private network; verify existing workloads remain healthy.
3. Install private configuration/database/app with admission disabled.
4. Qualify runsc inside the VM, register images/matrix/token, test guard/backups/restore.
5. Finish DNS, certificates, Cloudflare proxy/trust/firewall and external health checks.
6. Enable capacity-one scanning; test a real scan, cached reports, outage and restart recovery.
7. Complete email/external monitoring and Search Console, recording unfinished operator steps explicitly.

References: [WireGuard](https://www.wireguard.com/quickstart/), [Ubuntu libvirt](https://ubuntu.com/server/docs/how-to/virtualisation/libvirt/), [Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/), [Cloudflare IPs](https://www.cloudflare.com/ips/), [Caddy trusted proxies](https://caddyserver.com/docs/caddyfile/options#trusted-proxies), [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), [Google sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
