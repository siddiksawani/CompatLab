import { webRuntime } from "./runtime";

export async function maintainerRequest(request: Request) {
  try {
    const service = webRuntime().maintainer;
    if (service) return await service.handler(request);
    const account =
      new URL(request.url).pathname === "/api/maintainer/account" && request.method === "GET";
    return Response.json(account ? { enabled: false } : { error: "maintainer_auth_disabled" }, {
      status: account ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
