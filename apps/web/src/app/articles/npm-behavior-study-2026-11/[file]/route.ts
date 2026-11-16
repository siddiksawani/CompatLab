import { NextResponse } from "next/server";
import raw from "../../../../../../../docs/studies/npm-behavior-2026-11/results/raw-results.json";
import study from "../../../../content/npm-behavior-study-2026-11.json";

function csvField(value: unknown): string {
  const field = value == null ? "" : String(value);
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}
export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (!["results.json", "raw-results.json", "results.csv"].includes(file))
    return new NextResponse(null, { status: 404 });
  const headers = {
    "X-Robots-Tag": "noindex",
    "Content-Disposition": `attachment; filename="compatlab-behavior-${file}"`,
  };
  if (file === "raw-results.json") return NextResponse.json(raw, { headers });
  if (file === "results.json") return NextResponse.json(study, { headers });
  const columns = [
    "package",
    "version",
    "tier",
    "runtime",
    "runtimeVersion",
    "status",
    "classification",
    "exitCode",
    "timedOut",
    "testCount",
    "skippedCount",
    "replayExitCode",
    "completionValid",
    "sourceCommit",
    "runUrl",
  ] as const;
  const rows = [columns, ...study.observations.map((row) => columns.map((column) => row[column]))];
  return new NextResponse(`${rows.map((row) => row.map(csvField).join(",")).join("\n")}\n`, {
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
  });
}
