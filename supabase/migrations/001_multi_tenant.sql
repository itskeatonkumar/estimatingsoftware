-- ============================================================
-- FCG Estimating → SaaS Multi-Tenant Migration
-- Run in Supabase SQL Editor in order
-- ============================================================

-- 1. Organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free', -- 'free' | 'pro' | 'enterprise'
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  subscription_status TEXT DEFAULT 'trialing', -- 'trialing'|'active'|'past_due'|'canceled'
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  max_projects INT DEFAULT 2,
  max_members INT DEFAULT 1,
  max_sheets_per_project INT DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Memberships (join table: users ↔ orgs)
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'editor', 'viewer');

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

-- 4. Add org_id to all business tables
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE takeoff_items ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE precon_plans ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- 5. Performance: SECURITY DEFINER function for org lookup (cached per query)
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT org_id FROM public.memberships WHERE user_id = (SELECT auth.uid());
$$;

-- 6. Helper: check if user has specific role in org
CREATE OR REPLACE FUNCTION public.user_has_role(p_org_id UUID, p_role member_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = p_org_id
    AND user_id = (SELECT auth.uid())
    AND role <= p_role  -- owner < admin < editor < viewer (enum ordering)
  );
$$;

-- 7. RLS Policies — organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their orgs"
  ON organizations FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_org_ids()));

CREATE POLICY "Owners can update org"
  ON organizations FOR UPDATE TO authenticated
  USING (public.user_has_role(id, 'owner'));

-- 8. RLS Policies — memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org memberships"
  ON memberships FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Admins can manage memberships"
  ON memberships FOR ALL TO authenticated
  USING (public.user_has_role(org_id, 'admin'));

-- 9. RLS Policies — business tables (org-scoped)
-- precon_projects
DROP POLICY IF EXISTS "Allow delete for authenticated" ON precon_projects;
CREATE POLICY "org_select" ON precon_projects FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_insert" ON precon_projects FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_update" ON precon_projects FOR UPDATE TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_delete" ON precon_projects FOR DELETE TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

-- takeoff_items
DROP POLICY IF EXISTS "Allow delete for authenticated" ON takeoff_items;
DROP POLICY IF EXISTS "Allow delete for anon" ON takeoff_items;
CREATE POLICY "org_select" ON takeoff_items FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_insert" ON takeoff_items FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_update" ON takeoff_items FOR UPDATE TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_delete" ON takeoff_items FOR DELETE TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

-- precon_plans
DROP POLICY IF EXISTS "Allow delete for authenticated" ON precon_plans;
DROP POLICY IF EXISTS "Allow delete for anon" ON precon_plans;
CREATE POLICY "org_select" ON precon_plans FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_insert" ON precon_plans FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_update" ON precon_plans FOR UPDATE TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY "org_delete" ON precon_plans FOR DELETE TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

-- 10. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_precon_projects_org ON precon_projects(org_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_org ON takeoff_items(org_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_project ON takeoff_items(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_project_cat ON takeoff_items(project_id, category);
CREATE INDEX IF NOT EXISTS idx_precon_plans_project ON precon_plans(project_id);

-- 11. Auto-create org on first user signup (trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Create a personal org for the new user
  INSERT INTO public.organizations (name, slug)
  VALUES (
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)) || '''s Team',
    LOWER(REPLACE(COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), ' ', '-')) || '-' || SUBSTRING(NEW.id::TEXT, 1, 8)
  )
  RETURNING id INTO new_org_id;

  -- Add user as owner
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

-- Create trigger (drop first if exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 12. Updated delete_precon_project to be org-aware
CREATE OR REPLACE FUNCTION delete_precon_project(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM takeoff_items WHERE project_id = p_id;
  DELETE FROM precon_plans WHERE project_id = p_id;
  DELETE FROM precon_projects WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_precon_project(UUID) TO authenticated;

-- 13. Plan limit enforcement trigger
CREATE OR REPLACE FUNCTION check_project_limit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  org_max INT;
  current_count INT;
BEGIN
  SELECT max_projects INTO org_max FROM public.organizations WHERE id = NEW.org_id;
  SELECT COUNT(*) INTO current_count FROM public.precon_projects WHERE org_id = NEW.org_id;
  
  IF current_count >= org_max THEN
    RAISE EXCEPTION 'Project limit reached. Upgrade your plan to create more projects.';
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_project_limit ON precon_projects;
CREATE TRIGGER enforce_project_limit
  BEFORE INSERT ON precon_projects
  FOR EACH ROW EXECUTE FUNCTION check_project_limit();

-- 14. Verify
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename IN ('organizations', 'memberships', 'precon_projects', 'takeoff_items', 'precon_plans')
ORDER BY tablename, cmd;
