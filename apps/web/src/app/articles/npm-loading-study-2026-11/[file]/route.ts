import { type NextRequest, NextResponse } from "next/server";
import study from "../../../../content/npm-loading-study-2026-11.json";
import evidence from "../../../../content/npm-loading-study-2026-11-evidence.json";

function csvField(value: unknown): string {
  const field = value == null ? "" : String(value);
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export async function GET(request: NextRequest, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (file === "results.json") {
    const name = request.nextUrl.searchParams.get("package");
    if (name !== null) {
      const row = study.packages.find((entry) => entry.name === name);
      if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json(
        { ...row, evidence: evidence.packages.find((entry) => entry.name === name) ?? null },
        { headers: { "X-Robots-Tag": "noindex" } },
      );
    }
    return NextResponse.json(
      { ...study, evidence: evidence.packages },
      {
        headers: {
          "Content-Disposition": 'attachment; filename="compatlab-npm-loading-2026-11.json"',
          "X-Robots-Tag": "noindex",
        },
      },
    );
  }
  if (file !== "results.csv") return new NextResponse(null, { status: 404 });
  const profiles = study.profiles.map(({ id }) => id);
  const columns = [
    "rank",
    "package",
    "version",
    "weekly_downloads",
    "integrity",
    "status",
    "preparation",
    "observed_at",
    "outcome",
    "coverage_complete",
    "report_id",
    "lock_sha256",
    "snapshot_generation",
    ...profiles.flatMap((id) => [`${id}_import`, `${id}_require`]),
  ];
  const rows = study.packages.map((row) => [
    row.rank,
    row.name,
    row.version,
    row.weeklyDownloads,
    row.integrity,
    row.status,
    row.preparation,
    row.observedAt,
    row.outcome,
    row.coverageComplete,
    row.reportId,
    row.lockDigest,
    row.snapshotGeneration,
    ...profiles.flatMap((id) => [
      row.root.find((cell) => cell.profileId === id && cell.mode === "esm")?.outcome,
      row.root.find((cell) => cell.profileId === id && cell.mode === "commonjs")?.outcome,
    ]),
  ]);
  const csv = [columns, ...rows].map((row) => row.map(csvField).join(",")).join("\n");
  return new NextResponse(`${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="compatlab-npm-loading-2026-11.csv"',
      "X-Robots-Tag": "noindex",
    },
  });
}
