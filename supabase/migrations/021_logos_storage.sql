-- Create logos storage bucket (run in Supabase Dashboard > Storage if this doesn't auto-create)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true) ON CONFLICT DO NOTHING;

-- Storage RLS: allow authenticated users to upload/read logos
-- These policies should be created in Supabase Dashboard > Storage > logos bucket > Policies:
-- 1. SELECT (read): Allow all authenticated users
-- 2. INSERT (upload): Allow all authenticated users
-- 3. DELETE: Allow all authenticated users

-- Note: You must manually create the "logos" bucket in Supabase Dashboard > Storage
-- Set it to PUBLIC so logo URLs are accessible without auth tokens
-- Allowed MIME types: image/png, image/jpeg, image/svg+xml
-- Max file size: 2MB
