import type { AssertionBundle } from "@compatlab/contracts";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
export const probeRevisions = pgTable("probe_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id"),
  repositoryLinkId: uuid("repository_link_id"),
  digest: text("digest").notNull(),
  bundle: jsonb("bundle").$type<AssertionBundle>().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
