import { reportControlError } from "@compatlab/catalog/web";
import { contentSignal } from "../../server/content-discovery";
import { webRuntime } from "../../server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  try {
    const response = await webRuntime().mcp.fetch(request);
    response.headers.set("content-signal", contentSignal);
    return response;
  } catch {
    reportControlError("web_configuration_unavailable");
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } },
    );
  }
}

export { handle as GET, handle as POST, handle as DELETE, handle as HEAD, handle as OPTIONS };
