import { reportControlError } from "@compatlab/catalog/web";
import { reportEnvelopeSchema } from "@compatlab/contracts";
import { z } from "zod";
import { markdownResponse } from "../../../../server/content-discovery";
import { reportMarkdown } from "../../../../server/markdown";
import { publicOrigin } from "../../../../server/metadata";
import { publicRead } from "../../../../server/runtime";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = publicOrigin();
  if (!z.uuid().safeParse(id).success)
    return markdownResponse("Report not found.\n", `${origin}/`, 404);
  const canonical = `${origin}/reports/${id}`;
  try {
    const response = await publicRead(`/api/v1/reports/${id}`);
    if (!response.ok)
      return markdownResponse(
        response.status === 404 ? "Report not found.\n" : "Report temporarily unavailable.\n",
        canonical,
        response.status,
      );
    return markdownResponse(
      reportMarkdown(origin, reportEnvelopeSchema.parse(await response.json())),
      canonical,
    );
  } catch {
    reportControlError("report_read_failed");
    return markdownResponse("Report temporarily unavailable.\n", canonical, 503);
  }
}
