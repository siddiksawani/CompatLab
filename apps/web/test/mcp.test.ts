import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { reportSummaryEnvelopeSchema } from "@compatlab/contracts";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvidenceMcp, MCP_VERSION, mcpEvidenceSchema } from "../src/server/mcp.js";

const origin = "https://compatlab.test";
const matrixId = randomUUID();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

function reportFixture() {
  const id = randomUUID(),
    scanId = randomUUID();
  const now = "2026-10-09T00:00:00.000Z";
  const failure = {
    classification: "optional_peer_missing",
    phase: "module_resolution",
    origin: "prerequisite",
    retryable: false,
    source: "captured_error_code",
    message: "Cannot find module renderer",
    optionalPeer: { name: "renderer", range: "^2" },
  };
  const image = {
    profileId: "node_test",
    kind: "node",
    version: "24.21.0",
    imageId: `sha256:${"a".repeat(64)}`,
    builtAt: now,
    sourceImage: `node@sha256:${"b".repeat(64)}`,
    baseImage: `base@sha256:${"c".repeat(64)}`,
    supportImage: `support@sha256:${"d".repeat(64)}`,
    platform: "linux_amd64_glibc",
    recipeRevision: "runtime_image_v1",
  };
  return reportSummaryEnvelopeSchema.parse({
    schemaVersion: 1,
    reportPath: `/reports/${id}`,
    status: {
      id,
      scanId,
      current: true,
      policyAllowed: true,
      snapshotAvailable: false,
      createdAt: now,
      invalidatedAt: null,
      invalidationReason: null,
      replacedBy: null,
    },
    summary: {
      id,
      scanId,
      artifact: {
        name: "@scope/example",
        version: "1.2.3",
        integrity: "sha512-fixture",
        tarballUrl: "https://registry.npmjs.org/@scope/example/-/example-1.2.3.tgz",
      },
      observedAt: now,
      classifiedAt: now,
      classifierRevision: "classifier_v2",
      matrix: {
        id: matrixId,
        revision: "test",
        platform: "linux_amd64_glibc",
        harnessRevision: "load_v2",
        planRevision: "explicit_exports_v1",
        policyRevision: "runtime_limits_v2",
        images: [image],
      },
      outcome: "inconclusive",
      evidenceLevel: "smoke_tested",
      coverageComplete: false,
      limitations: ["Fixture has missing optional peers."],
      preparation: {
        id: randomUUID(),
        outcome: "pass",
        failure: null,
        profileRevision: "test",
        snapshot: null,
        installedCount: 2,
        omittedOptionalCount: 0,
      },
      cells: ["root", "subpaths"].flatMap((group) =>
        ["esm", "commonjs"].map((mode) => ({
          runId: randomUUID(),
          profileId: "node_test",
          group,
          mode,
          method: group === "root" ? "fresh_root_v2" : "sequential_batch_v2",
          outcome: "inconclusive",
          evidenceLevel: "smoke_tested",
          durationMs: 10,
          failure,
          coverage: {
            planned: 2,
            observed: 1,
            passed: 0,
            failed: 1,
            prerequisiteLimited: 1,
            interrupted: 0,
            untested: 1,
            complete: false,
          },
        })),
      ),
      runtimes: [{ profileId: "node_test", outcome: "inconclusive" }],
      missingOptionalPeers: [failure.optionalPeer],
      missingOptionalPeersTruncated: false,
    },
  });
}

function setup(settings: { earlier?: boolean; missing?: boolean; timeoutMs?: number } = {}) {
  const report = reportFixture();
  if (settings.earlier) report.summary.matrix.id = randomUUID();
  const pkg = {
    schemaVersion: 1,
    name: "@scope/example",
    version: "1.2.3",
    description: "",
    deprecated: null,
    repositoryUrl: null,
    versions: ["1.2.3"],
    versionsTruncated: false,
    tags: { latest: "1.2.3" },
    reportId: settings.earlier || settings.missing ? null : report.status.id,
    availableReport: settings.missing
      ? null
      : {
          id: report.status.id,
          observedAt: report.summary.observedAt,
          classifierRevision: "classifier_v2",
          outcome: "inconclusive",
          coverageComplete: false,
          matchesCurrentMatrix: !settings.earlier,
          matrix: { id: report.summary.matrix.id, revision: "test", platform: "linux_amd64_glibc" },
        },
    scanId: null,
    scansEnabled: true,
  };
  const read = vi.fn(async (path: string): Promise<Response> => {
    if (path.startsWith("/api/v1/packages?")) return Response.json(pkg);
    if (path === `/api/v1/reports/${report.status.id}/summary`) return Response.json(report);
    throw new Error(`Unexpected path: ${path}`);
  });
  const onError = vi.fn();
  const handler = createEvidenceMcp({ origin, matrixId, read, onError, ...settings });
  cleanups.push(() => handler.close());
  return { handler, read, onError, report, pkg };
}

