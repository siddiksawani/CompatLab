import { createHash } from "node:crypto";
import {
  ASSERTION_HARNESS_REVISION,
  assertionManifestSchema,
  assertionPathSchema,
  parseBoundedJson,
} from "@compatlab/contracts";
import { validateAssertionBundle } from "@compatlab/engine";
import { z } from "zod";
import { githubJson } from "../auth/github.js";
export class AssertionSourceError extends Error {}
export const assertionSourceRequestSchema = z.strictObject({
  repositoryLinkId: z.uuid(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  manifestPath: assertionPathSchema,
});
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const treeSchema = z.object({
  sha,
  truncated: z.boolean(),
  tree: z
    .array(
      z.object({
        path: z.string(),
        mode: z.string(),
        type: z.string(),
        sha,
        size: z.number().optional(),
      }),
    )
    .max(10000),
});
export async function fetchAssertionBundle(
  repository: string,
  commit: string,
  manifestPath: string,
  token: string,
  fetcher = fetch,
) {
  z.string()
    .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/)
    .parse(repository);
  sha.parse(commit);
  assertionPathSchema.parse(manifestPath);
  const deadline = AbortSignal.timeout(60000);
  let calls = 0;
  const request = async (path: string) => {
    if (++calls > 64) throw new AssertionSourceError("Assertion source request limit exceeded.");
    return githubJson(`/repos/${repository}/git/${path}`, token, (url, init) =>
      fetcher(url, {
        ...init,
        signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]),
      }),
    );
  };
  const revision = z
    .object({ sha, tree: z.object({ sha }) })
    .parse(await request(`commits/${commit}`));
  if (revision.sha !== commit) throw new AssertionSourceError("GitHub commit changed.");
  const trees = new Map<string, z.infer<typeof treeSchema>>();
  async function file(path: string, limit: number) {
    const segments = assertionPathSchema.parse(path).split("/");
    let treeId = revision.tree.sha;
    for (const [index, part] of segments.entries()) {
      let tree = trees.get(treeId);
      if (!tree) {
        tree = treeSchema.parse(await request(`trees/${treeId}`));
        trees.set(treeId, tree);
      }
      if (tree.sha !== treeId || tree.truncated)
        throw new AssertionSourceError("Incomplete Git tree.");
      const matches = tree.tree.filter((entry) => entry.path === part),
        entry = matches[0];
      if (matches.length !== 1 || !entry)
        throw new AssertionSourceError("Source path is missing or ambiguous.");
      if (index < segments.length - 1) {
        if (entry.type !== "tree" || entry.mode !== "040000")
          throw new AssertionSourceError("Source path is not a directory.");
        treeId = entry.sha;
        continue;
      }
      if (
        entry.type !== "blob" ||
        !["100644", "100755"].includes(entry.mode) ||
        entry.size === undefined ||
        entry.size > limit
      )
        throw new AssertionSourceError("Only bounded regular Git blobs are accepted.");
      const blob = z
        .object({
          sha,
          encoding: z.literal("base64"),
          size: z.number().int().nonnegative().max(limit),
          content: z.string().max(750000),
        })
        .parse(await request(`blobs/${entry.sha}`));
      const base64 = blob.content.replace(/[\r\n]/g, ""),
        bytes = Buffer.from(base64, "base64");
      if (
        blob.sha !== entry.sha ||
        bytes.length !== blob.size ||
        bytes.length !== entry.size ||
        bytes.toString("base64") !== base64 ||
        createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== blob.sha
      )
        throw new AssertionSourceError("Git blob identity mismatch.");
      return {
        path,
        gitBlobSha: blob.sha,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        base64,
      };
    }
    throw new AssertionSourceError("Source path is missing.");
  }
  const manifestFile = await file(manifestPath, 16384);
  const manifest = assertionManifestSchema.parse(
    parseBoundedJson(Buffer.from(manifestFile.base64, "base64"), 16384),
  );
  const files = [];
  let bytes = 0;
  for (const path of [manifest.entry, ...manifest.fixtures]) {
    const entry = await file(path, path === manifest.entry ? 65536 : 524288);
    bytes += Buffer.from(entry.base64, "base64").length;
    if (bytes > 2 * 1024 ** 2) throw new AssertionSourceError("Assertion bundle exceeds 2 MiB.");
    files.push(entry);
  }
  try {
    return validateAssertionBundle({
      schemaVersion: 1,
      harnessRevision: ASSERTION_HARNESS_REVISION,
      policyRevision: "runtime_limits_v2",
      repository,
      commit,
      tree: revision.tree.sha,
      manifestPath,
      manifest,
      files,
    });
  } catch (error) {
    if (error instanceof TypeError) throw new AssertionSourceError(error.message);
    throw error;
  }
}
