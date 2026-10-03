import type { PreparationClassification } from "@compatlab/engine";

export class NpmOutput {
  errorCode: string | undefined;
  tarEntryError = false;
  private line = "";
  private overflow = false;
  private decoder = new TextDecoder();

  write(bytes: Uint8Array): void {
    this.consume(this.decoder.decode(bytes, { stream: true }));
  }
  finish(): void {
    this.consume(`${this.decoder.decode()}\n`);
  }
  private consume(text: string): void {
    for (const character of text) {
      if (character === "\n") {
        if (!this.overflow) {
          const code = /^npm error code ([A-Z0-9_]+)\r?$/.exec(this.line);
          if (code) this.errorCode = code[1];
          if (/^npm warn tar TAR_ENTRY_ERROR(?: |\r?$)/.test(this.line)) this.tarEntryError = true;
        }
        this.line = "";
        this.overflow = false;
      } else if (this.line.length < 8192) this.line += character;
      else this.overflow = true;
    }
  }
}

export function installerFailure(
  exitCode: number | null,
  output: NpmOutput,
  available: {
    bytes: number;
    inodes: number;
    oomKilled?: boolean;
    downloadLimitExceeded?: boolean;
  },
): PreparationClassification | undefined {
  if (exitCode === 125 || exitCode === 126 || exitCode === 127) return "sandbox_start_failed";
  if (available.oomKilled || available.downloadLimitExceeded) return "preparation_limit_exceeded";
  if (available.bytes < 1024 * 1024 || available.inodes < 32) return "preparation_limit_exceeded";
  if (output.tarEntryError) return "archive_rejected";
  if (exitCode === 0) return undefined;
  switch (output.errorCode) {
    case "EINTEGRITY":
      return "artifact_integrity_mismatch";
    case "ENOSPC":
    case "ENOMEM":
      return "preparation_limit_exceeded";
    case "TAR_ABORT":
    case "TAR_BAD_ARCHIVE":
      return "archive_rejected";
    default:
      return "dependency_install_failed";
  }
}
