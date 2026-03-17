-- ============================================================
-- Multi-Tenant Setup (safe for existing data)
-- Run in Supabase SQL Editor as a single block
-- ============================================================

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  subscription_status TEXT DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  max_projects INT DEFAULT 100,
  max_members INT DEFAULT 5,
  max_sheets_per_project INT DEFAULT 500,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Member role enum + memberships
DO $$ BEGIN
  CREATE TYPE member_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

-- 3. Invitations
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role member_role NOT NULL DEFAULT 'editor',
  invited_by UUID REFERENCES auth.users(id),
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, email)
);

-- 4. Add org_id + assigned_to to business tables (skip 'projects' — doesn't exist)
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT NULL;
ALTER TABLE takeoff_items ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE precon_plans ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- 5. Backfill: create an org + membership for every existing user
DO $$
DECLARE
  u RECORD;
  new_org_id UUID;
BEGIN
  FOR u IN SELECT id, email, raw_user_meta_data FROM auth.users LOOP
    -- Skip if user already has a membership
    IF EXISTS (SELECT 1 FROM memberships WHERE user_id = u.id) THEN
      CONTINUE;
    END IF;
    -- Create org
    INSERT INTO organizations (name, slug)
    VALUES (
      COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)) || '''s Team',
      LOWER(REPLACE(COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)), ' ', '-'))
        || '-' || SUBSTRING(u.id::TEXT, 1, 8)
    )
    RETURNING id INTO new_org_id;
    -- Add as owner
    INSERT INTO memberships (org_id, user_id, role) VALUES (new_org_id, u.id, 'owner');
    -- Backfill org_id on all their existing data
    UPDATE precon_projects SET org_id = new_org_id WHERE org_id IS NULL;
    UPDATE takeoff_items SET org_id = new_org_id WHERE org_id IS NULL;
    UPDATE precon_plans SET org_id = new_org_id WHERE org_id IS NULL;
  END LOOP;
END $$;

-- 6. Helper functions
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT org_id FROM public.memberships WHERE user_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.user_has_role(p_org_id UUID, p_role member_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = p_org_id
    AND user_id = (SELECT auth.uid())
    AND role <= p_role
  );
$$;

-- 7. Get org members (for team assignment dropdown)
CREATE OR REPLACE FUNCTION public.get_org_members(p_org_id UUID)
RETURNS TABLE(user_id UUID, email TEXT, role TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id, u.email::TEXT, m.role::TEXT
  FROM public.memberships m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.org_id = p_org_id
    AND m.org_id IN (SELECT public.user_org_ids())
  ORDER BY m.role, u.email;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_members(UUID) TO authenticated;

-- 8. RLS — organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their orgs" ON organizations;
CREATE POLICY "Users can view their orgs"
  ON organizations FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_org_ids()));
DROP POLICY IF EXISTS "Owners can update org" ON organizations;
CREATE POLICY "Owners can update org"
  ON organizations FOR UPDATE TO authenticated
  USING (public.user_has_role(id, 'owner'));

-- 9. RLS — memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view org memberships" ON memberships;
CREATE POLICY "Users can view org memberships"
  ON memberships FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
DROP POLICY IF EXISTS "Admins can manage memberships" ON memberships;
CREATE POLICY "Admins can manage memberships"
  ON memberships FOR ALL TO authenticated
  USING (public.user_has_role(org_id, 'admin'));

-- 10. RLS — precon_projects (allow org_id match OR null for transition)
DROP POLICY IF EXISTS "Allow delete for authenticated" ON precon_projects;
DROP POLICY IF EXISTS "org_select" ON precon_projects;
DROP POLICY IF EXISTS "org_insert" ON precon_projects;
DROP POLICY IF EXISTS "org_update" ON precon_projects;
DROP POLICY IF EXISTS "org_delete" ON precon_projects;
CREATE POLICY "org_select" ON precon_projects FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_insert" ON precon_projects FOR INSERT TO authenticated
  WITH CHECK (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_update" ON precon_projects FOR UPDATE TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_delete" ON precon_projects FOR DELETE TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));

-- 11. RLS — takeoff_items
DROP POLICY IF EXISTS "Allow delete for authenticated" ON takeoff_items;
DROP POLICY IF EXISTS "Allow delete for anon" ON takeoff_items;
DROP POLICY IF EXISTS "org_select" ON takeoff_items;
DROP POLICY IF EXISTS "org_insert" ON takeoff_items;
DROP POLICY IF EXISTS "org_update" ON takeoff_items;
DROP POLICY IF EXISTS "org_delete" ON takeoff_items;
CREATE POLICY "org_select" ON takeoff_items FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_insert" ON takeoff_items FOR INSERT TO authenticated
  WITH CHECK (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_update" ON takeoff_items FOR UPDATE TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_delete" ON takeoff_items FOR DELETE TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));

-- 12. RLS — precon_plans
DROP POLICY IF EXISTS "Allow delete for authenticated" ON precon_plans;
DROP POLICY IF EXISTS "Allow delete for anon" ON precon_plans;
DROP POLICY IF EXISTS "org_select" ON precon_plans;
DROP POLICY IF EXISTS "org_insert" ON precon_plans;
DROP POLICY IF EXISTS "org_update" ON precon_plans;
DROP POLICY IF EXISTS "org_delete" ON precon_plans;
CREATE POLICY "org_select" ON precon_plans FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_insert" ON precon_plans FOR INSERT TO authenticated
  WITH CHECK (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_update" ON precon_plans FOR UPDATE TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_delete" ON precon_plans FOR DELETE TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT public.user_org_ids()));

-- 13. Indexes
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_precon_projects_org ON precon_projects(org_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_org ON takeoff_items(org_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_project ON takeoff_items(project_id);
CREATE INDEX IF NOT EXISTS idx_precon_plans_project ON precon_plans(project_id);

-- 14. Auto-create org on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  INSERT INTO public.organizations (name, slug)
  VALUES (
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)) || '''s Team',
    LOWER(REPLACE(COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), ' ', '-'))
      || '-' || SUBSTRING(NEW.id::TEXT, 1, 8)
  )
  RETURNING id INTO new_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 15. Updated delete function
CREATE OR REPLACE FUNCTION delete_precon_project(p_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM takeoff_items WHERE project_id = p_id;
  DELETE FROM precon_plans WHERE project_id = p_id;
  DELETE FROM precon_projects WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_precon_project(UUID) TO authenticated;
