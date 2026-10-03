import { z } from "zod";

export const runtimeKindSchema = z.enum(["node", "bun", "deno"]);
export const imageDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const runtimeImageSchema = z.strictObject({
  profileId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  kind: runtimeKindSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  imageId: imageDigestSchema,
  builtAt: z.iso.datetime(),
  sourceImage: z
    .string()
    .max(256)
    .regex(/@sha256:[a-f0-9]{64}$/),
  baseImage: z
    .string()
    .max(256)
    .regex(/@sha256:[a-f0-9]{64}$/),
  platform: z.literal("linux_amd64_glibc"),
  recipeRevision: z.literal("runtime_image_v1"),
});
export const runtimeMatrixSchema = z
  .array(runtimeImageSchema)
  .min(1)
  .max(16)
  .superRefine((images, context) => {
    if (new Set(images.map((image) => image.profileId)).size !== images.length)
      context.addIssue({ code: "custom", message: "Runtime profile IDs must be unique." });
    if (new Set(images.map((image) => image.imageId)).size !== images.length)
      context.addIssue({
        code: "custom",
        message: "A runtime image can appear only once in a matrix.",
      });
  });
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;
export type RuntimeImage = z.infer<typeof runtimeImageSchema>;
