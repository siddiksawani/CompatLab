import "server-only";
import {
  createMaintainerService,
  createPublicApi,
  initializeTelemetry,
  maintainerConfig,
  openCatalog,
  publicConfigSchema,
  reportControlError,
} from "@compatlab/catalog/web";
import { createEvidenceMcp } from "./mcp";

function initialize() {
  initializeTelemetry();
  const config = publicConfigSchema.parse({
    origin: process.env.PUBLIC_ORIGIN,
    matrixId: process.env.PUBLIC_MATRIX_ID,
    requesterSecret: process.env.REQUESTER_SECRET,
    scansEnabled: process.env.PUBLIC_SCANS_ENABLED === "true",
    ...(process.env.PROXY_SECRET ? { proxySecret: process.env.PROXY_SECRET } : {}),
  });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const catalog = openCatalog(process.env.DATABASE_URL);
  const accountConfig = maintainerConfig(process.env);
  const maintainer = accountConfig
    ? createMaintainerService(catalog.db, config, accountConfig)
    : undefined;
  const api = createPublicApi(catalog.db, config, undefined, maintainer?.quotaKey);
  return {
    catalog,
    config,
    maintainer,
    api,
    mcp: createEvidenceMcp({
      origin: config.origin,
      matrixId: config.matrixId,
      read: (path) => api(new Request(`${config.origin}${path}`)),
      onError: () => reportControlError("mcp_read_failed"),
    }),
  };
}
const state = globalThis as typeof globalThis & { compatlabWeb?: ReturnType<typeof initialize> };
export function webRuntime() {
  if (!state.compatlabWeb) state.compatlabWeb = initialize();
  return state.compatlabWeb;
}
export async function publicRead(path: string) {
  const { api, config } = webRuntime();
  return api(new Request(`${config.origin}${path}`));
}
