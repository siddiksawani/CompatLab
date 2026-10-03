import { expect, it } from "vitest";
import { earlierVersion, matchingVersions } from "../src/comparison.js";

it("uses the complete version set to preserve missed backports and bounded ranges", () => {
  expect(
    matchingVersions(["3.0.0", "1.0.0", "2.0.0", "1.5.0", "1.5.0", "2.1.0-beta.1"], ">=1 <3"),
  ).toEqual(["1.0.0", "1.5.0", "2.0.0"]);
  expect(earlierVersion("1.5.0", "2.0.0")).toBe(true);
  expect(() => matchingVersions(["1.0.0"], "not a range")).toThrow("version range");
  expect(() =>
    matchingVersions(
      Array.from({ length: 5001 }, (_, i) => `1.0.${i}`),
      "*",
    ),
  ).toThrow("5000");
});
