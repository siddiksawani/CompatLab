import { expect, it } from "vitest";
import { applicabilitySchema } from "../src/plan.js";

it("requires a target only for a valid public target", () => {
  for (const value of [
    { applicable: true, reason: "public_target" },
    { applicable: true, reason: "resolution_required", target: "./index.js" },
    { applicable: false, reason: "public_target", target: "./index.js" },
    { applicable: true, reason: "not_exported" },
    { applicable: false, reason: "not_exported", target: "./index.js" },
  ])
    expect(applicabilitySchema.safeParse(value).success).toBe(false);
  for (const value of [
    { applicable: true, reason: "public_target", target: "./index.js" },
    { applicable: true, reason: "resolution_required" },
    { applicable: false, reason: "not_exported" },
  ])
    expect(applicabilitySchema.safeParse(value).success).toBe(true);
});
