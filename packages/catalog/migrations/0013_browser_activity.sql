CREATE TABLE browser_activity (
  day date NOT NULL,
  action text NOT NULL CHECK (action IN ('page_view','search','version_selected','evidence_opened','share_copied')),
  page text NOT NULL CHECK (page IN ('home','package','report','other')),
  source text NOT NULL CHECK (source IN ('direct','internal','search','github','medium','dev','reddit','peerlist','other')),
  research boolean NOT NULL,
  automated boolean NOT NULL,
  windows integer NOT NULL DEFAULT 1 CHECK (windows BETWEEN 1 AND 144),
  last_bucket bigint NOT NULL,
  CHECK (action='page_view' OR (action='search' AND page='home') OR
    (action='version_selected' AND page='package') OR
    (action IN ('evidence_opened','share_copied') AND page='report')),
  PRIMARY KEY(day,action,page,source,research,automated)
);
