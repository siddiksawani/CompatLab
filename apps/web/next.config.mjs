import { fileURLToPath } from "node:url";

export default {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  poweredByHeader: false,
  async headers() {
    return ["/api/:path*", "/healthz"].map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    }));
  },
  serverExternalPackages: ["pg"],
  experimental: { proxyClientMaxBodySize: "16kb" },
};
