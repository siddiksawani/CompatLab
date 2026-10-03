import { describe, expect, it } from "vitest";
import { streamCommand } from "../src/command.js";

describe("bounded command output", () => {
  it("retains stream prefixes while counting discarded bytes", async () => {
    const result = await streamCommand(
      process.execPath,
      ["-e", "process.stdout.write('a'.repeat(300000));process.stderr.write('b'.repeat(200000));"],
      AbortSignal.timeout(2000),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBe(128 * 1024);
    expect(result.stderr.length).toBe(128 * 1024);
    expect(result.emittedBytes).toBe(500000);
    expect(result.termination).toBe("completed");
  });
  it("terminates an output flood and a cancelled command", async () => {
    const flood = await streamCommand(
      process.execPath,
      ["-e", "const b='x'.repeat(65536);setInterval(()=>process.stdout.write(b),0);"],
      AbortSignal.timeout(4000),
    );
    expect(flood.termination).toBe("output_limit_exceeded");
    expect(flood.stdout.length).toBe(128 * 1024);
    const cancelled = await streamCommand(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      AbortSignal.timeout(100),
    );
    expect(cancelled.termination).toBe("cancelled");
    expect(cancelled.exitCode).toBeNull();
  });
});
