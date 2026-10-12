import { expect, it } from "vitest";
import { evidenceUsageSchema, usageContext } from "../src/public/usage.js";

it("reduces referrers to fixed groups and never accepts a lookalike host", () => {
  const origin = "https://compatlab.me";
  expect(
    usageContext(new Headers({ referer: "https://github.com/user/private?token=secret" }), origin),
  ).toEqual({ source: "github", research: false });
  expect(
    usageContext(new Headers({ referer: "https://github.com.attacker.example" }), origin).source,
  ).toBe("other");
  expect(
    usageContext(
      new Headers({ referer: `${origin}/reports/private`, "x-compatlab-research": "1" }),
      origin,
    ),
  ).toEqual({ source: "internal", research: true });
  expect(
    usageContext(
      new Headers({ referer: "not a URL", "user-agent": "CompatLab-operator-audit/1.0" }),
      origin,
    ),
  ).toEqual({ source: "other", research: true });
  expect(
    usageContext(new Headers({ referer: "https://www.google.com/search?q=private" }), origin)
      .source,
  ).toBe("search");
  expect(usageContext(new Headers(), origin)).toEqual({ source: "direct", research: false });
  expect(
    evidenceUsageSchema.safeParse({
      surface: "report_page",
      availability: "available",
      source: "private.example",
      research: false,
    }).success,
  ).toBe(false);
});
