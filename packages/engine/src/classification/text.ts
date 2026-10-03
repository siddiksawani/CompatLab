export function sanitizeText(value: string, normalizeLocations = true): string {
  let clean = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 27 || code === 0x9b || code === 0x9d) {
      const type = code === 27 ? value[++index] : code === 0x9b ? "[" : "]";
      if (type === "[") {
        while (++index < value.length) {
          const next = value.charCodeAt(index);
          if (next >= 0x40 && next <= 0x7e) break;
        }
      } else if (type === "]" || type === "P" || type === "_" || type === "^") {
        while (++index < value.length) {
          if (value.charCodeAt(index) === 7 || value.charCodeAt(index) === 0x9c) break;
          if (value.charCodeAt(index) === 27 && value[index + 1] === "\\") {
            index++;
            break;
          }
        }
      }
      continue;
    }
    if (code === 13) {
      clean += "\n";
      continue;
    }
    if (
      (code < 32 && code !== 9 && code !== 10) ||
      (code >= 127 && code <= 159) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    )
      continue;
    clean += value[index];
  }
  return normalizeLocations
    ? clean
        .replace(/\/(?:var\/)?tmp\/compatlab-[a-zA-Z0-9_-]+/g, "<workdir>")
        .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "<id>")
    : clean;
}

export function sanitizeJson(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value, false);
  if (Array.isArray(value)) return value.map(sanitizeJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [sanitizeText(key, false), sanitizeJson(item)]),
    );
  return value;
}

export function boundedText(
  value: string,
  maximumBytes: number,
): { text: string; truncated: boolean } {
  const bytes = Buffer.from(sanitizeText(value));
  return {
    text: new TextDecoder().decode(bytes.subarray(0, maximumBytes), { stream: true }),
    truncated: bytes.length > maximumBytes,
  };
}
