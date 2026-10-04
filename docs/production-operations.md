# Production operations

This runbook describes the deployment tooling. See the separate launch record for the installed release and the checks actually completed. The public maintainer workflow stays disabled.

## Releases

Every merge to `main` starts **Production release** in GitHub Actions. It qualifies the merged commit, publishes three digest-pinned GHCR images and a `production-<commit>` GitHub release, then invokes the restricted VPS deployment account. Qualification can take tens of minutes. Production continues serving the previous release while these checks run. A failed check prevents publication/deployment.

The deployment key can request only `deploy <40-character commit>`. The VPS checks that the commit is still the head of `main`, downloads the matching manifest and bounded archive, checks its digest, and validates archive paths. The deployment lock serializes requests. Web-only releases leave the worker alone. Worker changes stage on the dedicated VM, pause new admission, let existing scans finish, update its immutable matrix/capabilities, restart, and wait for a reconciled heartbeat. An operator's admission pause, worker drain, revocation or quarantine is never automatically cleared.

The VPS keeps release directories under `/opt/compatlab/releases`; `/opt/compatlab/current` identifies the running application. Its `manifest.json` records the source commit and image digests. `worker-release` records the worker's separate installed commit. Deployment replaces containers, so a brief interruption is possible.

Migrations must remain compatible with the previous application release. Deployment takes a verified off-host backup before a schema/grant change. Failed application health restores the previous app and worker, but does **not** reverse a database migration or restore over the live database. Failure to restore worker health leaves admission paused.

Run on the VPS:

```sh
sudo compatlab-admin status
sudo cat /opt/compatlab/current/manifest.json
sudo cat /var/lib/compatlab-deploy/last-success.json
sudo cat /var/lib/compatlab-deploy/last-failure.json
sudo docker compose --project-name compatlab-prod --env-file /opt/compatlab/current/release.env --file /opt/compatlab/current/infra/compose.yaml logs --tail 100 web control proxy
```

Compose operator commands need `COMPATLAB_CONFIG_DIR=/etc/compatlab` in their environment. For repeated use, enter `sudo -i`, then `export COMPATLAB_CONFIG_DIR=/etc/compatlab`. Do not print `.env` files or credential files into tickets.

To retry a failed deploy after fixing its cause, rerun the **Deploy production** job in Actions. If the complete workflow is rerun after publication, the publisher deliberately refuses to replace existing artifacts; rerun only the deploy job. To roll back manually, use `sudo compatlab-deploy rollback <commit-from-/var/lib/compatlab-deploy/previous>`. Only the previous successful release is eligible. A newer merge can subsequently deploy normally.

A failed process or host restart can leave a deployment pause in place deliberately. Inspect logs, reconcile the intended release, verify worker health, then clear only the recorded release with `sudo compatlab-admin deployment-end <commit> --reason 'Recovery verified'`. Use `pause` and `resume` for independent operator maintenance.

## Installation and credentials

Provision the fresh execution VM with `infra/provision-worker.sh`, never on a shared host. The VM, WireGuard and host firewall prerequisites are in [deployment.md](deployment.md). Pin Node to `.node-version` on the VPS and VM. Changes to the OS, Docker or runsc provisioning recipe require an operator upgrade and renewed Linux qualification; application deployment does not silently upgrade host packages.

Generate three distinct Ed25519 keys: GitHub-to-VPS deployment, VPS-to-worker deployment, and VPS-to-devbox backup. Get SSH host keys from the operator's existing trusted sessions, not an unverified network keyscan. Put `COMPATLAB_DEPLOY_KEY` and `COMPATLAB_DEPLOY_KNOWN_HOSTS` in the GitHub **production** environment. Restrict that environment to the protected main branch, keep workflow permissions read-only by default, and keep required checks bound to GitHub Actions. Published GHCR packages must be publicly pullable by digest before first deployment.

From a reviewed release checkout, run `sudo bash infra/install-deployment.sh vps /path/to/github-deploy.pub` on the VPS and the same command with `worker /path/to/vps-worker.pub` in the VM. On the devbox run `sudo bash infra/install-backup-receiver.sh /path/to/vps-backup.pub`. The scripts create only dedicated CompatLab accounts, directories and sudoers entries.

Create VPS configuration once with `node infra/configure.mjs compatlab.me /etc/compatlab`; it refuses to overwrite an existing directory. Set `/etc/compatlab/origin-mode` initially to `bootstrap`. Keep `/etc/compatlab` root-owned mode 700 and secret files mode 600. Set the deployment role after configuration creation. Create `/etc/compatlab/ssh_config` with pinned host keys and distinct identities for `compatlab-worker` at `10.44.0.2` and `compatlab-backup` at `10.44.0.3`, with `BatchMode yes`, `IdentitiesOnly yes`, and `StrictHostKeyChecking yes`.

