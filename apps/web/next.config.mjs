import { fileURLToPath } from "node:url";

export default {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  poweredByHeader: false,
  // Negotiation must see React navigation headers before choosing a representation.
  skipProxyUrlNormalize: true,
  async headers() {
    return ["/api/v1/:path*", "/api/auth/:path*", "/api/maintainer/:path*", "/healthz"].map(
      (source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      }),
    );
  },
  serverExternalPackages: ["pg"],
  experimental: { proxyClientMaxBodySize: "16kb" },
};
