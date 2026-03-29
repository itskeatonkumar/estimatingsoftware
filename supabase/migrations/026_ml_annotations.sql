CREATE TABLE IF NOT EXISTS ml_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id INT REFERENCES precon_plans(id) ON DELETE CASCADE,
  image_url TEXT,
  page_width INT,
  page_height INT,
  annotation_type TEXT NOT NULL, -- title_block, scale_bar, symbol, room_label, sheet_number
  bounding_box JSONB NOT NULL,  -- {x, y, width, height} normalized 0-1
  label JSONB,                  -- {sheet_number, sheet_name} or {scale} or {symbol_type}
  annotated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ml_annotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all" ON ml_annotations;
CREATE POLICY "auth_all" ON ml_annotations FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ml_annotations_plan ON ml_annotations(plan_id);
CREATE INDEX IF NOT EXISTS idx_ml_annotations_type ON ml_annotations(annotation_type);
