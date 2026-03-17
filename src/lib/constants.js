// ── Companies (user's orgs — will be dynamic from DB in multi-tenant) ───
export const COMPANIES = [
  { id: 'all', name: 'All', color: '#888' },
  { id: 'default', name: 'My Company', color: '#10B981' },
];

// ── Takeoff Categories ──────────────────────────────────
export const TAKEOFF_CATS = [
  { id: 'site_concrete',     label: 'Site Concrete',      color: '#F59E0B', unit: 'SF', defaultCost: 8.50 },
  { id: 'building_concrete', label: 'Building Concrete',  color: '#F97316', unit: 'SF', defaultCost: 9.00 },
  { id: 'flatwork',          label: 'Flatwork / Slabs',   color: '#EF4444', unit: 'SF', defaultCost: 7.00 },
  { id: 'foundations',       label: 'Foundations',         color: '#8B5CF6', unit: 'CY', defaultCost: 650 },
  { id: 'curb_gutter',       label: 'Curb & Gutter',      color: '#06B6D4', unit: 'LF', defaultCost: 28.00 },
  { id: 'masonry',           label: 'Masonry / CMU',      color: '#10B981', unit: 'SF', defaultCost: 22.00 },
  { id: 'asphalt',           label: 'Asphalt / Paving',   color: '#6B7280', unit: 'SF', defaultCost: 4.50 },
  { id: 'grading',           label: 'Grading / Earthwork',color: '#84CC16', unit: 'CY', defaultCost: 18.00 },
  { id: 'other',             label: 'Other',              color: '#94A3B8', unit: 'LS', defaultCost: 0 },
];

// ── Takeoff Types (creation wizard) ─────────────────────
export const TAKEOFF_TYPES = [
  { id: 'area',   label: 'Area',      icon: '⬟', desc: 'Measure a flat area by clicking on each corner.',   unit: 'SF', mt: 'area',   color: '#10B981' },
  { id: 'linear', label: 'Linear',    icon: '╱', desc: 'Measure a distance by clicking on each point.',    unit: 'LF', mt: 'linear', color: '#3B82F6' },
  { id: 'count',  label: 'Count',     icon: '✓', desc: 'Count objects by clicking on the plan.',           unit: 'EA', mt: 'count',  color: '#F59E0B' },
  { id: 'vol2d',  label: 'Volume 2D', icon: '2D',desc: 'Enter depth and measure volume by clicking corners.', unit: 'CY', mt: 'area', color: '#8B5CF6' },
  { id: 'vol3d',  label: 'Volume 3D', icon: '3D',desc: 'Enter width and height and measure volume.',       unit: 'CY', mt: 'linear', color: '#EC4899' },
];

export const TO_COLORS = [
  '#10B981', '#3B82F6', '#F59E0B', '#EF4444',
  '#8B5CF6', '#F97316', '#06B6D4', '#EC4899',
  '#84CC16', '#A855F7', '#14B8A6', '#F43F5E',
];

// ── Construction Scales ─────────────────────────────────
export const CONSTRUCTION_SCALES = [
  { label: '1/16" = 1\'',  ratio: 192, group: 'Architectural' },
  { label: '3/32" = 1\'',  ratio: 128, group: 'Architectural' },
  { label: '1/8" = 1\'',   ratio: 96,  group: 'Architectural' },
  { label: '3/16" = 1\'',  ratio: 64,  group: 'Architectural' },
  { label: '1/4" = 1\'',   ratio: 48,  group: 'Architectural' },
  { label: '3/8" = 1\'',   ratio: 32,  group: 'Architectural' },
  { label: '1/2" = 1\'',   ratio: 24,  group: 'Architectural' },
  { label: '3/4" = 1\'',   ratio: 16,  group: 'Architectural' },
  { label: '1" = 1\'',     ratio: 12,  group: 'Architectural' },
  { label: '1-1/2" = 1\'', ratio: 8,   group: 'Architectural' },
  { label: '3" = 1\'',     ratio: 4,   group: 'Architectural' },
  { label: '1" = 10\'',    ratio: 120, group: 'Engineering' },
  { label: '1" = 20\'',    ratio: 240, group: 'Engineering' },
  { label: '1" = 30\'',    ratio: 360, group: 'Engineering' },
  { label: '1" = 40\'',    ratio: 480, group: 'Engineering' },
  { label: '1" = 50\'',    ratio: 600, group: 'Engineering' },
  { label: '1" = 60\'',    ratio: 720, group: 'Engineering' },
  { label: '1" = 100\'',   ratio: 1200, group: 'Engineering' },
];

// ── Default Unit Costs ──────────────────────────────────
export const UNIT_COSTS_DEFAULT = {
  site_concrete:     { mat: 4.50, lab: 4.00 },
  building_concrete: { mat: 5.00, lab: 4.00 },
  flatwork:          { mat: 3.50, lab: 3.50 },
  foundations:       { mat: 350, lab: 300 },
  curb_gutter:       { mat: 14, lab: 14 },
  masonry:           { mat: 12, lab: 10 },
  asphalt:           { mat: 2.50, lab: 2.00 },
  grading:           { mat: 8, lab: 10 },
  other:             { mat: 0, lab: 0 },
};

// ── Assemblies ──────────────────────────────────────────
export const ASSEMBLIES = [
  { name: '4" Slab on Grade', items: [
    { category: 'flatwork', description: '4" Concrete Slab', unit: 'SF', unit_cost: 7.00, quantity: 0 },
    { category: 'grading', description: 'Fine Grade & Compact', unit: 'SF', unit_cost: 1.25, quantity: 0 },
  ]},
  { name: '6" Slab on Grade', items: [
    { category: 'flatwork', description: '6" Concrete Slab', unit: 'SF', unit_cost: 9.50, quantity: 0 },
    { category: 'grading', description: 'Fine Grade & Compact', unit: 'SF', unit_cost: 1.25, quantity: 0 },
  ]},
  { name: 'Standard Curb & Gutter', items: [
    { category: 'curb_gutter', description: 'Curb & Gutter (24" roll)', unit: 'LF', unit_cost: 28, quantity: 0 },
    { category: 'grading', description: 'Curb Subgrade Prep', unit: 'LF', unit_cost: 3.50, quantity: 0 },
  ]},
  { name: 'CMU Wall (8")', items: [
    { category: 'masonry', description: '8" CMU Block Wall', unit: 'SF', unit_cost: 18, quantity: 0 },
    { category: 'masonry', description: 'Rebar & Grout (CMU)', unit: 'SF', unit_cost: 4, quantity: 0 },
  ]},
];

// ── AI Model ────────────────────────────────────────────
export const AI_MODEL = 'claude-sonnet-4-20250514';
export const AI_MODEL_FAST = 'claude-sonnet-4-20250514';
