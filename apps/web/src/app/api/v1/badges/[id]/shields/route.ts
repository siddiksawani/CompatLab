import { reportControlError } from "@compatlab/catalog/web";
import { reportSummaryEnvelopeSchema } from "@compatlab/contracts";
import { z } from "zod";
import {
  badgeGroupCount,
  badgePayload,
  loadingBadge,
} from "../../../../../../server/loading-badge";
import { publicRead } from "../../../../../../server/runtime";

const responseHeaders = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const mode = query.get("mode") ?? "import";
  const group = query.get("group") ?? "1";
  if (
    !z.uuid().safeParse(id).success ||
    (mode !== "import" && mode !== "require") ||
    !/^[1-9]\d?$/.test(group)
  )
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
    if (Number(group) > badgeGroupCount(summary))
      return Response.json(
        { error: "badge_group_not_found" },
        { status: 404, headers: responseHeaders },
      );
    const badge =
      status.invalidatedAt || !status.policyAllowed
        ? badgePayload(mode, "report withdrawn")
        : status.replacedBy || !status.current
          ? badgePayload(mode, "report superseded")
          : loadingBadge(summary, mode, Number(group));
    return Response.json(badge, { headers: responseHeaders });
  } catch {
    reportControlError("report_read_failed");
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: { ...responseHeaders, "retry-after": "5" } },
    );
  }
}
