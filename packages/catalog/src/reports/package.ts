import { assertPackageName, isExactVersion } from "@compatlab/engine";
import type { CatalogReader } from "../database.js";
import { selectPackageEvidence } from "../public/discovery.js";

export async function findPackageReport(
  db: CatalogReader,
  matrixId: string,
  name: string,
  version: string,
) {
  assertPackageName(name);
  if (!isExactVersion(version)) throw new TypeError("Expected an exact package version.");
  const [selection] = await selectPackageEvidence(db, matrixId, [{ name, version }]);
  return selection?.availableReport ?? null;
}
