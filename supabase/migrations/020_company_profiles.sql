CREATE TABLE IF NOT EXISTS company_profiles (
  id SERIAL PRIMARY KEY,
  org_id UUID,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all" ON company_profiles;
CREATE POLICY "auth_all" ON company_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS company_profile_id INT;
