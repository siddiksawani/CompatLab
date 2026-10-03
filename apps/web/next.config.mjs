import { fileURLToPath } from "node:url";

export default {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  experimental: { proxyClientMaxBodySize: "16kb" },
};
