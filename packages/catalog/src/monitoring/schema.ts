import type { ReportComparison } from "@compatlab/contracts";
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const identity = () => uuid("id").primaryKey().defaultRandom();
export const monitors = pgTable("monitors", {
  id: identity(),
  userId: uuid("user_id").notNull(),
  repositoryLinkId: uuid("repository_link_id").notNull(),
  packageName: text("package_name").notNull(),
  versionRange: text("version_range").notNull(),
  matrixId: uuid("matrix_id").notNull(),
  rule: text("rule").$type<"regressions_only" | "any_evidence_change">().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  emailEnabled: boolean("email_enabled").notNull().default(false),
  nextPollAt: time("next_poll_at").notNull().defaultNow(),
  leaseToken: uuid("lease_token"),
  leaseExpiresAt: time("lease_expires_at"),
  lastCheckedAt: time("last_checked_at"),
  lastError: text("last_error"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const monitorReleases = pgTable("monitor_releases", {
  id: identity(),
  monitorId: uuid("monitor_id").notNull(),
  version: text("version").notNull(),
  state: text("state").$type<"baseline" | "pending" | "selected" | "blocked">().notNull(),
  scanId: uuid("scan_id"),
  reportId: uuid("report_id"),
  comparedAt: time("compared_at"),
  nextCompareAt: time("next_compare_at").notNull().defaultNow(),
  error: text("error"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const notifications = pgTable("notifications", {
  id: identity(),
  monitorId: uuid("monitor_id").notNull(),
  beforeReportId: uuid("before_report_id").notNull(),
  afterReportId: uuid("after_report_id").notNull(),
  ruleRevision: text("rule_revision").notNull(),
  comparison: jsonb("comparison").$type<ReportComparison>().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: identity(),
  notificationId: uuid("notification_id").notNull(),
  message: text("message").notNull(),
  state: text("state")
    .$type<"pending" | "sending" | "sent" | "failed" | "uncertain" | "cancelled">()
    .notNull()
    .default("pending"),
  attempt: integer("attempt").notNull().default(0),
  nextAttemptAt: time("next_attempt_at").notNull().defaultNow(),
  firstAttemptAt: time("first_attempt_at"),
  leaseToken: uuid("lease_token"),
  leaseExpiresAt: time("lease_expires_at"),
  providerId: text("provider_id"),
  lastError: text("last_error"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export type Monitor = typeof monitors.$inferSelect;
