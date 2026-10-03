import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type CatalogDatabase, catalogTransaction } from "../database.js";
import { PublicRequestError } from "../public/security.js";
import { assertLinkedAuthority } from "./authority.js";
import type { AuthorizeMonitor } from "./poll.js";
import { notificationDeliveries } from "./schema.js";
export const emailConfigSchema = z.strictObject({
  apiKey: z.string().min(20).max(256),
  from: z.email().max(254),
});
export type EmailConfig = z.infer<typeof emailConfigSchema>;
const messageSchema = z.strictObject({
  from: z.email(),
  to: z.array(z.email()).length(1),
  subject: z.string().max(512),
  text: z.string().max(12000),
});
export async function deliverNotification(
  db: CatalogDatabase,
  config: EmailConfig,
  authorize: AuthorizeMonitor,
  fetcher = fetch,
) {
  emailConfigSchema.parse(config);
  const token = randomUUID();
  const claimed = await catalogTransaction(db, async (tx) => {
    await tx.execute(
      sql`UPDATE notification_deliveries SET state='uncertain',last_error='retry_window_expired',lease_token=NULL,lease_expires_at=NULL WHERE id IN (SELECT id FROM notification_deliveries WHERE state IN ('pending','sending') AND first_attempt_at<=clock_timestamp()-interval '23 hours' LIMIT 100)`,
    );
    await tx.execute(
      sql`UPDATE notification_deliveries SET state='uncertain',last_error='attempts_exhausted',lease_token=NULL,lease_expires_at=NULL WHERE id IN (SELECT id FROM notification_deliveries WHERE state IN ('pending','sending') AND attempt>=16 AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) LIMIT 100)`,
    );
    const candidate = (
      await tx.execute<{ id: string; userId: string; linkId: string }>(
        sql`SELECT d.id,m.user_id AS "userId",m.repository_link_id AS "linkId" FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN monitors m ON m.id=n.monitor_id WHERE d.state IN ('pending','sending') AND d.next_attempt_at<=clock_timestamp() AND (d.lease_expires_at IS NULL OR d.lease_expires_at<=clock_timestamp()) ORDER BY d.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!candidate) return null;
    await tx
      .update(notificationDeliveries)
      .set({
        state: "sending",
        leaseToken: token,
        leaseExpiresAt: sql`clock_timestamp()+interval '30 seconds'`,
      })
      .where(eq(notificationDeliveries.id, candidate.id));
    return candidate;
  });
  if (!claimed) return false;
  let state: "pending" | "sent" | "failed" | "uncertain" | "cancelled" = "pending",
    error: string | null = null,
    providerId: string | null = null,
    retrySeconds = 30;
  let attempted = 0;
  try {
    const authority = await authorize(claimed.userId, claimed.linkId);
    const delivery = await catalogTransaction(db, async (tx) => {
      await assertLinkedAuthority(tx, authority);
      const row = (
        await tx.execute<{ message: string; attempt: number }>(
          sql`SELECT d.message,d.attempt FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN monitors m ON m.id=n.monitor_id JOIN auth_users u ON u.id=m.user_id WHERE d.id=${claimed.id} AND d.lease_token=${token} AND d.lease_expires_at>clock_timestamp() AND m.enabled AND m.email_enabled AND u.email_verified AND (d.message::jsonb->'to'->>0)=u.email AND (d.first_attempt_at IS NULL OR d.first_attempt_at>clock_timestamp()-interval '23 hours')`,
        )
      ).rows[0];
      if (!row) return null;
      if (row.attempt >= 16) return null;
      await tx
        .update(notificationDeliveries)
        .set({
          attempt: sql`attempt+1`,
          firstAttemptAt: sql`coalesce(first_attempt_at,clock_timestamp())`,
        })
        .where(eq(notificationDeliveries.id, claimed.id));
      return row;
    });
    if (!delivery) {
      state = "cancelled";
      error = "destination_or_settings_changed";
    } else {
      attempted = delivery.attempt + 1;
      messageSchema.parse(JSON.parse(delivery.message));
      retrySeconds = Math.min(1800, 30 * 2 ** delivery.attempt);
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `compatlab/${claimed.id}`,
        },
        body: delivery.message,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      try {
        if (response.ok) {
          const reader = response.body?.getReader();
          if (!reader) throw new Error("Empty provider response.");
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const item = await reader.read();
              if (item.done) break;
              size += item.value.length;
              if (size > 16384) throw new Error("Provider response too large.");
              chunks.push(item.value);
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          providerId = z
            .object({ id: z.uuid() })
            .parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))).id;
          state = "sent";
        } else if ([409, 429].includes(response.status) || response.status >= 500) {
          error = "provider_retry";
          const wait = Number(response.headers.get("retry-after"));
          if (Number.isFinite(wait) && wait > 0)
            retrySeconds = Math.min(3600, Math.max(retrySeconds, wait));
        } else {
          state = "failed";
          error = "provider_rejected";
        }
      } finally {
        await response.body?.cancel().catch(() => {});
      }
      if (state === "pending" && delivery.attempt >= 15) {
        state = "uncertain";
        error = "attempts_exhausted";
      }
    }
  } catch (cause) {
    state =
      attempted >= 16
        ? "uncertain"
        : cause instanceof PublicRequestError && cause.status === 403
          ? "cancelled"
          : "pending";
    error = "delivery_unconfirmed";
  }
  await db
    .update(notificationDeliveries)
    .set({
      state,
      lastError: error,
      providerId,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: sql`clock_timestamp()+${retrySeconds}*interval '1 second'`,
    })
    .where(
      and(eq(notificationDeliveries.id, claimed.id), eq(notificationDeliveries.leaseToken, token)),
    );
  return true;
}
export async function retainNotifications(db: CatalogDatabase) {
  await db.execute(
    sql`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE created_at<clock_timestamp()-interval '30 days' LIMIT 1000)`,
  );
}
