import { lstat, open, statfs } from "node:fs/promises";
import { userInfo } from "node:os";
import { parseArgs } from "node:util";
import {
  applyRetention,
  approveRuntime,
  auditBackup,
  blockSubject,
  cancelScan,
  invalidateReport,
  migrateCatalog,
  openCatalog,
  operationStatus,
  quarantineRuntime,
  reclassifyScan,
  registerMatrix,
  registerRuntime,
  registerWorker,
  removeScanLogs,
  retireWorker,
  retryInfrastructure,
  revokeBlock,
  setAdmissionPaused,
  setMatrixEnabled,
  setWorkerState,
} from "@compatlab/catalog";
import { z } from "zod";

export const adminUsage = `Usage: compatlab admin status | migrate | retention
       compatlab admin pause | resume
       compatlab admin worker-register capabilities.json
       compatlab admin worker-drain | worker-resume | worker-quarantine | worker-revoke UUID
       compatlab admin worker-retire UUID --confirm-host-destroyed
       compatlab admin runtime-register image.json | matrix-register matrix.json
       compatlab admin runtime-approve | runtime-quarantine | matrix-enable | matrix-disable UUID
       compatlab admin block package|artifact|image|harness|probe SUBJECT
       compatlab admin unblock | cancel | retry | invalidate | reclassify | remove-logs UUID
       compatlab admin host-status PATH

Mutations require --reason TEXT. Database commands read ADMIN_DATABASE_URL_FILE,
a private operator-owned credential file available only through SSH or a local operator shell.
Worker registration prints its one-time token; save the output privately.
Cancellation during preparation cancels all scans sharing that unfinished preparation.
`;
const counts: Record<string, number> = {
  status: 0,
  migrate: 0,
  retention: 0,
  pause: 0,
  resume: 0,
  "worker-register": 1,
  "worker-drain": 1,
  "worker-resume": 1,
  "worker-quarantine": 1,
  "worker-revoke": 1,
  "runtime-register": 1,
  "matrix-register": 1,
  "runtime-approve": 1,
  "runtime-quarantine": 1,
  "matrix-enable": 1,
  "matrix-disable": 1,
  block: 2,
  unblock: 1,
  cancel: 1,
  retry: 1,
  invalidate: 1,
  reclassify: 1,
  "host-status": 1,
  "backup-record": 2,
  "worker-retire": 1,
  "remove-logs": 1,
};
export async function runAdmin(
  args: readonly string[],
  io: { stdout(text: string): void; stderr(text: string): void },
) {
  if (args.length === 1 && args[0] === "--help") {
    io.stdout(adminUsage);
    return 0;
  }
  let command: string, positionals: string[], reason: string;
  try {
    const parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        reason: { type: "string" },
        json: { type: "boolean" },
        "confirm-host-destroyed": { type: "boolean" },
      },
    });
    command = parsed.positionals[0] ?? "";
    positionals = parsed.positionals.slice(1);
    if ((command === "worker-retire") !== !!parsed.values["confirm-host-destroyed"])
      throw new TypeError();
    if (!Object.hasOwn(counts, command) || counts[command] !== positionals.length)
      throw new TypeError();
    reason =
      command === "status" || command === "host-status"
        ? "Read-only operator inspection."
        : z.string().trim().min(1).max(1024).parse(parsed.values.reason);
  } catch {
    io.stderr(adminUsage);
    return 2;
  }
  const actor = { actor: `ssh:${userInfo().username}`, reason };
  let catalog: ReturnType<typeof openCatalog> | undefined;
  try {
    if (command === "host-status") {
      const disk = await statfs(positionals[0] ?? "", { bigint: true });
      io.stdout(
        `${JSON.stringify({ schemaVersion: 1, availableBytes: String(disk.bavail * disk.bsize), totalBytes: String(disk.blocks * disk.bsize), freeInodes: String(disk.ffree) })}\n`,
      );
      return disk.bavail * disk.bsize < 4n * 1024n ** 3n ? 1 : 0;
    }
    const credential = process.env.ADMIN_DATABASE_URL_FILE;
    if (!credential) throw new TypeError("ADMIN_DATABASE_URL_FILE is required.");
    const info = await lstat(credential);
    if (!info.isFile() || ![0, process.getuid?.()].includes(info.uid) || (info.mode & 0o077) !== 0)
      throw new TypeError("The operator credential must be a private, owned regular file.");
    const url = z.url().parse((await readSmallFile(credential, 4096)).trim());
    if (!["postgres:", "postgresql:"].includes(new URL(url).protocol))
      throw new TypeError("Invalid database protocol.");
    catalog = openCatalog(url);
    const db = catalog.db,
      id = positionals[0] ?? "";
    let result: unknown = { ok: true };
    switch (command) {
      case "status":
        result = await operationStatus(db);
        break;
      case "migrate":
        await migrateCatalog(catalog.pool);
        break;
      case "pause":
      case "resume":
        await setAdmissionPaused(db, command === "pause", actor);
        break;
      case "retention":
        result = await applyRetention(db, actor);
        break;
      case "backup-record":
        await auditBackup(db, id, Number(positionals[1]), actor);
        break;
      case "worker-register": {
        const input = z
          .object({ capabilities: z.unknown(), capacity: z.number().int().min(1).max(3) })
          .parse(await jsonFile(id));
        result = await registerWorker(db, input.capabilities, input.capacity, actor);
        break;
      }
      case "worker-drain":
      case "worker-resume":
      case "worker-quarantine":
      case "worker-revoke":
        await setWorkerState(
          db,
          id,
          z.enum(["drain", "resume", "quarantine", "revoke"]).parse(command.slice(7)),
          actor,
        );
        break;
      case "worker-retire":
        await retireWorker(db, id, actor);
        break;
      case "runtime-register":
        result = { imageId: await registerRuntime(db, await jsonFile(id), actor) };
        break;
      case "matrix-register":
        result = {
          matrixId: await registerMatrix(
            db,
            (await jsonFile(id)) as Parameters<typeof registerMatrix>[1],
            actor,
          ),
        };
        break;
      case "runtime-approve":
        await approveRuntime(db, id, actor);
        break;
      case "runtime-quarantine":
        await quarantineRuntime(db, id, actor);
        break;
      case "matrix-enable":
      case "matrix-disable":
        await setMatrixEnabled(db, id, command === "matrix-enable", actor);
        break;
      case "block":
        await blockSubject(
          db,
          z.enum(["package", "artifact", "image", "harness", "probe"]).parse(id),
          positionals[1] ?? "",
          actor,
        );
        break;
      case "unblock":
        await revokeBlock(db, id, actor);
        break;
      case "cancel":
        result = await cancelScan(db, id, actor);
        break;
      case "retry":
        result = await retryInfrastructure(db, id, actor);
        break;
      case "invalidate":
        await invalidateReport(db, id, actor);
        break;
      case "reclassify":
        result = await reclassifyScan(db, id, actor);
        break;
      case "remove-logs":
        result = await removeScanLogs(db, id, actor);
        break;
    }
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    io.stderr(
      `${error instanceof TypeError ? error.message : "Operator command failed; check the protected service logs."}\n`,
    );
    return 3;
  } finally {
    await catalog?.close();
  }
}
export async function readSmallFile(path: string, limit: number) {
  const file = await open(path, "r");
  try {
    const bytes = Buffer.alloc(limit + 1);
    const result = await file.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead > limit) throw new TypeError("Operator input exceeds its size limit.");
    return bytes.subarray(0, result.bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}
async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readSmallFile(path, 256 * 1024));
}
