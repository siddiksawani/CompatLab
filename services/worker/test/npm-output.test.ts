import { describe, expect, it } from "vitest";
import { streamCommand } from "../src/command.js";
import { installerFailure, NpmOutput } from "../src/preparation/npm-output.js";

const available = { bytes: 1024 ** 3, inodes: 1000 };
const observe = (text: string) => {
  const output = new NpmOutput();
  output.write(Buffer.from(text));
  output.finish();
  return output;
};

describe("npm failure evidence", () => {
  it.each([125, 126, 127])(
    "keeps Docker launch exit %i separate from package failures",
    (exitCode) => {
      expect(installerFailure(exitCode, observe(""), available)).toBe("sandbox_start_failed");
    },
  );
  it("retains and recognizes terminal errors after a discarded log prefix", async () => {
    const output = new NpmOutput();
    const result = await streamCommand(
      process.execPath,
      [
        "-e",
        "process.stderr.write('npm warn old warning\\n'.repeat(10000));process.stderr.write('npm error code EINTEGRITY\\n');process.exitCode=1",
      ],
      AbortSignal.timeout(3000),
      (bytes) => output.write(bytes),
    );
    output.finish();
    expect(result.stderr).not.toContain("EINTEGRITY");
    expect(result.stderrTail).toContain("npm error code EINTEGRITY");
    expect(installerFailure(result.exitCode, output, available)).toBe(
      "artifact_integrity_mismatch",
    );
  });

  it("recognizes split error lines, but ignores substrings in warnings and oversized lines", () => {
    const output = new NpmOutput();
    output.write(Buffer.from("npm error co"));
    output.write(Buffer.from("de ENOSPC\r\n"));
    output.finish();
    expect(installerFailure(1, output, available)).toBe("preparation_limit_exceeded");
    for (const text of [
      "npm warn ENOSPC in an optional package",
      "npm warn user text: npm error code EINTEGRITY",
      `npm error code EINTEGRITY${" ".repeat(8192)}`,
    ])
      expect(installerFailure(1, observe(text), available)).toBe("dependency_install_failed");
    expect(installerFailure(0, observe("npm error code EINTEGRITY"), available)).toBeUndefined();
  });

  it("rejects successful exits with partial extraction or exhausted disk/inodes", () => {
    const output = observe("npm warn tar TAR_ENTRY_ERROR ENOSPC: no space left on device, write");
    expect(installerFailure(0, output, available)).toBe("archive_rejected");
    expect(installerFailure(0, output, { ...available, bytes: 0 })).toBe(
      "preparation_limit_exceeded",
    );
    expect(installerFailure(0, observe(""), { ...available, inodes: 0 })).toBe(
      "preparation_limit_exceeded",
    );
    expect(installerFailure(0, observe("npm warn harmless"), available)).toBeUndefined();
    expect(installerFailure(137, observe(""), { ...available, oomKilled: true })).toBe(
      "preparation_limit_exceeded",
    );
    expect(
      installerFailure(1, observe("npm error code ETIMEDOUT"), {
        ...available,
        downloadLimitExceeded: true,
      }),
    ).toBe("preparation_limit_exceeded");
    expect(installerFailure(137, observe(""), available)).toBe("dependency_install_failed");
  });
});
