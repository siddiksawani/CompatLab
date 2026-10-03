import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { type CatalogDatabase, catalogTransaction } from "../database.js";
import { PublicRequestError } from "../public/security.js";
import { boundedBody } from "./security.js";

const id = z.number().int().positive().safe();
const eventSchema = z.object({
  action: z.string().max(50),
  sender: z.object({ id }).optional(),
  installation: z.object({ id, app_id: id }).optional(),
  repositories_removed: z.array(z.object({ id })).max(1000).optional(),
});
export async function receiveGithubWebhook(
  db: CatalogDatabase,
  request: Request,
  secret: string,
  appId: string,
) {
  const bytes = await boundedBody(request, 1024 * 1024);
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(bytes).digest("hex")}`;
  if (
    !/^sha256=[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new PublicRequestError(403, "invalid_webhook_signature");
  const delivery = z.uuid().parse(request.headers.get("x-github-delivery"));
  const event = request.headers.get("x-github-event");
  if (
    !["github_app_authorization", "installation", "installation_repositories"].includes(event ?? "")
  )
    return;
  const body = eventSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (body.installation && String(body.installation.app_id) !== appId)
    throw new PublicRequestError(403, "wrong_github_app");
  await catalogTransaction(db, async (tx) => {
    const inserted = await tx.execute(
      sql`INSERT INTO github_deliveries(id) VALUES(${delivery}) ON CONFLICT DO NOTHING RETURNING id`,
    );
    if (!inserted.rows.length) return;
    if (event === "github_app_authorization" && body.action === "revoked") {
      if (!body.sender) throw new PublicRequestError(400, "missing_sender");
      const users = sql`SELECT user_id FROM auth_accounts WHERE provider_id='github' AND account_id=${String(body.sender.id)}`;
      await tx.execute(
        sql`UPDATE repository_links SET revoked_at=clock_timestamp() WHERE user_id IN (${users})`,
      );
      await tx.execute(sql`DELETE FROM auth_sessions WHERE user_id IN (${users})`);
      await tx.execute(
        sql`UPDATE auth_accounts SET access_token=NULL,refresh_token=NULL,id_token=NULL WHERE user_id IN (${users})`,
      );
    } else if (event === "installation" && ["deleted", "suspend"].includes(body.action)) {
      if (!body.installation) throw new PublicRequestError(400, "missing_installation");
      await tx.execute(
        sql`UPDATE repository_links SET revoked_at=clock_timestamp() WHERE installation_id=${String(body.installation.id)}`,
      );
    } else if (event === "installation_repositories" && body.action === "removed") {
      if (!body.installation || !body.repositories_removed)
        throw new PublicRequestError(400, "missing_repositories");
      if (body.repositories_removed.length)
        await tx.execute(
          sql`UPDATE repository_links SET revoked_at=clock_timestamp() WHERE installation_id=${String(body.installation.id)} AND repository_id IN (${sql.join(
            body.repositories_removed.map((repository) => sql`${String(repository.id)}`),
            sql`,`,
          )})`,
        );
    }
    await tx.execute(sql`UPDATE auth_authority_state SET revision=revision+1 WHERE singleton`);
  });
}
