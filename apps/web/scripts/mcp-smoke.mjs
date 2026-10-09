import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { reportSummaryEnvelopeSchema } from "@compatlab/contracts";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const manifest = JSON.parse(
  await readFile(new URL("../../../server.json", import.meta.url), "utf8"),
);
const endpoint = new URL(manifest.remotes[0].url);
assert.equal(endpoint.href, "https://compatlab.me/mcp");

for (const mode of ["legacy", "auto"]) {
  const client = new Client(
    { name: "compatlab-qualification", version: "1.0.0" },
    mode === "auto" ? { versionNegotiation: { mode } } : {},
  );
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint));
    assert.equal(client.getServerVersion()?.version, manifest.version);
    assert.equal(Boolean(client.getDiscoverResult()), mode === "auto");
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["check_package", "get_report"]);
    assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint));
    const result = await client.callTool({
      name: "check_package",
      arguments: { name: "express", version: "5.2.1" },
    });
    assert.ok(!result.isError);
    const output = result.structuredContent;
    assert.equal(output?.kind, "evidence");
    const report = reportSummaryEnvelopeSchema.parse(output.report);
    assert.equal(report.summary.artifact.name, "express");
    assert.equal(report.summary.artifact.version, "5.2.1");
    assert.equal(report.status.current, true);
    assert.equal(output.reportUrl, `${endpoint.origin}${report.reportPath}`);
    const direct = await client.callTool({
      name: "get_report",
      arguments: { id: report.status.id },
    });
    assert.ok(!direct.isError);
    assert.deepEqual(direct.structuredContent?.report, report);
    const scoped = await client.callTool({
      name: "check_package",
      arguments: { name: "@hono/node-server", version: "2.1.4" },
    });
    assert.ok(!scoped.isError);
    assert.deepEqual(scoped.structuredContent?.package, {
      name: "@hono/node-server",
      version: "2.1.4",
    });
    const missing = await client.callTool({ name: "get_report", arguments: { id: randomUUID() } });
    assert.ok(!missing.isError);
    assert.equal(missing.structuredContent?.kind, "missing");
    assert.equal(missing.structuredContent?.report, null);
    process.stdout.write(
      `${JSON.stringify({ mode, reportUrl: output.reportUrl, current: report.status.current, matchesCurrentMatrix: output.matchesCurrentMatrix, scoped: scoped.structuredContent?.kind, passed: true })}\n`,
    );
  } finally {
    await client.close();
  }
}
