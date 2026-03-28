-- Detailed estimate columns on takeoff_items
ALTER TABLE takeoff_items ADD COLUMN IF NOT EXISTS material_unit_cost NUMERIC DEFAULT 0;
ALTER TABLE takeoff_items ADD COLUMN IF NOT EXISTS labor_unit_cost NUMERIC DEFAULT 0;
ALTER TABLE takeoff_items ADD COLUMN IF NOT EXISTS equipment_unit_cost NUMERIC DEFAULT 0;

-- Project-level estimate settings
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS estimate_format TEXT DEFAULT 'unit_price';
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS general_conditions_pct NUMERIC DEFAULT 0;
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS bond_pct NUMERIC DEFAULT 0;
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS tax_pct NUMERIC DEFAULT 0;
-- overhead_pct and profit_pct may already exist on estimate_versions; add to projects too
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS overhead_pct NUMERIC DEFAULT 0;
ALTER TABLE precon_projects ADD COLUMN IF NOT EXISTS profit_pct NUMERIC DEFAULT 0;
