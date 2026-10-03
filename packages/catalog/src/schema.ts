import type { JobState, ProbePlan, RuntimeImage, ScanState } from "@compatlab/contracts";
import {
  boolean,
  customType,
  integer,
  json,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const identity = () => uuid("id").primaryKey().defaultRandom();
const created = () => time("created_at").notNull().defaultNow();

export const packages = pgTable("packages", {
  id: identity(),
  name: text("name").notNull(),
  createdAt: created(),
});
export const packageVersions = pgTable("package_versions", {
  id: identity(),
  packageId: uuid("package_id").notNull(),
  version: text("version").notNull(),
  integrity: text("integrity").notNull(),
  tarballUrl: text("tarball_url").notNull(),
  manifest: json("manifest").$type<Record<string, unknown>>().notNull(),
  observedTags: jsonb("observed_tags").$type<Record<string, string>>().notNull().default({}),
  tagsObservedAt: time("tags_observed_at"),
  integrityAnomaly: boolean("integrity_anomaly").notNull().default(false),
  observedAt: time("observed_at").notNull().defaultNow(),
});
export const workers = pgTable("workers", {
  id: identity(),
  tokenHash: text("token_hash").notNull(),
  capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull(),
  state: text("state").$type<"healthy" | "drained" | "quarantined">().notNull().default("drained"),
  capacity: integer("capacity").notNull(),
  sessionId: uuid("session_id"),
  recoveryRequired: boolean("recovery_required").notNull().default(true),
  revokedAt: time("revoked_at"),
  lastSeenAt: time("last_seen_at"),
  createdAt: created(),
});
export const preparations = pgTable("preparations", {
  id: identity(),
  artifactId: uuid("artifact_id").notNull(),
  profileRevision: text("profile_revision").notNull(),
  platform: text("platform").notNull(),
  resolutionGeneration: uuid("resolution_generation").notNull().defaultRandom(),
  state: text("state")
    .$type<"pending" | "preparing" | "ready" | "rejected" | "failed_infrastructure">()
    .notNull()
    .default("pending"),
  lockBytes: bytes("lock_bytes"),
  lockDigest: text("lock_digest"),
  snapshotGeneration: uuid("snapshot_generation"),
  snapshotId: uuid("snapshot_id"),
  installerImage: text("installer_image"),
  installedManifest: json("installed_manifest").$type<Record<string, unknown>>(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  treeDigest: text("tree_digest"),
  ownerWorkerId: uuid("owner_worker_id"),
  snapshotAvailable: boolean("snapshot_available").notNull().default(false),
  diagnostics: jsonb("diagnostics").$type<Record<string, unknown>>(),
  createdAt: created(),
});
export const runtimeImages = pgTable("runtime_images", {
  id: identity(),
  imageDigest: text("image_digest").notNull(),
  profileId: text("profile_id").notNull(),
  platform: text("platform").notNull(),
  definition: jsonb("definition").$type<RuntimeImage>().notNull(),
  state: text("state").$type<"approved" | "quarantined">().notNull().default("approved"),
  createdAt: created(),
});
export const matrices = pgTable("matrices", {
  id: identity(),
  revision: text("revision").notNull(),
  platform: text("platform").notNull(),
  preparationProfile: text("preparation_profile").notNull(),
  harnessRevision: text("harness_revision").notNull(),
  planRevision: text("plan_revision").notNull(),
  policyRevision: text("policy_revision").notNull(),
  runtimeCount: integer("runtime_count").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: created(),
});
export const matrixMembers = pgTable("matrix_members", {
  matrixId: uuid("matrix_id").notNull(),
  position: integer("position").notNull(),
  imageId: uuid("image_id").notNull(),
  profileId: text("profile_id").notNull(),
  platform: text("platform").notNull(),
});
export const scans = pgTable("scans", {
  id: identity(),
  preparationId: uuid("preparation_id").notNull(),
  matrixId: uuid("matrix_id").notNull(),
  state: text("state").$type<ScanState>().notNull().default("requested"),
  requesterKey: text("requester_key"),
  requesterExpiresAt: time("requester_expires_at").notNull(),
  admissionPolicy: text("admission_policy").notNull(),
  progressRevision: integer("progress_revision").notNull().default(0),
  plan: jsonb("plan").$type<ProbePlan>(),
  diagnostics: jsonb("diagnostics").$type<Record<string, unknown>>(),
  requestedAt: time("requested_at").notNull().defaultNow(),
  startedAt: time("started_at"),
  deadlineAt: time("deadline_at"),
  finishedAt: time("finished_at"),
});
export const runs = pgTable("runs", {
  id: identity(),
  scanId: uuid("scan_id").notNull(),
  matrixId: uuid("matrix_id").notNull(),
  imageId: uuid("image_id").notNull(),
  probeGroup: text("probe_group").$type<"root" | "subpaths">().notNull(),
  mode: text("mode").$type<"esm" | "commonjs">().notNull(),
  rawEvidence: jsonb("raw_evidence").$type<Record<string, unknown>>(),
  logs: jsonb("logs").$type<Record<string, unknown>>(),
  logsExpireAt: time("logs_expire_at"),
  createdAt: created(),
});
export const jobs = pgTable("jobs", {
  id: identity(),
  kind: text("kind").$type<"preparation" | "run" | "aggregation">().notNull(),
  scanId: uuid("scan_id").notNull(),
  preparationId: uuid("preparation_id"),
  runId: uuid("run_id"),
  state: text("state").$type<JobState>().notNull().default("queued"),
  availableAt: time("available_at").notNull().defaultNow(),
  attempt: integer("attempt").notNull().default(0),
  attemptToken: uuid("attempt_token"),
  sessionId: uuid("session_id"),
  cleanupRequired: boolean("cleanup_required").notNull().default(false),
  workerId: uuid("worker_id"),
  leaseExpiresAt: time("lease_expires_at"),
  deadlineAt: time("deadline_at"),
  resultDigest: text("result_digest"),
  attemptSummary: jsonb("attempt_summary").$type<Record<string, unknown>>(),
  createdAt: created(),
});
export const reports = pgTable("reports", {
  id: identity(),
  scanId: uuid("scan_id").notNull(),
  classifierRevision: text("classifier_revision").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  invalidatedAt: time("invalidated_at"),
  invalidationReason: text("invalidation_reason"),
  replacedBy: uuid("replaced_by"),
  createdAt: created(),
});
export const blocks = pgTable("blocks", {
  id: identity(),
  scope: text("scope").$type<"package" | "artifact" | "image" | "harness" | "probe">().notNull(),
  subject: text("subject").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  createdAt: created(),
  revokedAt: time("revoked_at"),
});
export const auditEvents = pgTable("audit_events", {
  id: identity(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  createdAt: created(),
});
