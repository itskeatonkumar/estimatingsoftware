-- Add assigned_to column to precon_projects for team member assignment
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT NULL;