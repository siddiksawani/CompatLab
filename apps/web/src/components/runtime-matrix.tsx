import type { ReportPreview } from "@compatlab/catalog/web";
import { coverageSummary, labels } from "./labels";

function Result({
  cell,
  reportId,
}: {
  cell: ReportPreview["cells"][number] | undefined;
  reportId: string | undefined;
}) {
  return cell ? (
    <a
      className={`result ${cell.outcome}`}
      href={`${reportId ? `/reports/${reportId}` : ""}#${cell.profileId}-${cell.group}-${cell.mode}`}
    >
      {labels[cell.outcome]}
      {cell.group === "subpaths" && <small>{coverageSummary(cell.coverage)}</small>}
    </a>
  ) : (
    <span>Unavailable</span>
  );
}
const groups = [
  ["root", "esm"],
  ["root", "commonjs"],
  ["subpaths", "esm"],
  ["subpaths", "commonjs"],
] as const;
const columnNames = ["Root import", "Root require", "Subpath imports", "Subpath requires"];
export function RuntimeMatrix({
  report,
  reportId,
}: {
  report: Pick<ReportPreview, "matrix" | "cells">;
  reportId?: string;
}) {
  return (
    <>
      <div className="desktop-matrix">
        <table>
          <caption className="sr-only">Loading outcomes by runtime and consumer mode</caption>
          <thead>
            <tr>
              <th scope="col">Runtime</th>
              {columnNames.map((label) => (
                <th scope="col" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.matrix.images.map((image) => (
              <tr key={image.profileId}>
                <th scope="row">
                  <strong>
                    {image.kind === "node" ? "Node.js" : image.kind === "bun" ? "Bun" : "Deno"}
                  </strong>
                  <span className="runtime-version mono">{image.version}</span>
                </th>
                {groups.map(([group, mode]) => (
                  <td key={`${group}-${mode}`}>
                    <Result
                      reportId={reportId}
                      cell={report.cells.find(
                        (cell) =>
                          cell.profileId === image.profileId &&
                          cell.group === group &&
                          cell.mode === mode,
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobile-matrix">
        {report.matrix.images.map((image) => (
          <article key={image.profileId}>
            <h3>
              {image.kind === "node" ? "Node.js" : image.kind === "bun" ? "Bun" : "Deno"}{" "}
              <span className="runtime-version mono">{image.version}</span>
            </h3>
            {groups.map(([group, mode], index) => (
              <div className="row" key={`${group}-${mode}`}>
                <span>{columnNames[index]}</span>
                <Result
                  reportId={reportId}
                  cell={report.cells.find(
                    (cell) =>
                      cell.profileId === image.profileId &&
                      cell.group === group &&
                      cell.mode === mode,
                  )}
                />
              </div>
            ))}
          </article>
        ))}
      </div>
    </>
  );
}