The VM's `worker.env` uses `infra/worker.env.example`. Only its one-time worker token is sent to the VM; database credentials, backup keys and Resend keys stay off that host. The VPS stores Resend's sending-only key at `/etc/compatlab/resend-api-key` and sends operational alerts from `ops@alerts.compatlab.me` to `siddikhacker@gmail.com`.

## Backups and recovery

VPS `/etc/compatlab/backup.env`:

```ini
ADMIN_DATABASE_URL_FILE=/etc/compatlab/operator-url
BACKUP_KEY_FILE=/etc/compatlab/backup-key
BACKUP_DIRECTORY=/var/lib/compatlab-backups
BACKUP_POSTGRES_CONTAINER=compatlab-prod-postgres-1
BACKUP_SSH_TARGET=compatlab-backup:/srv/compatlab-backups
BACKUP_SSH_CONFIG=/etc/compatlab/ssh_config
BACKUP_TRANSPORT=restricted
```

The daily timer runs at 02:00 UTC with up to ten minutes of jitter. The hourly retry timer uploads completed archives after a connection failure without taking another dump. Local and off-host retention is seven days. The receiver accepts only a bounded encrypted stream with a verified size/hash, caps its archive storage at 20 GiB and leaves 40 GiB headroom on the shared devbox. The backup key must also be kept in a separate operator recovery location. Never put it in GitHub, the worker VM or a public issue.

```sh
sudo systemctl start compatlab-backup.service
sudo systemctl status compatlab-backup.timer compatlab-backup-retry.timer
sudo journalctl -u compatlab-backup -u compatlab-backup-retry --since today
```

Restore drills use `compatlab backup decrypt` to a private temporary file and `pg_restore --no-owner --no-acl` into a **new disposable PostgreSQL instance**. Inspect `compatlab backup --help` for exact CLI arguments. Apply the release's role grants to the restored database, compare report and evidence counts and read representative reports, record elapsed time, then destroy only that disposable instance and plaintext temporary file. Never restore a drill over the live database. RPO 24 hours and RTO 4 hours remain targets until measured.

## Cloudflare networks and origin access

The canonical allowlist is `infra/cloudflare-ips.json`. The weekly `compatlab-cloudflare-check.timer` fetches Cloudflare's HTTPS API, validates the ranges, and writes a candidate and check result under `/var/lib/compatlab-deploy`. It **does not** change active rules. Fetch errors, stale checks and changed lists generate email alerts.

For a change, inspect the candidate against [Cloudflare's published ranges](https://www.cloudflare.com/ips/), update the JSON in a feature-branch PR, and run `pnpm check`. Review unusually broad ranges or large removals explicitly. After merge, deployment validates Caddy before applying the policy; the firewall chain update is atomic and matches only the origin's published IPv4 TCP ports 80/443 through Docker's `DOCKER-USER` path. Other applications and SSH rules are preserved. Failed validation leaves the current policy intact; failed application health restores the previous policy and release.

After Cloudflare is proxying both domain records with **Full (strict)**, write `cloudflare` to `/etc/compatlab/origin-mode`, run `sudo python3 /opt/compatlab/current/infra/origin.py apply /opt/compatlab/current/infra/cloudflare-ips.json`, and verify external HTTPS plus rejection of direct-origin connections. Caddy trusts the same versioned Cloudflare ranges. There is no public IPv6 or QUIC origin mapping. Keep those absent until separately qualified.

## Monitoring and persistence

`compatlab-health.timer` checks local website/database health, the selected matrix's worker guard, queue age, infrastructure failures, backup capture age, VPS/VM disk space, deployment failures and the Cloudflare range check. It emails on state changes and daily while a problem persists; recovery sends one email. An email accepted by Resend is not proof of inbox delivery. Confirm the launch test in the recipient inbox.

Run `sudo python3 /opt/compatlab/current/infra/health.py test` for an alert test. Inspect `sudo journalctl -u compatlab-health --since today` for delivery errors. The VPS cannot email during a complete VPS or outbound-network outage. Add an independent external HTTPS monitor for `https://compatlab.me/healthz` and test its alert separately.

Docker restart policies, `compatlab-stack.service`, WireGuard units, VM/network autostart, the worker unit and timers restore services after restart. Test the VM and project services without rebooting the shared hosts. Shared-host reboots require an agreed maintenance window. Log rotation applies only to project containers; no global journald settings are changed.

Release directories and images are retained for diagnosis and rollback. Inspect disk usage regularly. Remove an obsolete release only after checking it is neither `current`, `previous`, nor the installed `worker-release`; remove only its known project image digests. Never run a shared-host `docker system prune`.
