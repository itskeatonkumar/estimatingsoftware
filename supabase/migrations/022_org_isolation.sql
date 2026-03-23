-- Add org_id to tables that need multi-tenant isolation
ALTER TABLE precon_plans ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE takeoff_items ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE library_items ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE library_assemblies ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE library_assembly_items ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE takeoff_templates ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE takeoff_categories ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE estimate_versions ADD COLUMN IF NOT EXISTS org_id UUID;

-- Indexes for fast org-scoped queries
CREATE INDEX IF NOT EXISTS idx_precon_projects_org ON precon_projects(org_id);
CREATE INDEX IF NOT EXISTS idx_precon_plans_org ON precon_plans(org_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_items_org ON takeoff_items(org_id);
CREATE INDEX IF NOT EXISTS idx_library_items_org ON library_items(org_id);
CREATE INDEX IF NOT EXISTS idx_library_assemblies_org ON library_assemblies(org_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_templates_org ON takeoff_templates(org_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_categories_org ON takeoff_categories(org_id);
CREATE INDEX IF NOT EXISTS idx_company_profiles_org ON company_profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_estimate_versions_org ON estimate_versions(org_id);

-- NOTE: After running this migration, assign existing data to your org:
-- SELECT id, name FROM organizations;
-- UPDATE precon_projects SET org_id = 'YOUR_ORG_ID' WHERE org_id IS NULL;
-- UPDATE precon_plans SET org_id = 'YOUR_ORG_ID' WHERE org_id IS NULL;
-- UPDATE takeoff_items SET org_id = 'YOUR_ORG_ID' WHERE org_id IS NULL;
-- UPDATE library_items SET org_id = 'YOUR_ORG_ID' WHERE org_id IS NULL;
-- UPDATE library_assemblies SET org_id = 'YOUR_ORG_ID' WHERE org_id IS NULL;
-- UPDATE takeoff_templates SET org_id = 'YOUR_ORG_ID' WHERE org_id IS NULL;
-- UPDATE takeoff_categories SET org_id = 'YOUR_ORG_ID' WHERE org_id IS NULL;
-- UPDATE company_profiles SET org_id = 'YOUR_ORG_ID' WHERE org_id IS NULL;
-- UPDATE estimate_versions SET org_id = 'YOUR_ORG_ID' WHERE org_id IS NULL;
