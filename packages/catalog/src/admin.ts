import { isDeepStrictEqual } from "node:util";
import { runtimeImageSchema, runtimeMatrixSchema } from "@compatlab/contracts";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { type CatalogDatabase, type CatalogTransaction, catalogTransaction } from "./database.js";
import { auditEvents, blocks, matrices, matrixMembers, reports, runtimeImages } from "./schema.js";
import { type AdminAction, adminActionSchema, revisionSchema, uuidSchema } from "./validation.js";

async function audit(
  tx: CatalogTransaction,
  action: string,
  details: Record<string, unknown>,
  rawActor: AdminAction,
) {
  const actor = adminActionSchema.parse(rawActor);
  await tx.insert(auditEvents).values({ ...actor, action, details });
}
export async function registerRuntime(
  db: CatalogDatabase,
  definition: unknown,
  actor: AdminAction,
): Promise<string> {
  const image = runtimeImageSchema.parse(definition);
  return catalogTransaction(db, async (tx) => {
    const [existing] = await tx
      .select()
      .from(runtimeImages)
      .where(eq(runtimeImages.imageDigest, image.imageId));
    if (existing) {
      if (!isDeepStrictEqual({ ...existing.definition, builtAt: image.builtAt }, image))
        throw new TypeError("The registered image definition differs for the same digest.");
      return existing.id;
    }
    const [created] = await tx
      .insert(runtimeImages)
      .values({
        imageDigest: image.imageId,
        profileId: image.profileId,
        platform: image.platform,
        definition: image,
      })
      .returning({ id: runtimeImages.id });
    if (!created) throw new Error("Runtime registration failed.");
    await audit(tx, "runtime_registered", { imageId: created.id }, actor);
    return created.id;
  });
}
const matrixSchema = z
  .strictObject({
    revision: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    preparationProfile: revisionSchema,
    harnessRevision: revisionSchema,
    planRevision: revisionSchema,
    policyRevision: revisionSchema,
    imageIds: z.array(uuidSchema).min(1).max(16),
  })
  .refine(
    (value) => new Set(value.imageIds).size === value.imageIds.length,
    "Matrix images must be unique.",
  );
export type MatrixDefinition = z.infer<typeof matrixSchema>;
export async function registerMatrix(
  db: CatalogDatabase,
  rawDefinition: MatrixDefinition,
  actor: AdminAction,
): Promise<string> {
  const definition = matrixSchema.parse(rawDefinition);
  return catalogTransaction(db, async (tx) => {
    const selected = await tx
      .select()
      .from(runtimeImages)
      .where(inArray(runtimeImages.id, definition.imageIds));
    const ordered = definition.imageIds.map((id) => {
      const image = selected.find((image) => image.id === id);
      if (image?.state !== "approved")
        throw new TypeError("A matrix requires registered approved images.");
      return image;
    });
    runtimeMatrixSchema.parse(ordered.map((image) => image.definition));
    const { imageIds, ...configuration } = definition;
    const [existing] = await tx
      .select()
      .from(matrices)
      .where(eq(matrices.revision, definition.revision));
    if (existing) {
      const members = await tx
        .select()
        .from(matrixMembers)
        .where(eq(matrixMembers.matrixId, existing.id))
        .orderBy(matrixMembers.position);
      for (const key of Object.keys(configuration) as (keyof typeof configuration)[])
        if (existing[key] !== configuration[key])
          throw new TypeError("Matrix revisions are immutable.");
      if (
        !isDeepStrictEqual(
          members.map((member) => member.imageId),
          imageIds,
        )
      )
        throw new TypeError("Matrix revisions are immutable.");
      return existing.id;
    }
    const [created] = await tx
      .insert(matrices)
      .values({ ...configuration, platform: "linux_amd64_glibc", runtimeCount: ordered.length })
      .returning({ id: matrices.id });
    if (!created) throw new Error("Matrix registration failed.");
    await tx.insert(matrixMembers).values(
      ordered.map((image, position) => ({
        matrixId: created.id,
        position,
        imageId: image.id,
        profileId: image.profileId,
        platform: image.platform,
      })),
    );
    await audit(tx, "matrix_registered", { matrixId: created.id }, actor);
    return created.id;
  });
}
export async function quarantineRuntime(
  db: CatalogDatabase,
  imageId: string,
  actor: AdminAction,
): Promise<void> {
  z.uuid().parse(imageId);
  await catalogTransaction(db, async (tx) => {
    const rows = await tx
      .update(runtimeImages)
      .set({ state: "quarantined" })
      .where(eq(runtimeImages.id, imageId))
      .returning({ id: runtimeImages.id });
    if (!rows.length) throw new TypeError("Runtime image not found.");
    await audit(tx, "runtime_quarantined", { imageId }, actor);
  });
}
export async function invalidateReport(
  db: CatalogDatabase,
  reportId: string,
  actor: AdminAction,
): Promise<void> {
  z.uuid().parse(reportId);
  const action = adminActionSchema.parse(actor);
  await catalogTransaction(db, async (tx) => {
    const rows = await tx
      .update(reports)
      .set({ invalidatedAt: new Date(), invalidationReason: action.reason })
      .where(and(eq(reports.id, reportId), isNull(reports.invalidatedAt)))
      .returning({ id: reports.id });
    if (!rows.length) {
      if (
        !(await tx.select({ id: reports.id }).from(reports).where(eq(reports.id, reportId))).length
      )
        throw new TypeError("Report not found.");
      return;
    }
    await audit(tx, "report_invalidated", { reportId }, action);
  });
}
export async function blockSubject(
  db: CatalogDatabase,
  scope: typeof blocks.$inferInsert.scope,
  subject: string,
  actor: AdminAction,
): Promise<void> {
  z.enum(["package", "artifact", "image", "harness", "probe"]).parse(scope);
  z.string().min(1).max(256).parse(subject);
  const normalizedSubject =
    scope === "artifact" || scope === "image" ? uuidSchema.parse(subject) : subject;
  const action = adminActionSchema.parse(actor);
  await catalogTransaction(db, async (tx) => {
    const rows = await tx
      .insert(blocks)
      .values({ scope, subject: normalizedSubject, ...action })
      .onConflictDoNothing()
      .returning({ id: blocks.id });
    if (rows.length)
      await audit(tx, "subject_blocked", { scope, subject: normalizedSubject }, action);
  });
}
