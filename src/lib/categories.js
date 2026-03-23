import { supabase } from './supabase.js';

// Default categories — seeded on first use
export const DEFAULT_CATEGORIES = [
  { id: 'site_concrete',     label: 'Site Concrete',        color: '#D4A04A', unit: 'SF', default_cost: 8.50,  sort_order: 0 },
  { id: 'building_concrete', label: 'Building Concrete',    color: '#C87941', unit: 'SF', default_cost: 9.00,  sort_order: 1 },
  { id: 'flatwork',          label: 'Flatwork / Slabs',     color: '#C0504D', unit: 'SF', default_cost: 7.00,  sort_order: 2 },
  { id: 'foundations',       label: 'Foundations',           color: '#7B6BA4', unit: 'CY', default_cost: 650,   sort_order: 3 },
  { id: 'curb_gutter',       label: 'Curb & Gutter',        color: '#4A90A4', unit: 'LF', default_cost: 28.00, sort_order: 4 },
  { id: 'masonry',           label: 'Masonry / CMU',        color: '#4CAF50', unit: 'SF', default_cost: 22.00, sort_order: 5 },
  { id: 'asphalt',           label: 'Asphalt / Paving',     color: '#808080', unit: 'SF', default_cost: 4.50,  sort_order: 6 },
  { id: 'grading',           label: 'Grading / Earthwork',  color: '#6B8E23', unit: 'CY', default_cost: 18.00, sort_order: 7 },
  { id: 'roofing',           label: 'Roofing',              color: '#C0504D', unit: 'SF', default_cost: 7.00,  sort_order: 8 },
  { id: 'painting',          label: 'Painting',             color: '#5B9BD5', unit: 'SF', default_cost: 2.00,  sort_order: 9 },
  { id: 'flooring',          label: 'Flooring',             color: '#4A90A4', unit: 'SF', default_cost: 5.00,  sort_order: 10 },
  { id: 'drywall',           label: 'Drywall',              color: '#7B6BA4', unit: 'SF', default_cost: 2.00,  sort_order: 11 },
  { id: 'hvac',              label: 'HVAC',                 color: '#4A90A4', unit: 'EA', default_cost: 2000,  sort_order: 12 },
  { id: 'electrical',        label: 'Electrical',           color: '#E8A317', unit: 'EA', default_cost: 150,   sort_order: 13 },
  { id: 'plumbing',          label: 'Plumbing',             color: '#7B6BA4', unit: 'EA', default_cost: 250,   sort_order: 14 },
  { id: 'landscaping',       label: 'Landscaping',          color: '#4CAF50', unit: 'SF', default_cost: 1.50,  sort_order: 15 },
  { id: 'fencing',           label: 'Fencing',              color: '#808080', unit: 'LF', default_cost: 25.00, sort_order: 16 },
  { id: 'irrigation',        label: 'Irrigation',           color: '#5B9BD5', unit: 'SF', default_cost: 1.25,  sort_order: 17 },
  { id: 'demolition',        label: 'Demolition',           color: '#C0504D', unit: 'SF', default_cost: 3.00,  sort_order: 18 },
  { id: 'other',             label: 'Other',                color: '#8E9AAF', unit: 'LS', default_cost: 0,     sort_order: 99 },
];

let _cache = null;

export async function loadCategories(orgId) {
  let q = supabase.from('takeoff_categories').select('*').order('sort_order');
  if (orgId) q = q.or(`org_id.eq.${orgId},org_id.is.null`);
  const { data, error } = await q;

  if (error) {
    // Table might not exist — fall back to defaults
    console.warn('[categories] load error, using defaults:', error.message);
    _cache = DEFAULT_CATEGORIES;
    return _cache;
  }

  if (!data || data.length === 0) {
    // First use — seed defaults with org_id
    const toInsert = DEFAULT_CATEGORIES.map(c => ({ ...c, is_default: true, ...(orgId ? { org_id: orgId } : {}) }));
    const { data: inserted } = await supabase.from('takeoff_categories').insert(toInsert).select();
    _cache = inserted || DEFAULT_CATEGORIES;
    return _cache;
  }

  _cache = data;
  return data;
}

export function getCachedCategories() {
  return _cache || DEFAULT_CATEGORIES;
}

// Find category by id — works with both old hardcoded IDs and new custom ones
export function findCategory(id, categories) {
  const cats = categories || _cache || DEFAULT_CATEGORIES;
  return cats.find(c => c.id === id) || cats[cats.length - 1];
}
