INSERT INTO takeoff_templates (name, description, category, items) VALUES
('Commercial Parking Lot', 'Standard commercial parking lot scope', 'site',
 '[{"category":"flatwork","description":"4\" Concrete Sidewalk","unit":"SF","unit_cost":7.00,"color":"#4CAF50","measurement_type":"area","waste_percent":5},
   {"category":"curb_gutter","description":"Curb & Gutter - 24\" Standard","unit":"LF","unit_cost":28.00,"color":"#4A90A4","measurement_type":"linear","waste_percent":3},
   {"category":"asphalt","description":"Asphalt Paving 3\" Base","unit":"SF","unit_cost":3.50,"color":"#808080","measurement_type":"area","waste_percent":5},
   {"category":"asphalt","description":"Parking Striping","unit":"LF","unit_cost":0.55,"color":"#808080","measurement_type":"linear","waste_percent":0},
   {"category":"other","description":"Wheel Stops","unit":"EA","unit_cost":125.00,"color":"#8E9AAF","measurement_type":"count","waste_percent":0},
   {"category":"curb_gutter","description":"ADA Curb Ramp","unit":"EA","unit_cost":2800.00,"color":"#4A90A4","measurement_type":"count","waste_percent":0},
   {"category":"other","description":"Sign Base","unit":"EA","unit_cost":450.00,"color":"#8E9AAF","measurement_type":"count","waste_percent":0}]'::jsonb),

('Building Slab on Grade', 'Typical commercial slab-on-grade assembly', 'concrete',
 '[{"category":"flatwork","description":"Concrete Slab 6\"","unit":"SF","unit_cost":8.00,"color":"#D4A04A","measurement_type":"area","waste_percent":5},
   {"category":"other","description":"Vapor Barrier 10mil","unit":"SF","unit_cost":0.25,"color":"#8E9AAF","measurement_type":"area","waste_percent":5},
   {"category":"flatwork","description":"Wire Mesh 6x6 W2.9","unit":"SF","unit_cost":0.65,"color":"#D4A04A","measurement_type":"area","waste_percent":5},
   {"category":"foundations","description":"Rebar #4 (1/2\")","unit":"LF","unit_cost":1.50,"color":"#7B6BA4","measurement_type":"linear","waste_percent":8},
   {"category":"flatwork","description":"Slab Edge Formwork","unit":"LF","unit_cost":5.50,"color":"#D4A04A","measurement_type":"linear","waste_percent":0},
   {"category":"other","description":"Saw Cut Control Joints","unit":"LF","unit_cost":2.50,"color":"#8E9AAF","measurement_type":"linear","waste_percent":0},
   {"category":"other","description":"Expansion Joint 1/2\" Premolded","unit":"LF","unit_cost":3.00,"color":"#8E9AAF","measurement_type":"linear","waste_percent":5}]'::jsonb),

('CMU Wall Assembly', 'Standard CMU block wall with reinforcement', 'masonry',
 '[{"category":"masonry","description":"8\" CMU Block Standard","unit":"SF","unit_cost":14.00,"color":"#4CAF50","measurement_type":"area","waste_percent":5},
   {"category":"masonry","description":"Grout (CMU Cells)","unit":"CY","unit_cost":180.00,"color":"#4CAF50","measurement_type":"area","waste_percent":8},
   {"category":"foundations","description":"Rebar #5 Vertical","unit":"LF","unit_cost":2.00,"color":"#7B6BA4","measurement_type":"linear","waste_percent":8},
   {"category":"masonry","description":"Bond Beam","unit":"LF","unit_cost":14.00,"color":"#4CAF50","measurement_type":"linear","waste_percent":3},
   {"category":"masonry","description":"Mortar Type S","unit":"SF","unit_cost":1.20,"color":"#4CAF50","measurement_type":"area","waste_percent":5},
   {"category":"masonry","description":"Lintel Block","unit":"LF","unit_cost":12.00,"color":"#4CAF50","measurement_type":"linear","waste_percent":3}]'::jsonb),

('Residential Driveway', 'Standard residential concrete driveway', 'residential',
 '[{"category":"flatwork","description":"Concrete Driveway 4\"","unit":"SF","unit_cost":7.00,"color":"#D4A04A","measurement_type":"area","waste_percent":5},
   {"category":"grading","description":"ABC Stone Base 4\"","unit":"SF","unit_cost":1.80,"color":"#6B8E23","measurement_type":"area","waste_percent":5},
   {"category":"flatwork","description":"Slab Edge Formwork","unit":"LF","unit_cost":5.50,"color":"#D4A04A","measurement_type":"linear","waste_percent":0},
   {"category":"flatwork","description":"Broom Finish","unit":"SF","unit_cost":0.50,"color":"#D4A04A","measurement_type":"area","waste_percent":0}]'::jsonb),

('Flat Roof (TPO)', 'TPO single-ply membrane roof assembly', 'roofing',
 '[{"category":"other","description":"TPO Membrane 60mil","unit":"SF","unit_cost":5.50,"color":"#C87941","measurement_type":"area","waste_percent":10},
   {"category":"other","description":"Polyiso Insulation 2\"","unit":"SF","unit_cost":2.80,"color":"#C87941","measurement_type":"area","waste_percent":5},
   {"category":"other","description":"Cover Board 1/2\" HD","unit":"SF","unit_cost":1.20,"color":"#C87941","measurement_type":"area","waste_percent":5},
   {"category":"other","description":"Metal Edge Flashing","unit":"LF","unit_cost":8.00,"color":"#C87941","measurement_type":"linear","waste_percent":5},
   {"category":"other","description":"Roof Drains","unit":"EA","unit_cost":450.00,"color":"#C87941","measurement_type":"count","waste_percent":0},
   {"category":"other","description":"Metal Coping","unit":"LF","unit_cost":18.00,"color":"#C87941","measurement_type":"linear","waste_percent":5}]'::jsonb)

ON CONFLICT DO NOTHING;
