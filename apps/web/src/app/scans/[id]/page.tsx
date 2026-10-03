import { scanProgressSchema } from "@compatlab/contracts";
import { notFound, redirect } from "next/navigation";
import { Progress } from "../../../components/progress";
import { publicRead } from "../../../server/runtime";

export const metadata = { title: "Scan progress", robots: { index: false, follow: false } };
export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const response = await publicRead(`/api/v1/scans/${encodeURIComponent(id)}`);
  if ([400, 404].includes(response.status)) notFound();
  if (!response.ok) throw new Error("Progress unavailable.");
  const progress = scanProgressSchema.parse(await response.json());
  if (progress.reportId) redirect(`/reports/${progress.reportId}`);
  return (
    <section className="page narrow">
      <a href="/" className="back">
        ← Package search
      </a>
      <p className="eyebrow">Durable execution</p>
      <h1>Scan progress</h1>
      <p className="mono fine break">{progress.id}</p>
      <Progress initial={progress} initialEtag={response.headers.get("etag")} />
    </section>
  );
}
