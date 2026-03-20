-- Library items
CREATE TABLE IF NOT EXISTS library_items (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT DEFAULT 'SF',
  unit_cost NUMERIC DEFAULT 0,
  labor_cost NUMERIC DEFAULT 0,
  material_cost NUMERIC DEFAULT 0,
  description TEXT,
  trade TEXT,
  source TEXT DEFAULT 'custom',
  region TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS library_assemblies (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS library_assembly_items (
  id SERIAL PRIMARY KEY,
  assembly_id INT REFERENCES library_assemblies(id) ON DELETE CASCADE,
  library_item_id INT REFERENCES library_items(id),
  custom_name TEXT,
  unit TEXT,
  unit_cost NUMERIC,
  quantity_per NUMERIC DEFAULT 1,
  sort_order INT DEFAULT 0
);

ALTER TABLE library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_assembly_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all" ON library_items;
CREATE POLICY "auth_all" ON library_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_all" ON library_assemblies;
CREATE POLICY "auth_all" ON library_assemblies FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_all" ON library_assembly_items;
CREATE POLICY "auth_all" ON library_assembly_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Stock items (source='stock')
INSERT INTO library_items (name, category, unit, unit_cost, labor_cost, material_cost, trade, source) VALUES
-- Concrete
('Concrete 3000 PSI', 'site_concrete', 'CY', 145, 55, 90, 'Concrete', 'stock'),
('Concrete 4000 PSI', 'site_concrete', 'CY', 160, 55, 105, 'Concrete', 'stock'),
('Concrete 5000 PSI', 'building_concrete', 'CY', 180, 55, 125, 'Concrete', 'stock'),
('Concrete Pump (Boom)', 'site_concrete', 'CY', 35, 0, 35, 'Concrete', 'stock'),
('Concrete Pump (Line)', 'site_concrete', 'CY', 25, 0, 25, 'Concrete', 'stock'),
('Fiber Mesh Additive', 'site_concrete', 'CY', 8, 0, 8, 'Concrete', 'stock'),
-- Rebar
('Rebar #3 (3/8")', 'foundations', 'LF', 1.25, 0.65, 0.60, 'Rebar', 'stock'),
('Rebar #4 (1/2")', 'foundations', 'LF', 1.50, 0.70, 0.80, 'Rebar', 'stock'),
('Rebar #5 (5/8")', 'foundations', 'LF', 2.00, 0.80, 1.20, 'Rebar', 'stock'),
('Rebar #6 (3/4")', 'foundations', 'LF', 2.60, 0.90, 1.70, 'Rebar', 'stock'),
('Rebar #7 (7/8")', 'foundations', 'LF', 3.40, 1.00, 2.40, 'Rebar', 'stock'),
('Rebar #8 (1")', 'foundations', 'LF', 4.20, 1.10, 3.10, 'Rebar', 'stock'),
('Wire Mesh 6x6 W1.4/W1.4', 'flatwork', 'SF', 0.45, 0.15, 0.30, 'Rebar', 'stock'),
('Wire Mesh 6x6 W2.9/W2.9', 'flatwork', 'SF', 0.65, 0.15, 0.50, 'Rebar', 'stock'),
('Dowel Bars #4 x 18"', 'foundations', 'EA', 3.50, 1.50, 2.00, 'Rebar', 'stock'),
-- Formwork
('Formwork - Wall (to 8ft)', 'building_concrete', 'SF', 8.50, 5.50, 3.00, 'Formwork', 'stock'),
('Formwork - Wall (8-16ft)', 'building_concrete', 'SF', 11.00, 7.00, 4.00, 'Formwork', 'stock'),
('Formwork - Footing', 'foundations', 'SF', 6.00, 4.00, 2.00, 'Formwork', 'stock'),
('Formwork - Slab Edge', 'flatwork', 'LF', 5.50, 3.50, 2.00, 'Formwork', 'stock'),
('Formwork - Column (Round)', 'building_concrete', 'LF', 28.00, 16.00, 12.00, 'Formwork', 'stock'),
('Formwork - Column (Square)', 'building_concrete', 'LF', 22.00, 14.00, 8.00, 'Formwork', 'stock'),
-- Flatwork / Slabs
('Sidewalk 4" Thick', 'flatwork', 'SF', 7.00, 3.50, 3.50, 'Concrete', 'stock'),
('Sidewalk 6" Thick', 'flatwork', 'SF', 8.50, 4.00, 4.50, 'Concrete', 'stock'),
('Concrete Slab 4"', 'flatwork', 'SF', 6.50, 3.00, 3.50, 'Concrete', 'stock'),
('Concrete Slab 6"', 'flatwork', 'SF', 8.00, 3.50, 4.50, 'Concrete', 'stock'),
('Concrete Slab 8"', 'flatwork', 'SF', 10.50, 4.00, 6.50, 'Concrete', 'stock'),
('Concrete Patio/Paver Base', 'flatwork', 'SF', 5.00, 2.50, 2.50, 'Concrete', 'stock'),
('Concrete Driveway 6"', 'flatwork', 'SF', 9.00, 4.00, 5.00, 'Concrete', 'stock'),
('Stamped Concrete', 'flatwork', 'SF', 14.00, 8.00, 6.00, 'Concrete', 'stock'),
('Broom Finish', 'flatwork', 'SF', 0.50, 0.50, 0.00, 'Concrete', 'stock'),
('Exposed Aggregate Finish', 'flatwork', 'SF', 2.50, 1.50, 1.00, 'Concrete', 'stock'),
-- Curb & Gutter
('Curb & Gutter (Std 24")', 'curb_gutter', 'LF', 28.00, 14.00, 14.00, 'Concrete', 'stock'),
('Curb & Gutter (Roll)', 'curb_gutter', 'LF', 24.00, 12.00, 12.00, 'Concrete', 'stock'),
('Curb & Gutter (Valley)', 'curb_gutter', 'LF', 32.00, 16.00, 16.00, 'Concrete', 'stock'),
('Curb Only (6" Vertical)', 'curb_gutter', 'LF', 18.00, 9.00, 9.00, 'Concrete', 'stock'),
('Curb Ramp / ADA Ramp', 'curb_gutter', 'EA', 2800.00, 1400.00, 1400.00, 'Concrete', 'stock'),
('Detectable Warning Mat', 'curb_gutter', 'EA', 350.00, 100.00, 250.00, 'Concrete', 'stock'),
-- Foundations
('Strip Footing 12"x24"', 'foundations', 'LF', 32.00, 16.00, 16.00, 'Concrete', 'stock'),
('Strip Footing 16"x30"', 'foundations', 'LF', 42.00, 20.00, 22.00, 'Concrete', 'stock'),
('Strip Footing 24"x36"', 'foundations', 'LF', 58.00, 26.00, 32.00, 'Concrete', 'stock'),
('Spread Footing 3x3x1', 'foundations', 'EA', 280.00, 140.00, 140.00, 'Concrete', 'stock'),
('Spread Footing 4x4x1.5', 'foundations', 'EA', 520.00, 240.00, 280.00, 'Concrete', 'stock'),
('Spread Footing 5x5x2', 'foundations', 'EA', 850.00, 380.00, 470.00, 'Concrete', 'stock'),
('Pier/Caisson 12" Dia', 'foundations', 'LF', 45.00, 20.00, 25.00, 'Concrete', 'stock'),
('Pier/Caisson 18" Dia', 'foundations', 'LF', 65.00, 28.00, 37.00, 'Concrete', 'stock'),
('Pier/Caisson 24" Dia', 'foundations', 'LF', 90.00, 38.00, 52.00, 'Concrete', 'stock'),
('Foundation Wall 8"', 'foundations', 'SF', 12.00, 6.00, 6.00, 'Concrete', 'stock'),
('Foundation Wall 10"', 'foundations', 'SF', 15.00, 7.00, 8.00, 'Concrete', 'stock'),
('Foundation Wall 12"', 'foundations', 'SF', 18.00, 8.00, 10.00, 'Concrete', 'stock'),
-- Masonry / CMU
('CMU Block 8" Standard', 'masonry', 'SF', 14.00, 8.00, 6.00, 'Masonry', 'stock'),
('CMU Block 10" Standard', 'masonry', 'SF', 16.50, 8.50, 8.00, 'Masonry', 'SF'),
('CMU Block 12" Standard', 'masonry', 'SF', 19.00, 9.00, 10.00, 'Masonry', 'stock'),
('CMU Block 8" Lightweight', 'masonry', 'SF', 15.50, 8.00, 7.50, 'Masonry', 'stock'),
('CMU Block Split-Face', 'masonry', 'SF', 22.00, 10.00, 12.00, 'Masonry', 'stock'),
('Brick Veneer (Standard)', 'masonry', 'SF', 18.00, 10.00, 8.00, 'Masonry', 'stock'),
('Mortar (Type S)', 'masonry', 'SF', 1.20, 0.70, 0.50, 'Masonry', 'stock'),
('Grout (CMU Cells)', 'masonry', 'CY', 180.00, 60.00, 120.00, 'Masonry', 'stock'),
('Wall Ties', 'masonry', 'EA', 0.85, 0.35, 0.50, 'Masonry', 'stock'),
('Lintel Block', 'masonry', 'LF', 12.00, 6.00, 6.00, 'Masonry', 'stock'),
('Bond Beam', 'masonry', 'LF', 14.00, 7.00, 7.00, 'Masonry', 'stock'),
-- Asphalt / Paving
('Asphalt (2" Wearing)', 'asphalt', 'SF', 2.50, 0.80, 1.70, 'Paving', 'stock'),
('Asphalt (3" Base)', 'asphalt', 'SF', 3.50, 1.00, 2.50, 'Paving', 'stock'),
('Asphalt (4" Full Depth)', 'asphalt', 'SF', 4.50, 1.20, 3.30, 'Paving', 'stock'),
('Asphalt Overlay 1.5"', 'asphalt', 'SF', 1.80, 0.60, 1.20, 'Paving', 'stock'),
('Asphalt Milling 2"', 'asphalt', 'SF', 1.20, 0.50, 0.70, 'Paving', 'stock'),
('Asphalt Patch', 'asphalt', 'SF', 8.00, 3.00, 5.00, 'Paving', 'stock'),
('Sealcoat', 'asphalt', 'SF', 0.35, 0.15, 0.20, 'Paving', 'stock'),
('Striping (4" Line)', 'asphalt', 'LF', 0.55, 0.25, 0.30, 'Paving', 'stock'),
('Parking Bumper/Wheel Stop', 'asphalt', 'EA', 125.00, 45.00, 80.00, 'Paving', 'stock'),
-- Grading / Earthwork
('Rough Grading', 'grading', 'CY', 8.00, 5.00, 3.00, 'Earthwork', 'stock'),
('Fine Grading', 'grading', 'SF', 0.80, 0.50, 0.30, 'Earthwork', 'stock'),
('Cut & Fill (Balanced)', 'grading', 'CY', 12.00, 7.00, 5.00, 'Earthwork', 'stock'),
('Haul Off Excess Soil', 'grading', 'CY', 18.00, 8.00, 10.00, 'Earthwork', 'stock'),
('Import Fill Material', 'grading', 'CY', 22.00, 8.00, 14.00, 'Earthwork', 'stock'),
('Compaction (Proof Roll)', 'grading', 'SF', 0.40, 0.25, 0.15, 'Earthwork', 'stock'),
('Subgrade Prep', 'grading', 'SF', 0.60, 0.40, 0.20, 'Earthwork', 'stock'),
('ABC Stone Base 4"', 'grading', 'SF', 1.80, 0.60, 1.20, 'Earthwork', 'stock'),
('ABC Stone Base 6"', 'grading', 'SF', 2.40, 0.70, 1.70, 'Earthwork', 'stock'),
('ABC Stone Base 8"', 'grading', 'SF', 3.20, 0.80, 2.40, 'Earthwork', 'stock'),
('Geotextile Fabric', 'grading', 'SF', 0.55, 0.20, 0.35, 'Earthwork', 'stock'),
-- Other / Misc
('Concrete Saw Cut (Control Joint)', 'other', 'LF', 2.50, 1.50, 1.00, 'Concrete', 'stock'),
('Expansion Joint (1/2" Premolded)', 'other', 'LF', 3.00, 1.50, 1.50, 'Concrete', 'stock'),
('Caulk Joint (Backer Rod + Sealant)', 'other', 'LF', 4.50, 2.50, 2.00, 'Concrete', 'stock'),
('Vapor Barrier 10mil', 'other', 'SF', 0.25, 0.10, 0.15, 'Concrete', 'stock'),
('Rigid Insulation 2" (Under Slab)', 'other', 'SF', 2.80, 0.80, 2.00, 'Concrete', 'stock'),
('Cure & Seal', 'other', 'SF', 0.35, 0.15, 0.20, 'Concrete', 'stock'),
('Concrete Bollard', 'other', 'EA', 650.00, 250.00, 400.00, 'Concrete', 'stock'),
('Light Pole Base', 'other', 'EA', 1200.00, 500.00, 700.00, 'Concrete', 'stock'),
('Sign Base', 'other', 'EA', 450.00, 200.00, 250.00, 'Concrete', 'stock'),
('Trash Enclosure Slab', 'other', 'EA', 3500.00, 1500.00, 2000.00, 'Concrete', 'stock'),
('Dumpster Pad 10x10', 'other', 'EA', 2200.00, 900.00, 1300.00, 'Concrete', 'stock')
ON CONFLICT DO NOTHING;
