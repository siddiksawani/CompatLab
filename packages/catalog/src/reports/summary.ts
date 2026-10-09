import { reportSummarySchema } from "@compatlab/contracts";
import { combineOutcomes } from "@compatlab/engine";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { CatalogReader } from "../database.js";

const projectionSchema = reportSummarySchema
  .omit({ runtimes: true, missingOptionalPeersTruncated: true })
  .extend({
    missingOptionalPeers: z.array(reportSummarySchema.shape.missingOptionalPeers.element).max(17),
  });

export async function readReportSummary(db: CatalogReader, reportId: string) {
  z.uuid().parse(reportId);
  const [row] = (
    await db.execute<{ summary: unknown }>(sql`
      SELECT jsonb_build_object(
        'id',payload->'id','scanId',payload->'scanId','artifact',payload->'artifact',
        'observedAt',payload->'observedAt','classifiedAt',payload->'classifiedAt',
        'classifierRevision',payload->'classifierRevision','matrix',payload->'matrix',
        'outcome',payload->'outcome','evidenceLevel',payload->'evidenceLevel',
        'coverageComplete',payload->'coverageComplete','limitations',payload->'limitations',
        'preparation',(payload->'preparation')-'staticObservations',
        'cells',(SELECT jsonb_agg(cell-'entries'-'sessions' ORDER BY position)
          FROM jsonb_array_elements(payload->'cells') WITH ORDINALITY AS entries(cell,position)),
        'missingOptionalPeers',COALESCE((SELECT jsonb_agg(peer ORDER BY peer->>'name',peer->>'range')
          FROM (SELECT DISTINCT entry->'failure'->'optionalPeer' AS peer
            FROM jsonb_array_elements(payload->'cells') AS cells(cell),
              jsonb_array_elements(cell->'entries') AS entries(entry)
            WHERE entry->'failure'->>'classification'='optional_peer_missing'
            ORDER BY peer LIMIT 17) peers),'[]'::jsonb)
      ) AS summary FROM reports WHERE id=${reportId}`)
  ).rows;
  if (!row) return null;
  const summary = projectionSchema.parse(row.summary);
  return reportSummarySchema.parse({
    ...summary,
    runtimes: summary.matrix.images.map(({ profileId }) => ({
      profileId,
      outcome: combineOutcomes(
        summary.cells.filter((cell) => cell.profileId === profileId).map((cell) => cell.outcome),
      ),
    })),
    missingOptionalPeers: summary.missingOptionalPeers.slice(0, 16),
    missingOptionalPeersTruncated: summary.missingOptionalPeers.length > 16,
  });
}
