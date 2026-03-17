-- Add assigned_to column to precon_projects for team member assignment
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT NULL;

-- Function to list org members (email + role) for the current user's org
-- Returns members of a given org (RLS: only if caller is in that org)
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