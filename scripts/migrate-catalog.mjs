import { migrateCatalog, openCatalog } from "../packages/catalog/dist/index.js";

const address = process.env.DATABASE_URL;
if (!address) throw new Error("Set DATABASE_URL before running catalog migrations.");
const catalog = openCatalog(address);
try {
  await migrateCatalog(catalog.pool);
  process.stdout.write("Catalog migrations applied.\n");
} finally {
  await catalog.close();
}
