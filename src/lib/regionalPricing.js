import { supabase } from './supabase.js';

// US States mapped to regions
const STATE_TO_REGION = {};
let _cache = null;

// Category → trade multiplier column mapping
const CATEGORY_TRADE_MAP = {
  site_concrete: 'concrete_multiplier',
  building_concrete: 'concrete_multiplier',
  flatwork: 'concrete_multiplier',
  foundations: 'concrete_multiplier',
  curb_gutter: 'concrete_multiplier',
  masonry: 'masonry_multiplier',
  asphalt: 'paving_multiplier',
  grading: 'earthwork_multiplier',
  other: 'overall_multiplier',
};

// Category → pricing category name mapping
const CATEGORY_PRICING_MAP = {
  site_concrete: 'Concrete',
  building_concrete: 'Concrete',
  flatwork: 'Concrete',
  foundations: 'Concrete',
  curb_gutter: 'Concrete',
  masonry: 'Masonry',
  asphalt: 'Paving',
  grading: 'Earthwork',
  other: null,
};

const INFLATION_FACTOR = 1.04; // 2024 → 2026

export async function loadRegionalPricing() {
  if (_cache) return _cache;

  const [{ data: pricing }, { data: multipliers }, { data: states }] = await Promise.all([
    supabase.from('regional_pricing').select('*').order('item_name'),
    supabase.from('regional_multipliers').select('*'),
    supabase.from('state_cost_factors').select('*'),
  ]);

  // Build state → region map from multipliers
  if (multipliers) {
    for (const m of multipliers) {
      if (m.states_included && m.states_included !== 'ALL') {
        const stateList = m.states_included.split(',').map(s => s.trim().toUpperCase());
        for (const st of stateList) {
          STATE_TO_REGION[st] = m.region;
        }
      }
    }
  }

  _cache = {
    pricing: pricing || [],
    multipliers: multipliers || [],
    states: states || [],
    stateToRegion: { ...STATE_TO_REGION },
  };
  return _cache;
}

export function getRegionForState(stateCode) {
  return STATE_TO_REGION[stateCode?.toUpperCase()] || 'National';
}

export function getRegionalCost(pricingItem, region, multipliers) {
  const mult = multipliers.find(m => m.region === region) || multipliers.find(m => m.region === 'National') || {};
  const matMult = mult.material_multiplier || 1;
  const labMult = mult.labor_multiplier || 1;
  const material = (pricingItem.material_cost || 0) * matMult * INFLATION_FACTOR;
  const labor = (pricingItem.labor_cost || 0) * labMult * INFLATION_FACTOR;
  return { material: Math.round(material * 100) / 100, labor: Math.round(labor * 100) / 100, total: Math.round((material + labor) * 100) / 100 };
}

export function getTradeMultiplier(category, region, multipliers) {
  const mult = multipliers.find(m => m.region === region) || multipliers.find(m => m.region === 'National') || {};
  const col = CATEGORY_TRADE_MAP[category] || 'overall_multiplier';
  return mult[col] || mult.overall_multiplier || 1;
}

export function getDefaultCostForCategory(category, region, pricingData, multipliers) {
  const pricingCat = CATEGORY_PRICING_MAP[category];
  if (!pricingCat) return null;

  // Find best matching item
  const matches = pricingData.filter(p => p.category === pricingCat);
  if (!matches.length) return null;

  // Average the costs for this category
  const tradeMult = getTradeMultiplier(category, region, multipliers);
  const mult = multipliers.find(m => m.region === region) || multipliers.find(m => m.region === 'National') || {};
  const matMult = mult.material_multiplier || 1;

  let totalCost = 0, count = 0;
  for (const item of matches) {
    const mat = (item.material_cost || 0) * matMult * INFLATION_FACTOR;
    const lab = (item.labor_cost || 0) * tradeMult * INFLATION_FACTOR;
    totalCost += mat + lab;
    count++;
  }
  return count > 0 ? Math.round(totalCost / count * 100) / 100 : null;
}

// US states list
export const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'Washington DC' },
];
