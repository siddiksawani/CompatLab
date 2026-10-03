# Release monitoring and comparisons

Sign in, link a public repository, then create a monitor on the maintainer page. Choose the package, a semantic version range and either regressed observations or any meaningful evidence change. There are at most five monitors per account, including paused monitors. Package/range/profile/repository/rule identities are fixed; delete and recreate a monitor to change them.

The published package's repository metadata must identify the linked GitHub repository. Live GitHub user, installation and repository checks still apply. This is repository authorization, not verification of npm publisher ownership. Unavailable or revoked authority stops new selections. Pausing, opting out and deleting configuration are account actions; old public reports remain.

## Reconciliation

The scheduler polls abbreviated npm metadata every fifteen minutes, or every minute while draining a backlog. It records the complete matching version set, up to 5,000 retained versions per monitor. This recovers missed releases and backports even when their semantic version is below the newest observed version. Creating a monitor records existing versions as a baseline and selects the latest matching version. The first completed comparison establishes a quiet baseline.

Each pass discovers at most 25 new releases and attempts five admissions. A unique monitor/version selection and fenced polling lease prevent duplicate selections across schedulers and restarts. All admissions share public capacity, package cooldowns and account quotas. A paused public scanner also pauses new monitor admissions. Registry failures and throttles leave pending releases available for later reconciliation. A mismatched repository or blocked artifact is visible as a blocked release; it does not silently authorize work.

Comparisons use the nearest lower matching version with usable retained evidence in the same matrix. An earlier pending selection delays comparison. The compared report IDs remain fixed. Timing, timestamps, raw logs and arbitrary error message text do not trigger alerts. Outcomes, normalized failure classes and coverage do. Input changes are shown separately: artifact, dependency lock, snapshot/tree, installer, runtime images, harness, probe, policy, platform, classifier and batch order/method. Input changes alone do not trigger a loading-regression alert and cannot prove package causality. Infrastructure-only reports cannot establish a package regression.

## Rescans, history and badges

From a report, follow **Request a maintainer rescan**, select the linked repository and submit the previous scan ID. The parent must be terminal with cleanup confirmed. Repeating the request for the same parent reuses its child observation; requesting another observation uses that child's ID. Another active observation and the five-minute package cooldown can defer a rescan.

A rescan preserves the original report. It reuses an available sealed workspace only while its owning worker is healthy; otherwise preparation gets a new generation. Observation revisions identify re-execution, while classifier revisions identify reclassification. Monitor release selection remains fixed; a manual rescan is compared through its history links.

Package history and `/compare?before=REPORT_ID&after=REPORT_ID` are public. Comparisons show at most 256 changed subjects and disclose truncation; the reports retain complete evidence. History is paginated in batches of fifty. JSON reads are available at:

- `/api/v1/history?name=PACKAGE` (use the returned `next` value as `before`)
- `/api/v1/comparisons?before=REPORT_ID&after=REPORT_ID`
- `/api/v1/badges/REPORT_ID.svg`

These endpoints share a 600-request/minute per-replica read budget; comparisons additionally allow one active request per replica. They schedule no execution. Badge Markdown links back to its immutable report. A badge states the evidence kind, outcome, observation date and historical status; it is not a compatibility or safety certificate. “Current” refers to policy/classification validity, not a promise that an old observation describes today's releases.

## Scheduler deployment

Apply migrations and `infra/grants.sql`, build the release images, then configure GitHub authentication as described in [maintainers](maintainers.md). The optional `maintainers` Compose profile runs `services/maintainer/dist/bin.js` from the control image. It has no public listener or Docker access. It uses the web database role and its own process; the control process and workers do not receive account credentials.

```sh
docker compose -f infra/compose.yaml --profile maintainers up -d maintainer
```

The service reads `web.env` and `notifications.env` from the private configuration directory. Without email, leave `MAINTAINER_EMAIL_ENABLED=false`; in-account notifications still work. To enable email, set `MAINTAINER_EMAIL_ENABLED=true` in `web.env`, and set a Resend sending key and verified sender address in `notifications.env`:

```text
RESEND_API_KEY=<sending key>
NOTIFICATION_FROM=reports@your-domain.example
```

Restart web and maintainer services after configuration changes. The scheduler writes a private heartbeat consumed by its container health check. Fixed-name `monitoring_failed` telemetry carries no token, email address or provider response. Keep the existing admission limits until broader load characterization supports raising them.

## Alert delivery and retention

Every alert records both immutable reports and the comparison revision. In-account notifications are always available. Email requires explicit opt-in and uses the account's verified GitHub email; the browser cannot supply another recipient. GitHub issue/comment delivery is deferred to keep the App's permissions read-only. Email supplies the separately retried delivery channel required for this slice.

Delivery has its own lease, attempts and retry schedule. A provider failure never schedules another scan. The exact message and idempotency key remain stable across retries. Resend retains idempotency keys for 24 hours; CompatLab stops retrying after 23 hours or sixteen attempts and marks an unconfirmed delivery uncertain. Do not resend uncertain messages automatically. Confirm with the provider before an operator sends a replacement. A request already accepted or in flight cannot be recalled by opting out. Avoid changing provider accounts while deliveries are pending; drain them before such a migration.

Pausing, opting out, revocation and account deletion prevent unstarted delivery. Deleting a monitor or account removes its personal settings, release selections and destinations; public evidence remains. Private alert history is retained thirty days, while release selections preserve deduplication until monitor deletion. Encrypted database backups retain their existing seven-day policy. No email is sent by the test suites: provider HTTP is replaced at its boundary.

References checked October 4, 2026: [npm metadata formats](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Resend email API](https://resend.com/docs/api-reference/emails/send-email), [Better Auth account token selection](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/oauth.mdx).
