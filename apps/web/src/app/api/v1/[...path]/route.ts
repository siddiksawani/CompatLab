import { webRuntime } from "../../../../server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    return await webRuntime().api(request);
  } catch {
    process.stderr.write('{"level":"error","event":"web_configuration_unavailable"}\n');
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export { handle as GET, handle as HEAD, handle as POST };
