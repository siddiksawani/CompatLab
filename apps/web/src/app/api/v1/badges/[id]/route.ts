import { reportControlError } from "@compatlab/catalog/web";
import { reportSummaryEnvelopeSchema } from "@compatlab/contracts";
import { badgePayload, loadingBadge } from "../../../../../server/loading-badge";
import { publicRead } from "../../../../../server/runtime";

const responseHeaders = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };
const reportIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mode = new URL(request.url).searchParams.get("mode") ?? "import";
  if (!reportIdPattern.test(id) || (mode !== "import" && mode !== "require"))
    return Response.json(
      { error: "invalid_badge_request" },
      { status: 400, headers: responseHeaders },
    );

  try {
    const response = await publicRead(`/api/v1/reports/${id}/summary`);
    if (response.status === 404)
      return Response.json(badgePayload(mode, "report unavailable"), { headers: responseHeaders });
    if (!response.ok) throw new Error("Badge evidence unavailable.");
    const { status, summary } = reportSummaryEnvelopeSchema.parse(await response.json());
    const badge =
      status.invalidatedAt || !status.policyAllowed
        ? badgePayload(mode, "report withdrawn")
        : status.replacedBy || !status.current
          ? badgePayload(mode, "report superseded")
          : loadingBadge(summary, mode);
    return Response.json(badge, { headers: responseHeaders });
  } catch {
    reportControlError("report_read_failed");
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: { ...responseHeaders, "retry-after": "5" } },
    );
  }
}
