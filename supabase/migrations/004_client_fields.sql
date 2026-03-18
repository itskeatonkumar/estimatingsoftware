-- Add client info fields to precon_projects for proposal generation
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS client_company TEXT;
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS client_address TEXT;
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS client_email TEXT;
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS client_phone TEXT;
