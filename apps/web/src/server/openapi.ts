import {
  packageResponseSchema,
  reportEnvelopeSchema,
  scanProgressSchema,
  searchResponseSchema,
} from "@compatlab/contracts";
import { z } from "zod";

const error = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
    },
  },
});
const errors = {
  "400": error("Invalid query or identifier."),
  "404": error("Package, version or report not found."),
  "503": {
    ...error("Service busy or upstream unavailable. Retry with backoff."),
    headers: {
      "Retry-After": {
        description: "When supplied, seconds before retrying.",
        schema: { type: "string" },
      },
    },
  },
};
const query = (name: string, description: string, required: boolean, maxLength: number) => ({
  name,
  in: "query",
  required,
  description,
  schema: { type: "string", minLength: 1, maxLength },
});
const identifier = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const responses = (schema: string) => ({
  "200": {
    description: "Public result.",
    content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } },
  },
  ...errors,
});

export function publicOpenApi(origin: string) {
  return {
    openapi: "3.1.1",
    info: {
      title: "CompatLab public read API",
      version: "1",
      description:
        "Search npm metadata and inspect retained loading evidence. These GET endpoints never start scans and require no authentication. Loading success does not prove functional correctness or safety. Scan submission and maintainer operations are outside this read-only API description.",
    },
    servers: [{ url: origin }],
    security: [],
    externalDocs: { url: `${origin}/api` },
    paths: {
      "/api/v1/search": {
        get: {
          operationId: "searchPackages",
          summary: "Search npm package metadata (up to 10 results)",
          parameters: [query("q", "Package name or search text.", true, 200)],
          responses: responses("SearchResponse"),
        },
      },
      "/api/v1/packages": {
        get: {
          operationId: "getPackage",
          summary: "Resolve a package version and find existing evidence",
          description:
            "reportId selects baseline evidence for the current matrix and classifier. availableReport also exposes eligible baseline evidence from another approved matrix, with matchesCurrentMatrix=false and the original observation time. An active scan can coexist with either result. No read starts work.",
          parameters: [
            query("name", "Exact npm package name, including its scope when present.", true, 214),
            query(
              "version",
              "Exact published version. Omit to resolve the latest tag; tags and ranges are not accepted as version values.",
              false,
              256,
            ),
          ],
          responses: responses("PackageResponse"),
        },
      },
      "/api/v1/reports/{id}": {
        get: {
          operationId: "getReport",
          summary: "Read a stored report with its current or historical status",
          parameters: [identifier],
          responses: responses("ReportEnvelope"),
        },
      },
      "/api/v1/scans/{id}": {
        get: {
          operationId: "getScanProgress",
          summary: "Read progress of an existing scan",
          parameters: [identifier],
          responses: responses("ScanProgress"),
        },
      },
    },
    components: {
      schemas: {
        SearchResponse: z.toJSONSchema(searchResponseSchema),
        PackageResponse: z.toJSONSchema(packageResponseSchema),
        ReportEnvelope: z.toJSONSchema(reportEnvelopeSchema),
        ScanProgress: z.toJSONSchema(scanProgressSchema),
      },
    },
  };
}
