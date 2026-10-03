import { expect, it, vi } from "vitest";
import { runAdmin } from "../src/admin.js";

it("requires reasons before attempting mutations and rejects unknown commands", async () => {
  const io = { stdout: vi.fn(), stderr: vi.fn() };
  expect(await runAdmin(["pause"], io)).toBe(2);
  expect(await runAdmin(["constructor"], io)).toBe(2);
  expect(
    await runAdmin(["worker-drain", "bad", "--extra", "value", "--reason", "fixture"], io),
  ).toBe(2);
  expect(await runAdmin(["--help"], io)).toBe(0);
  expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining("ADMIN_DATABASE_URL_FILE"));
});
