ALTER TABLE precon_plans ADD COLUMN IF NOT EXISTS ocr_text TEXT;
CREATE INDEX IF NOT EXISTS idx_precon_plans_ocr ON precon_plans USING gin(to_tsvector('english', COALESCE(ocr_text, '')));
