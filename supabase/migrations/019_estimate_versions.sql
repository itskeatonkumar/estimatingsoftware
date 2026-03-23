-- Ensure estimate_versions has the right schema
DO $$ BEGIN
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS project_id INT;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Original Bid';
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS version_type TEXT DEFAULT 'original';
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS items_snapshot JSONB;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS overhead_pct NUMERIC DEFAULT 0;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS profit_pct NUMERIC DEFAULT 0;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS user_id UUID;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Fix RLS
DROP POLICY IF EXISTS "auth_all" ON estimate_versions;
CREATE POLICY "auth_all" ON estimate_versions FOR ALL TO authenticated USING (true) WITH CHECK (true);
