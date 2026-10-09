export const compatibilityArticle = {
  path: "/articles/npm-package-compatibility-node-bun-deno",
  title: "Do npm packages work on Node.js, Bun and Deno? We built a tool to find out",
  description:
    "Real npm package compatibility results for Express, Preact, Zod and the Convex agent across Node.js, Bun and Deno, with failures, coverage and linked evidence.",
  publishedAt: "2026-10-05",
  author: "CompatLab",
} as const;

export const mcpArticle = {
  path: "/articles/mcp-npm-compatibility-ai-agents",
  title: "Check npm compatibility with MCP: a guide for AI agents",
  description:
    "Connect Claude Code, Cursor or Codex to CompatLab's MCP server. Check npm packages across Node.js, Bun and Deno, interpret real reports and cite evidence.",
  publishedAt: "2026-10-09",
  author: "CompatLab",
} as const;

export const articles = [mcpArticle, compatibilityArticle];

export function articleDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
