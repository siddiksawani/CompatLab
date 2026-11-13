export const compatibilityArticle = {
  path: "/articles/npm-package-compatibility-node-bun-deno",
  title: "Do npm packages work on Node.js, Bun and Deno? We built a tool to find out",
  description:
    "Real npm package compatibility results for Express, Preact, Zod and the Convex agent across Node.js, Bun and Deno, with failures, coverage and linked evidence.",
  publishedAt: "2026-10-05",
  modifiedAt: "2026-11-13",
  author: "CompatLab",
} as const;

export const mcpArticle = {
  path: "/articles/mcp-npm-compatibility-ai-agents",
  title: "Check npm compatibility with MCP: a guide for AI agents",
  description:
    "Connect Claude Code, Cursor or Codex to CompatLab's MCP server. Check npm packages across Node.js, Bun and Deno, interpret real reports and cite evidence.",
  publishedAt: "2026-10-09",
  modifiedAt: "2026-11-13",
  author: "CompatLab",
} as const;

export const migrationArticle = {
  path: "/articles/node-to-bun-deno-dependency-checklist",
  title: "Node.js to Bun or Deno: an npm dependency checklist",
  description:
    "Use recorded results for Axios, Zod, Sharp and gRPC to choose which imports, package calls and deployment prerequisites to test before moving off Node.js.",
  publishedAt: "2026-11-13",
  author: "CompatLab",
} as const;

export const novemberStudyArticle = {
  path: "/articles/npm-loading-study-2026-11",
  title: "How 100 npm packages load on Node.js, Bun, and Deno",
  description:
    "A frozen 100-version npm study with root import and require results, subpath coverage, and reproducible observations on four pinned runtimes.",
  publishedAt: "2026-11-13",
  author: "CompatLab",
} as const;

export const articles = [novemberStudyArticle, migrationArticle, mcpArticle, compatibilityArticle];

export function articleDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
