import { publicOrigin } from "../../server/metadata";
import { publicOpenApi } from "../../server/openapi";

export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(publicOpenApi(publicOrigin()), { headers: { "cache-control": "no-store" } });
}
