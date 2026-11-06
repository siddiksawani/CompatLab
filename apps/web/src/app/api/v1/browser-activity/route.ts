import { reportControlError } from "@compatlab/catalog/web";
import { webRuntime } from "../../../../server/runtime";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    return await webRuntime().browserActivity(request);
  } catch {
    reportControlError("browser_measurement_failed");
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
}
