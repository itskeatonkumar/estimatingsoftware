CREATE TABLE IF NOT EXISTS ml_training_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID,
  type TEXT NOT NULL,  -- ai_takeoff_suggestion, ai_takeoff_correction
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ml_training_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all" ON ml_training_data;
CREATE POLICY "auth_all" ON ml_training_data FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ml_training_type ON ml_training_data(type);
CREATE INDEX IF NOT EXISTS idx_ml_training_org ON ml_training_data(org_id);
