import { RegistryError } from "./errors.js";

export const MAX_JSON_DEPTH = 32;
export const MAX_JSON_STRING_BYTES = 64 * 1024;

export class JsonStructureLimit {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private stringBytes = 0;

  // This bounds tokens before allocation; JSON.parse still validates JSON syntax.
  write(bytes: Uint8Array): void {
    for (const byte of bytes) {
      if (this.inString) {
        if (!this.escaped && byte === 34) {
          this.inString = false;
          continue;
        }
        this.stringBytes++;
        if (this.stringBytes > MAX_JSON_STRING_BYTES) this.reject();
        this.escaped = !this.escaped && byte === 92;
      } else if (byte === 34) {
        this.inString = true;
        this.escaped = false;
        this.stringBytes = 0;
      } else if (byte === 123 || byte === 91) {
        if (++this.depth > MAX_JSON_DEPTH) this.reject();
      } else if (byte === 125 || byte === 93) {
        this.depth--;
      }
    }
  }

  private reject(): never {
    throw new RegistryError(
      "preparation_limit_exceeded",
      "Registry JSON exceeds its nesting or string limit.",
    );
  }
}
