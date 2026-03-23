-- Ensure estimate_versions has the right schema
DO $$ BEGIN
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS project_id INT;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Original Bid';
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS version_number INT;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS items_snapshot JSONB;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS overhead_percent NUMERIC DEFAULT 0;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS profit_percent NUMERIC DEFAULT 0;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS total_cost NUMERIC DEFAULT 0;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS created_by UUID;
  ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Fix RLS
DROP POLICY IF EXISTS "auth_all" ON estimate_versions;
CREATE POLICY "auth_all" ON estimate_versions FOR ALL TO authenticated USING (true) WITH CHECK (true);