async function connect(handler: ReturnType<typeof createEvidenceMcp>, modern = false) {
  const client = new Client(
    { name: "compatlab-test", version: "1.0.0" },
    modern ? { versionNegotiation: { mode: "auto" } } : {},
  );
  const methods: string[] = [];
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      methods.push(request.method);
      return handler.fetch(request);
    },
  });
  await client.connect(transport);
  cleanups.push(() => client.close());
  return { client, methods };
}

describe.each([false, true])("MCP client (modern=%s)", (modern) => {
  it("lists only read tools and preserves compact evidence, pins and optional peers", async () => {
    const { handler, read, report } = setup();
    const { client } = await connect(handler, modern);
    expect(Boolean(client.getDiscoverResult())).toBe(modern);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["check_package", "get_report"]);
    expect(
      tools.every((tool) => tool.annotations?.readOnlyHint && !tool.annotations.destructiveHint),
    ).toBe(true);
    expect(client.getInstructions()).toContain("untrusted data");
    const result = await client.callTool({
      name: "check_package",
      arguments: { name: "@scope/example" },
    });
    expect(result.isError).not.toBe(true);
    const output = mcpEvidenceSchema.parse(result.structuredContent);
    expect(output.report).toEqual(report);
    expect(output.matchesCurrentMatrix).toBe(true);
    expect(output.reportUrl).toBe(`${origin}/reports/${report.status.id}`);
    const lookup = new URL(read.mock.calls[0]?.[0] ?? "", origin);
    expect(lookup.searchParams.get("name")).toBe("@scope/example");
    expect(lookup.searchParams.has("version")).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
    const direct = await client.callTool({
      name: "get_report",
      arguments: { id: report.status.id },
    });
    expect(mcpEvidenceSchema.parse(direct.structuredContent).report).toEqual(report);
  });

  it("retains earlier and subsequently withdrawn evidence without claiming a current environment", async () => {
    const { handler, report } = setup({ earlier: true });
    const { client } = await connect(handler, modern);
    report.status.current = false;
    report.status.invalidatedAt = report.status.createdAt;
    report.status.invalidationReason = "fixture withdrawal";
    const result = await client.callTool({
      name: "check_package",
      arguments: { name: "@scope/example", version: "1.2.3" },
    });
    const output = mcpEvidenceSchema.parse(result.structuredContent);
    expect(output.matchesCurrentMatrix).toBe(false);
    expect(output.report?.status.current).toBe(false);
    expect(output.message).toContain("Historical or withdrawn");
  });

  it("treats absent evidence as missing rather than a loading failure", async () => {
    const { handler, read } = setup({ missing: true });
    const { client } = await connect(handler, modern);
    const result = await client.callTool({
      name: "check_package",
      arguments: { name: "@scope/example", version: "1.2.3" },
    });
    expect(result.isError).not.toBe(true);
    expect(mcpEvidenceSchema.parse(result.structuredContent)).toMatchObject({
      kind: "missing",
      package: { name: "@scope/example", version: "1.2.3" },
      report: null,
      reportUrl: null,
      matchesCurrentMatrix: null,
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

it("rejects execution flags, arbitrary URLs, ranges and invalid IDs before reading", async () => {
  const { handler, read } = setup();
  const { client } = await connect(handler);
  for (const args of [
    { name: "example", version: "latest" },
    { name: "example", version: "^1" },
    { name: "https://private.local/" },
    { name: "example", scan: true },
  ])
    expect((await client.callTool({ name: "check_package", arguments: args })).isError).toBe(true);
  expect(
    (await client.callTool({ name: "get_report", arguments: { id: "../private" } })).isError,
  ).toBe(true);
  expect(read).not.toHaveBeenCalled();
});

it("distinguishes not found from temporary errors and rejects cross-artifact evidence", async () => {
  const { handler, read, report, onError } = setup();
  const { client } = await connect(handler);
  read.mockResolvedValueOnce(new Response(null, { status: 404 }));
  const missing = await client.callTool({ name: "get_report", arguments: { id: randomUUID() } });
  expect(mcpEvidenceSchema.parse(missing.structuredContent).kind).toBe("missing");
  read.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect(
    (await client.callTool({ name: "check_package", arguments: { name: "@scope/example" } }))
      .isError,
  ).toBe(true);
  expect(onError).not.toHaveBeenCalled();
  report.summary.artifact.name = "another-package";
  const wrong = await client.callTool({
    name: "check_package",
    arguments: { name: "@scope/example" },
  });
  expect(wrong.isError).toBe(true);
  expect(onError).toHaveBeenCalledOnce();
  expect(JSON.stringify(wrong)).not.toContain("another-package");
});

it("bounds concurrent reads and retains slots for timed-out underlying work", async () => {
  const { handler, read } = setup({ timeoutMs: 100 });
  const { client } = await connect(handler);
  const resolvers: ((response: Response) => void)[] = [];
  read.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  const pending = Array.from({ length: 4 }, () =>
    client.callTool({ name: "get_report", arguments: { id: randomUUID() } }),
  );
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
  expect(
    (await client.callTool({ name: "get_report", arguments: { id: randomUUID() } })).isError,
  ).toBe(true);
  expect((await Promise.all(pending)).every((result) => result.isError)).toBe(true);
  expect(
    (await client.callTool({ name: "get_report", arguments: { id: randomUUID() } })).isError,
  ).toBe(true);
  expect(read).toHaveBeenCalledTimes(4);
  for (const resolve of resolvers) resolve(new Response(null, { status: 404 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  read.mockResolvedValue(new Response(null, { status: 404 }));
  expect(
    (await client.callTool({ name: "get_report", arguments: { id: randomUUID() } })).isError,
  ).not.toBe(true);
});

it("checks Host and Origin, rejects oversized bodies, and keeps responses uncacheable", async () => {
  const { handler, read } = setup();
  const request = (headers: Record<string, string>, body = "{}") =>
    new Request(`${origin}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body,
    });
  for (const headers of [
    { host: "attacker.test" },
    { origin: "https://attacker.test" },
    { origin: "null" },
  ])
    expect((await handler.fetch(request(headers))).status).toBe(403);
  expect(
    (await handler.fetch(request({}, JSON.stringify({ padding: "a".repeat(16 * 1024) })))).status,
  ).toBe(413);
  expect((await handler.fetch(request({}, "{"))).status).toBe(400);
  const response = await handler.fetch(
    request({}, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it("bounds slow request bodies and releases their request slots after cancellation", async () => {
  const { handler, read } = setup();
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const cancel = vi.fn();
  const pending = Array.from({ length: 8 }, () => {
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: "half" as const,
    };
    return handler.fetch(new Request(`${origin}/mcp`, init));
  });
  expect((await handler.fetch(new Request(`${origin}/mcp`))).status).toBe(503);
  controller.abort();
  expect((await Promise.all(pending)).every((response) => response.status === 400)).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(8);
  expect((await handler.fetch(new Request(`${origin}/mcp`))).status).not.toBe(503);
  expect(read).not.toHaveBeenCalled();
});

it("does not disguise invalid or oversized upstream data as missing evidence", async () => {
  const { handler, read, onError } = setup();
  const { client } = await connect(handler);
  read.mockResolvedValueOnce(Response.json(null));
  expect(
    (await client.callTool({ name: "get_report", arguments: { id: randomUUID() } })).isError,
  ).toBe(true);
  expect(onError).toHaveBeenCalledOnce();
  read.mockResolvedValueOnce(Response.json({ padding: "a".repeat(256 * 1024) }));
  expect(
    (await client.callTool({ name: "get_report", arguments: { id: randomUUID() } })).isError,
  ).toBe(true);
});

it("keeps registry metadata aligned with the actual anonymous remote server", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../../server.json", import.meta.url), "utf8"),
  );
  expect(manifest.version).toBe(MCP_VERSION);
  expect(manifest.name).toBe("io.github.siddiksawani/compatlab");
  expect(manifest.remotes).toEqual([{ type: "streamable-http", url: "https://compatlab.me/mcp" }]);
  expect(manifest.packages).toBeUndefined();
});
