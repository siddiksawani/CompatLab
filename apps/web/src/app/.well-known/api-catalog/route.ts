import { publicOrigin } from "../../../server/metadata";

export const dynamic = "force-dynamic";
export function GET() {
  const origin = publicOrigin();
  return Response.json(
    {
      linkset: [
        {
          anchor: `${origin}/api/v1/search`,
          "service-desc": [{ href: `${origin}/openapi.json`, type: "application/json" }],
          "service-doc": [{ href: `${origin}/api`, type: "text/html" }],
          status: [{ href: `${origin}/healthz`, type: "application/json" }],
        },
      ],
    },
    {
      headers: {
        "content-type":
          'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
        "cache-control": "no-store",
      },
    },
  );
}
