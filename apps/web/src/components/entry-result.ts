import { probeGroupResultSchema, type ReportCell } from "@compatlab/contracts";

export function cellAnchor(cell: Pick<ReportCell, "profileId" | "group" | "mode">) {
  return `${cell.profileId}-${cell.group}-${cell.mode}`;
}

export function entryPath(reportId: string, cell: ReportCell, index: number) {
  return `/reports/${reportId}?${new URLSearchParams({ cell: cellAnchor(cell), entry: String(index) })}#selected-result`;
}

export function selectEntry(
  cells: ReportCell[],
  query: { cell?: string | string[]; entry?: string | string[] },
) {
  if (typeof query.cell !== "string" || typeof query.entry !== "string") return null;
  if (query.cell.length > 100 || !/^(0|[1-9]\d{0,2})$/.test(query.entry)) return null;
  const cell = cells.find((item) => cellAnchor(item) === query.cell);
  const entry = cell?.entries.find((item) => item.index === Number(query.entry));
  return cell && entry ? { cell, entry } : null;
}

export function recordedValueType(
  cell: ReportCell,
  entry: ReportCell["entries"][number],
  evidence: unknown,
) {
  if (entry.outcome !== "pass") return null;
  const parsed = probeGroupResultSchema.safeParse(evidence);
  if (!parsed.success) return null;
  const raw = parsed.data;
  if (
    raw.profileId !== cell.profileId ||
    raw.group !== cell.group ||
    raw.mode !== cell.mode ||
    raw.method !== cell.method ||
    raw.entries[entry.index] !== entry.specifier
  )
    return null;
  let observation = raw.observations.find((item) => item.index === entry.index);
  if (entry.isolation) {
    const expected = entry.isolation.confirmation;
    const confirmation = raw.confirmations?.find((item) => item.index === entry.index);
    if (
      expected?.stopReason !== "completed" ||
      confirmation?.session.stopReason !== "completed" ||
      confirmation.session.probeId !== expected.probeId
    )
      return null;
    observation = confirmation.session.checkpoint?.observations.find((item) => item.index === 0);
  }
  return observation?.outcome === "pass" ? observation.valueType : null;
}
