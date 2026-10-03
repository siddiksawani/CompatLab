import { writeFile } from "node:fs/promises";
import {
  compareMonitorReports,
  createMaintainerService,
  deliverNotification,
  emailConfigSchema,
  initializeTelemetry,
  maintainerConfig,
  openCatalog,
  pollMonitor,
  publicConfigSchema,
  reportControlError,
  retainNotifications,
} from "@compatlab/catalog";

const accountConfig = maintainerConfig(process.env);
if (!accountConfig || !process.env.DATABASE_URL)
  throw new Error(
    "Configure maintainer authentication and DATABASE_URL before starting the scheduler.",
  );
const config = publicConfigSchema.parse({
  origin: process.env.PUBLIC_ORIGIN,
  matrixId: process.env.PUBLIC_MATRIX_ID,
  requesterSecret: process.env.REQUESTER_SECRET,
  scansEnabled: process.env.PUBLIC_SCANS_ENABLED === "true",
  ...(process.env.PROXY_SECRET ? { proxySecret: process.env.PROXY_SECRET } : {}),
});
const email = accountConfig.emailEnabled
  ? emailConfigSchema.parse({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.NOTIFICATION_FROM,
    })
  : undefined;
const catalog = openCatalog(process.env.DATABASE_URL),
  auth = createMaintainerService(catalog.db, config, accountConfig);
initializeTelemetry();
let stopping = false,
  timer: NodeJS.Timeout | undefined;
let work: Promise<void> = Promise.resolve();
async function tick() {
  for (const task of [
    () => pollMonitor(catalog.db, config, auth.authorizeLink),
    () => compareMonitorReports(catalog.db, config.origin, auth.authorizeLink, email?.from),
    () =>
      email ? deliverNotification(catalog.db, email, auth.authorizeLink) : Promise.resolve(false),
    () => retainNotifications(catalog.db),
  ]) {
    if (stopping) break;
    await task().catch(() => reportControlError("monitoring_failed"));
  }
  await writeFile("/tmp/compatlab-maintainer-health", String(Date.now()), { mode: 0o600 });
}
function schedule() {
  timer = setTimeout(() => {
    work = tick()
      .catch(() => reportControlError("monitoring_failed"))
      .finally(() => {
        if (!stopping) schedule();
      });
  }, 2000);
}
async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  await work;
  await catalog.close();
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
schedule();
