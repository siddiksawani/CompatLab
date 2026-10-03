export function storableText<T>(value: T): T {
  // PostgreSQL jsonb cannot represent U+0000; the original manifest stays in a json column.
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "string" ? item.replaceAll("\u0000", "?") : item,
    ),
  ) as T;
}
