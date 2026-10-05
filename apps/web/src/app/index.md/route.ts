import { reportControlError } from "@compatlab/catalog/web";
import { searchResponseSchema } from "@compatlab/contracts";
import { markdownResponse } from "../../server/content-discovery";
import { exampleReports, recentReports } from "../../server/discovery";
import { homeMarkdown } from "../../server/markdown";
import { publicOrigin } from "../../server/metadata";
import { publicRead } from "../../server/runtime";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const origin = publicOrigin();
  try {
    const query = new URL(request.url).searchParams.get("q")?.slice(0, 200);
    const response = query
      ? await publicRead(`/api/v1/search?${new URLSearchParams({ q: query })}`)
      : undefined;
    if (response && !response.ok)
      return markdownResponse(
        "Search is temporarily unavailable.\n",
        `${origin}/`,
        response.status,
      );
    const search = response ? searchResponseSchema.parse(await response.json()) : undefined;
    const examples = await exampleReports(await recentReports());
    return markdownResponse(homeMarkdown(origin, examples, search), `${origin}/`);
  } catch {
    reportControlError("report_read_failed");
    return markdownResponse("Content temporarily unavailable.\n", `${origin}/`, 503);
  }
}
