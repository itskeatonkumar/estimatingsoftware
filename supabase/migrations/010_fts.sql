-- Ensure ocr_text column exists
ALTER TABLE precon_plans ADD COLUMN IF NOT EXISTS ocr_text TEXT;

-- Full-text search index (weighted: name=A, content=B)
-- Note: GENERATED columns require dropping first if already exists with different definition
DO $$ BEGIN
  ALTER TABLE precon_plans ADD COLUMN fts tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(ocr_text, '')), 'B')
  ) STORED;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_plans_fts ON precon_plans USING GIN (fts);
