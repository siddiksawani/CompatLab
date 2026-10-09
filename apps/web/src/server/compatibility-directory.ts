import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { compatibilityDirectory } from "./discovery";

export type DirectoryProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export const directoryPath = (failures: boolean) =>
  `/npm/compatibility${failures ? "/failures" : ""}`;
export const directoryTitle = (failures: boolean) =>
  failures
    ? "npm loading failures in Node.js, Bun and Deno"
    : "Node.js vs Bun vs Deno: npm package compatibility";

const read = cache(compatibilityDirectory);
export async function loadDirectory(props: DirectoryProps, failures = false) {
  const params = await props.searchParams;
  const parsed = z
    .strictObject({
      after: z
        .uuid()
        .regex(/^[a-f0-9-]+$/)
        .optional(),
      runtime: z.enum(["node", "bun", "deno"]).optional(),
    })
    .safeParse(params);
  if (!parsed.success || (!failures && parsed.data.runtime)) notFound();
  const { after, runtime } = parsed.data;
  const page = await read(after, failures ? (runtime ?? "any") : undefined);
  if (after && !page.entries.length) notFound();
  const query = new URLSearchParams({
    ...(runtime ? { runtime } : {}),
    ...(after ? { after } : {}),
  });
  return {
    ...page,
    after,
    runtime,
    path: directoryPath(failures) + (query.size ? `?${query}` : ""),
  };
}
