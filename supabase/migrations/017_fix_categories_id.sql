-- Recreate takeoff_categories with TEXT id to match existing takeoff_items.category values
DROP TABLE IF EXISTS takeoff_categories CASCADE;

CREATE TABLE takeoff_categories (
  id TEXT PRIMARY KEY,
  user_id UUID,
  label TEXT NOT NULL,
  color TEXT DEFAULT '#94A3B8',
  unit TEXT DEFAULT 'SF',
  default_cost NUMERIC DEFAULT 0,
  sort_order INT DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE takeoff_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all" ON takeoff_categories;
CREATE POLICY "auth_all" ON takeoff_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
