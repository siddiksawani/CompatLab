import { reportControlError, usageContext } from "@compatlab/catalog/web";
import { webRuntime } from "../../../../server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    const { api, config } = webRuntime();
    return await api(request, usageContext(request.headers, config.origin));
  } catch {
    reportControlError("web_configuration_unavailable");
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export { handle as GET, handle as HEAD, handle as POST };
