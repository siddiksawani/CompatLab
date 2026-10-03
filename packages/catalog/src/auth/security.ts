import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { CatalogDatabase } from "../database.js";
import { PublicRequestError } from "../public/security.js";

export const maintainerConfigSchema = z.strictObject({
  emailEnabled: z.boolean().optional(),
  secret: z.string().regex(/^[a-f0-9]{64}$/),
  githubClientId: z.string().regex(/^[A-Za-z0-9._-]{8,100}$/),
  githubClientSecret: z.string().min(20).max(256),
  githubAppId: z.string().regex(/^[1-9][0-9]{0,15}$/),
  githubAppSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
  githubWebhookSecret: z.string().regex(/^[a-f0-9]{64}$/),
});
export type MaintainerConfig = z.infer<typeof maintainerConfigSchema>;
export function maintainerConfig(environment: NodeJS.ProcessEnv): MaintainerConfig | undefined {
  if (environment.MAINTAINER_AUTH_ENABLED !== "true") return undefined;
  return maintainerConfigSchema.parse({
    emailEnabled: environment.MAINTAINER_EMAIL_ENABLED === "true",
    secret: environment.AUTH_SECRET,
    githubClientId: environment.GITHUB_CLIENT_ID,
    githubClientSecret: environment.GITHUB_CLIENT_SECRET,
    githubAppId: environment.GITHUB_APP_ID,
    githubAppSlug: environment.GITHUB_APP_SLUG,
    githubWebhookSecret: environment.GITHUB_WEBHOOK_SECRET,
  });
}
export function accountRequesterKey(secret: string, githubId: string) {
  return createHmac("sha256", secret).update(`github-account:${githubId}`).digest("hex");
}
export async function takeRequestBudget(db: CatalogDatabase, key: string, limit: number) {
  const result = await db.execute(sql`
    INSERT INTO request_buckets(key,window_start,hits,expires_at)
    VALUES(${key},date_bin('10 minutes',clock_timestamp(),'2000-01-01'::timestamptz),1,clock_timestamp()+interval '20 minutes')
    ON CONFLICT(key) DO UPDATE SET
      window_start=EXCLUDED.window_start,
      hits=CASE WHEN request_buckets.window_start=EXCLUDED.window_start THEN request_buckets.hits+1 ELSE 1 END,
      expires_at=EXCLUDED.expires_at
    WHERE request_buckets.window_start<>EXCLUDED.window_start OR request_buckets.hits<${limit}
    RETURNING key
  `);
  if (!result.rows.length) throw new PublicRequestError(429, "request_limit");
}
export async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new PublicRequestError(413, "body_too_large");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const deadline = AbortSignal.timeout(5000);
  const expired = () => {
    void reader.cancel();
  };
  deadline.addEventListener("abort", expired, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (deadline.aborted) throw new PublicRequestError(408, "body_timeout");
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new PublicRequestError(413, "body_too_large");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    deadline.removeEventListener("abort", expired);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function privateJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(status === 429 ? { "retry-after": "600" } : {}),
    },
  });
}
