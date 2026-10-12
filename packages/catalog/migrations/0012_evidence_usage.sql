CREATE TABLE evidence_usage (
  day date NOT NULL,
  surface text NOT NULL CHECK (surface IN ('report_page','package_page','lookup_api','report_api','mcp_check_package','mcp_get_report')),
  availability text NOT NULL CHECK (availability IN ('current','earlier','historical','available','missing','error')),
  source text NOT NULL CHECK (source IN ('direct','internal','search','github','medium','dev','reddit','peerlist','other')),
  research boolean NOT NULL,
  windows integer NOT NULL DEFAULT 1 CHECK (windows BETWEEN 1 AND 144),
  last_bucket bigint NOT NULL,
  PRIMARY KEY(day,surface,availability,source,research)
);
