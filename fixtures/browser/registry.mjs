import { createHash } from "node:crypto";

const names = [
  "compatlab-browser-fixture",
  "@compatlab/browser-fixture",
  `@compatlab/${"browser-layout-".repeat(12)}fixture`,
];
const original = globalThis.fetch;
export function manifest(name, version) {
  return {
    name,
    version,
    description: name.includes("browser-layout-")
      ? `Layout qualification with a long reference: https://example.com/${"a".repeat(300)}`
      : "A browser qualification fixture.",
    ...(version === "2.0.0" ? { deprecated: "Use a maintained version." } : {}),
    dist: {
      integrity: `sha512-${createHash("sha512").update(name).digest("base64")}`,
      tarball: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`,
    },
  };
}
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== "https://registry.npmjs.org") return original(input, init);
  if (url.pathname === "/-/v1/search")
    return Response.json({
      objects: names
        .filter((name) => name.includes(url.searchParams.get("text") ?? ""))
        .map((name) => ({
          package: {
            ...manifest(name, "1.0.0"),
            links: { repository: "https://github.com/example/browser-fixture" },
          },
        })),
    });
  const [, encoded, version] = url.pathname.split("/");
  const name = decodeURIComponent(encoded ?? "");
  if (!names.includes(name)) return new Response("Missing fixture", { status: 404 });
  if (!version)
    return Response.json({
      name,
      "dist-tags": { latest: "1.0.0" },
      versions: {
        ...Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`0.0.${index}`, {}])),
        "1.0.0": {},
        "2.0.0": {},
      },
    });
  return ["1.0.0", "2.0.0", "0.0.0"].includes(version)
    ? Response.json(manifest(name, version), {
        headers: { "content-type": version === "2.0.0" ? "text/plain" : "application/json" },
      })
    : new Response("Missing fixture", { status: 404 });
};
