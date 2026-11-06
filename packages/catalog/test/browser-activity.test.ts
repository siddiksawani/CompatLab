import { activityPage, activitySource, browserActivitySchema } from "@compatlab/contracts";
import { expect, it, vi } from "vitest";
import { createBrowserActivityApi } from "../src/public/browser-activity.js";

const config = {
  origin: "http://localhost:3000",
  matrixId: "00000000-0000-4000-8000-000000000001",
  requesterSecret: "a".repeat(64),
  scansEnabled: false,
};
const event = {
  actions: ["page_view", "search"],
  page: "home",
  source: "github",
  research: true,
  automated: false,
};
function request(body: unknown = event, headers: Record<string, string> = {}) {
  return new Request(`${config.origin}/api/v1/browser-activity`, {
    method: "POST",
    headers: { origin: config.origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
it("accepts only coarse categories and strips private referrers before transport", () => {
  expect(browserActivitySchema.parse(event)).toEqual(event);
  for (const body of [
    { ...event, query: "private search" },
    { ...event, reportId: "secret" },
    { ...event, source: "private.example" },
    { ...event, actions: ["search", "search"] },
    { ...event, actions: ["share_copied"] },
    { ...event, actions: [] },
  ])
    expect(browserActivitySchema.safeParse(body).success).toBe(false);
  expect(activitySource("https://github.com/private?token=secret", config.origin)).toBe("github");
  expect(activitySource("https://github.com.evil.example", config.origin)).toBe("other");
  expect(activityPage("/npm/@scope/pkg/1.0.0")).toBe("package");
  expect(activityPage("/npm/compatibility")).toBe("other");
  expect(activityPage("/npm/compatibility/failures")).toBe("other");
  expect(activityPage("/npm/compatibility/1.0.0")).toBe("package");
  expect(activityPage("/npm/compatibility-check/1.0.0")).toBe("package");
});
it("validates same-origin JSON, honors privacy signals and flags detectable automation", async () => {
  const record = vi.fn(async () => {});
  const api = createBrowserActivityApi(config, record);
  expect((await api(request(event, { "user-agent": "HeadlessChrome" }))).status).toBe(204);
  expect(record).toHaveBeenCalledWith({ ...event, automated: true });
  record.mockClear();
  for (const header of ["dnt", "sec-gpc"])
    expect((await api(request(event, { [header]: "1" }))).status).toBe(204);
  expect(record).not.toHaveBeenCalled();
  expect((await api(request(event, { origin: "https://evil.example" }))).status).toBe(403);
  expect((await api(request(event, { "content-type": "text/plain" }))).status).toBe(415);
  expect((await api(request({ ...event, query: "private" }))).status).toBe(400);
  expect((await api(request("x".repeat(2049)))).status).toBe(413);
  const get = await api(new Request(`${config.origin}/api/v1/browser-activity`));
  expect(get.status).toBe(405);
  expect(get.headers.get("cache-control")).toBe("no-store");
  expect(get.headers.has("access-control-allow-origin")).toBe(false);
  expect(record).not.toHaveBeenCalled();
});
it("bounds concurrent receivers and per-minute traffic without persistent client identifiers", async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = createBrowserActivityApi(config, () => held);
  const first = api(request()),
    second = api(request());
  expect((await api(request())).status).toBe(429);
  release();
  expect((await first).status).toBe(204);
  expect((await second).status).toBe(204);
  vi.useFakeTimers();
  try {
    const limited = createBrowserActivityApi(config, async () => {});
    for (let i = 0; i < 20; i++) expect((await limited(request())).status).toBe(204);
    expect((await limited(request())).status).toBe(429);
    vi.advanceTimersByTime(60_000);
    expect((await limited(request())).status).toBe(204);
  } finally {
    vi.useRealTimers();
  }
});
it("loses measurement rather than failing a visitor action when storage is unavailable", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const api = createBrowserActivityApi(config, async () => {
    throw new Error("private failure");
  });
  const response = await api(request());
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(stderr).toHaveBeenCalledWith(expect.stringContaining("browser_measurement_failed"));
  expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("private failure"));
  stderr.mockRestore();
});
