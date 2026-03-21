import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase.js';
import { TAKEOFF_CATS } from '../../lib/constants.js';
import { loadRegionalPricing, getRegionalCost, getRegionForState } from '../../lib/regionalPricing.js';

const CAT_MAP = Object.fromEntries(TAKEOFF_CATS.map(c => [c.id, c]));

export default function LibraryPanel({ onApplyItem, onApplyAssembly, onApplyTemplate, onSaveTemplate, onClose, projectRegion, projectItems }) {
  const [tab, setTab] = useState('items');
  const [regionalPricing, setRegionalPricing] = useState(null);
  const [rpSearch, setRpSearch] = useState('');
  const [collapsedRPCats, setCollapsedRPCats] = useState({});
  const [rpRegionOverride, setRpRegionOverride] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [expandedTemplate, setExpandedTemplate] = useState(null);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [items, setItems] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState(null);
  const [editAssembly, setEditAssembly] = useState(null);
  const [expandedAssembly, setExpandedAssembly] = useState(null);
  const [assemblyItems, setAssemblyItems] = useState([]);

  useEffect(() => {
    Promise.all([
      supabase.from('library_items').select('*').order('name'),
      supabase.from('library_assemblies').select('*').order('name'),
    ]).then(async ([{ data: li }, { data: la }]) => {
      let myItems = li || [];
      // Auto-populate starter items on first use
      if (myItems.length === 0) {
        const starters = [
          {name:'4" Sidewalk',category:'flatwork',unit:'SF',unit_cost:6.50,trade:'Concrete',source:'starter'},
          {name:'6" Slab on Grade',category:'flatwork',unit:'SF',unit_cost:7.75,trade:'Concrete',source:'starter'},
          {name:'4" Concrete Driveway',category:'flatwork',unit:'SF',unit_cost:7.00,trade:'Concrete',source:'starter'},
          {name:'Concrete Steps',category:'flatwork',unit:'SF',unit_cost:18.00,trade:'Concrete',source:'starter'},
          {name:'ADA Ramp',category:'flatwork',unit:'SF',unit_cost:12.00,trade:'Concrete',source:'starter'},
          {name:'Transformer Pad',category:'site_concrete',unit:'EA',unit_cost:1050.00,trade:'Concrete',source:'starter'},
          {name:'Rolled Curb 18"',category:'curb_gutter',unit:'LF',unit_cost:22.00,trade:'Curb & Gutter',source:'starter'},
          {name:'Barrier Curb 24"',category:'curb_gutter',unit:'LF',unit_cost:28.00,trade:'Curb & Gutter',source:'starter'},
          {name:'Curb Ramp (ADA)',category:'curb_gutter',unit:'EA',unit_cost:2000.00,trade:'Curb & Gutter',source:'starter'},
          {name:'Detectable Warning Mat',category:'curb_gutter',unit:'EA',unit_cost:350.00,trade:'Curb & Gutter',source:'starter'},
          {name:'Rebar #4',category:'foundations',unit:'LF',unit_cost:0.75,trade:'Reinforcement',source:'starter'},
          {name:'Rebar #5',category:'foundations',unit:'LF',unit_cost:1.02,trade:'Reinforcement',source:'starter'},
          {name:'Wire Mesh 6x6',category:'flatwork',unit:'SF',unit_cost:0.35,trade:'Reinforcement',source:'starter'},
          {name:'Fiber Mesh',category:'site_concrete',unit:'CY',unit_cost:6.00,trade:'Reinforcement',source:'starter'},
          {name:'8" CMU Wall',category:'masonry',unit:'SF',unit_cost:13.00,trade:'Masonry',source:'starter'},
          {name:'12" CMU Wall',category:'masonry',unit:'SF',unit_cost:15.75,trade:'Masonry',source:'starter'},
          {name:'Brick Veneer',category:'masonry',unit:'SF',unit_cost:16.00,trade:'Masonry',source:'starter'},
          {name:'Grout Fill 8" Cells',category:'masonry',unit:'LF',unit_cost:3.00,trade:'Masonry',source:'starter'},
          {name:'Bond Beam',category:'masonry',unit:'LF',unit_cost:12.00,trade:'Masonry',source:'starter'},
          {name:'Bulk Excavation',category:'grading',unit:'CY',unit_cost:5.50,trade:'Earthwork',source:'starter'},
          {name:'Fine Grading',category:'grading',unit:'SF',unit_cost:0.50,trade:'Earthwork',source:'starter'},
          {name:'GAB Base',category:'grading',unit:'CY',unit_cost:55.00,trade:'Earthwork',source:'starter'},
          {name:'Silt Fence',category:'grading',unit:'LF',unit_cost:2.50,trade:'Earthwork',source:'starter'},
          {name:'Topsoil',category:'grading',unit:'CY',unit_cost:42.00,trade:'Earthwork',source:'starter'},
          {name:'HMA 3"',category:'asphalt',unit:'SF',unit_cost:3.25,trade:'Asphalt',source:'starter'},
          {name:'Parking Stripe 4"',category:'asphalt',unit:'LF',unit_cost:0.25,trade:'Asphalt',source:'starter'},
          {name:'Wheel Stop',category:'asphalt',unit:'EA',unit_cost:95.00,trade:'Asphalt',source:'starter'},
          {name:'Steel Bollard',category:'other',unit:'EA',unit_cost:700.00,trade:'Asphalt',source:'starter'},
          {name:'TPO 60mil',category:'roofing',unit:'SF',unit_cost:6.75,trade:'Roofing',source:'starter'},
          {name:'Polyiso 2"',category:'roofing',unit:'SF',unit_cost:1.65,trade:'Roofing',source:'starter'},
          {name:'Base Flashing',category:'roofing',unit:'LF',unit_cost:13.50,trade:'Roofing',source:'starter'},
          // Painting
          {name:'Interior Wall Paint (2 coats)',category:'painting',unit:'SF',unit_cost:1.60,trade:'Painting',source:'starter'},
          {name:'Exterior Paint (2 coats)',category:'painting',unit:'SF',unit_cost:2.00,trade:'Painting',source:'starter'},
          {name:'Trim/Baseboard Paint',category:'painting',unit:'LF',unit_cost:1.50,trade:'Painting',source:'starter'},
          {name:'Cabinet Painting',category:'painting',unit:'LF',unit_cost:30.00,trade:'Painting',source:'starter'},
          {name:'Pressure Washing',category:'painting',unit:'SF',unit_cost:0.25,trade:'Painting',source:'starter'},
          // Flooring
          {name:'LVP (Luxury Vinyl Plank)',category:'flooring',unit:'SF',unit_cost:5.00,trade:'Flooring',source:'starter'},
          {name:'Ceramic Tile',category:'flooring',unit:'SF',unit_cost:7.00,trade:'Flooring',source:'starter'},
          {name:'Carpet (commercial)',category:'flooring',unit:'SF',unit_cost:4.00,trade:'Flooring',source:'starter'},
          {name:'Hardwood (engineered)',category:'flooring',unit:'SF',unit_cost:8.00,trade:'Flooring',source:'starter'},
          {name:'Rubber Cove Base',category:'flooring',unit:'LF',unit_cost:1.50,trade:'Flooring',source:'starter'},
          // Drywall
          {name:'Drywall 1/2" Complete (hang+L4)',category:'drywall',unit:'SF',unit_cost:2.00,trade:'Drywall',source:'starter'},
          {name:'Drywall 5/8" Type X Complete',category:'drywall',unit:'SF',unit_cost:2.50,trade:'Drywall',source:'starter'},
          {name:'Metal Stud Wall 3-5/8"',category:'drywall',unit:'SF',unit_cost:3.00,trade:'Drywall',source:'starter'},
          {name:'Fiberglass Batt R-13',category:'drywall',unit:'SF',unit_cost:1.05,trade:'Drywall',source:'starter'},
          {name:'Corner Bead',category:'drywall',unit:'LF',unit_cost:1.00,trade:'Drywall',source:'starter'},
          // HVAC
          {name:'RTU per Ton',category:'hvac',unit:'EA',unit_cost:2000.00,trade:'HVAC',source:'starter'},
          {name:'Sheet Metal Duct',category:'hvac',unit:'LF',unit_cost:25.00,trade:'HVAC',source:'starter'},
          {name:'Flex Duct 6"',category:'hvac',unit:'LF',unit_cost:6.00,trade:'HVAC',source:'starter'},
          {name:'Supply Diffuser 2x2',category:'hvac',unit:'EA',unit_cost:100.00,trade:'HVAC',source:'starter'},
          {name:'Thermostat (programmable)',category:'hvac',unit:'EA',unit_cost:150.00,trade:'HVAC',source:'starter'},
          // Landscaping
          {name:'Bermuda Sod',category:'landscaping',unit:'SF',unit_cost:0.75,trade:'Landscaping',source:'starter'},
          {name:'Shade Tree 3" cal',category:'landscaping',unit:'EA',unit_cost:400.00,trade:'Landscaping',source:'starter'},
          {name:'Shrub 5 gal',category:'landscaping',unit:'EA',unit_cost:45.00,trade:'Landscaping',source:'starter'},
          {name:'Mulch (3" depth)',category:'landscaping',unit:'SF',unit_cost:0.35,trade:'Landscaping',source:'starter'},
          {name:'Irrigation per SF',category:'irrigation',unit:'SF',unit_cost:1.25,trade:'Landscaping',source:'starter'},
          {name:'Wood Privacy Fence 6ft',category:'fencing',unit:'LF',unit_cost:25.00,trade:'Landscaping',source:'starter'},
          // Remodeling
          {name:'Interior Door (hollow)',category:'other',unit:'EA',unit_cost:250.00,trade:'Remodeling',source:'starter'},
          {name:'Window (vinyl DH)',category:'other',unit:'EA',unit_cost:525.00,trade:'Remodeling',source:'starter'},
          {name:'Crown Molding',category:'other',unit:'LF',unit_cost:6.00,trade:'Remodeling',source:'starter'},
          {name:'Countertop Quartz',category:'other',unit:'LF',unit_cost:75.00,trade:'Remodeling',source:'starter'},
          {name:'Electrical Outlet',category:'electrical',unit:'EA',unit_cost:100.00,trade:'Remodeling',source:'starter'},
          {name:'Recessed Light',category:'electrical',unit:'EA',unit_cost:150.00,trade:'Remodeling',source:'starter'},
        ];
        const { data: inserted } = await supabase.from('library_items').insert(starters).select();
        if (inserted) myItems = inserted;
      }
      setItems(myItems);
      setAssemblies(la || []);
      setLoading(false);
    });
    loadRegionalPricing().then(d => setRegionalPricing(d)).catch(() => {});
    supabase.from('takeoff_templates').select('*').order('created_at',{ascending:false}).then(({data})=>setTemplates(data||[]));
  }, []);

  const loadAssemblyItems = async (assemblyId) => {
    const { data } = await supabase.from('library_assembly_items').select('*, library_items(*)').eq('assembly_id', assemblyId).order('sort_order');
    setAssemblyItems(data || []);
  };

  const filtered = items.filter(i => {
    if (filterCat !== 'all' && i.category !== filterCat) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase()) && !(i.trade || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const grouped = {};
  filtered.forEach(i => {
    const trade = i.trade || 'Other';
    if (!grouped[trade]) grouped[trade] = [];
    grouped[trade].push(i);
  });

  const saveItem = async (item) => {
    if (item.id) {
      const { data } = await supabase.from('library_items').update({
        name: item.name, category: item.category, unit: item.unit,
        unit_cost: Number(item.unit_cost) || 0, labor_cost: Number(item.labor_cost) || 0,
        material_cost: Number(item.material_cost) || 0, description: item.description,
        trade: item.trade, source: 'custom', updated_at: new Date().toISOString(),
      }).eq('id', item.id).select().single();
      if (data) setItems(prev => prev.map(i => i.id === data.id ? data : i));
    } else {
      const { data } = await supabase.from('library_items').insert([{
        name: item.name, category: item.category || 'other', unit: item.unit || 'SF',
        unit_cost: Number(item.unit_cost) || 0, labor_cost: Number(item.labor_cost) || 0,
        material_cost: Number(item.material_cost) || 0, description: item.description,
        trade: item.trade, source: 'custom',
      }]).select().single();
      if (data) setItems(prev => [...prev, data]);
    }
    setEditItem(null);
  };

  const deleteItem = async (id) => {
    await supabase.from('library_items').delete().eq('id', id);
    setItems(prev => prev.filter(i => i.id !== id));
    setEditItem(null);
  };

  const fmtCost = v => v > 0 ? `$${Number(v).toFixed(2)}` : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #E0E0E0', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#333', flex: 1 }}>Item Library</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 18 }}>&times;</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #E0E0E0' }}>
        {['items', 'assemblies', 'regional', 'templates'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: '8px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? '#4CAF50' : '#666',
              borderBottom: tab === t ? '2px solid #4CAF50' : '2px solid transparent' }}>
            {t==='items'?'My Items':t==='assemblies'?'My Assemblies':t==='regional'?'Cost Database':'Templates'}
          </button>
        ))}
      </div>

      {/* Tab description */}
      <div style={{padding:'4px 12px',fontSize:10,color:'#999',borderBottom:'1px solid #f0f0f0',background:'#fafafa'}}>
        {tab==='items'&&'Your saved prices from previous bids'}
        {tab==='assemblies'&&'Your saved item groups'}
        {tab==='regional'&&'Industry average pricing adjusted by region'}
        {tab==='templates'&&'Reusable takeoff setups'}
      </div>

      {/* Search + Filter */}
      {tab === 'items' && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items..."
            style={{ flex: 1, padding: '6px 10px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 12, outline: 'none', color: '#333' }} />
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            style={{ padding: '6px 8px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 11, outline: 'none', color: '#666' }}>
            <option value="all">All categories</option>
            {TAKEOFF_CATS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button onClick={() => setEditItem({ name: '', category: 'other', unit: 'SF', unit_cost: 0, labor_cost: 0, material_cost: 0, trade: '', description: '' })}
            style={{ padding: '6px 12px', background: '#4CAF50', border: 'none', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>
            + Add
          </button>
        </div>
      )}

      {/* Items List */}
      {tab === 'items' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 20, color: '#999', fontSize: 12, textAlign: 'center' }}>Loading...</div>}
          {Object.entries(grouped).map(([trade, tradeItems]) => (
            <div key={trade}>
              <div style={{ padding: '6px 16px', fontSize: 10, fontWeight: 700, color: '#999', background: '#f8f8f8', letterSpacing: 0.5 }}>{trade.toUpperCase()}</div>
              {tradeItems.map(item => (
                <div key={item.id}
                  style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', gap: 10 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  onClick={() => setEditItem({ ...item })}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: CAT_MAP[item.category]?.color || '#999', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.source === 'stock' && <span style={{ color: '#999', fontSize: 9, marginRight: 4 }}>STK</span>}
                      {item.source === 'starter' && <span style={{ color: '#5B9BD5', fontSize: 8, marginRight: 4, background: '#EBF5FB', padding: '0 3px', borderRadius: 2 }}>Starter</span>}
                      {item.name}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: '#999', width: 30, textAlign: 'center' }}>{item.unit}</span>
                  <span style={{ fontSize: 11, color: '#333', fontWeight: 500, width: 60, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtCost(item.unit_cost)}</span>
                  <button onClick={e => { e.stopPropagation(); onApplyItem(item); }}
                    style={{ padding: '3px 8px', background: '#4CAF50', border: 'none', color: '#fff', borderRadius: 3, cursor: 'pointer', fontSize: 10, fontWeight: 500, flexShrink: 0 }}>
                    Use
                  </button>
                </div>
              ))}
            </div>
          ))}
          {!loading && !filtered.length && <div style={{ padding: 30, color: '#999', fontSize: 12, textAlign: 'center' }}>No items found</div>}
        </div>
      )}

      {/* Assemblies List */}
      {tab === 'assemblies' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {assemblies.map(a => (
            <div key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', cursor: 'pointer', gap: 8 }}
                onClick={() => { if (expandedAssembly === a.id) { setExpandedAssembly(null); } else { setExpandedAssembly(a.id); loadAssemblyItems(a.id); } }}>
                <span style={{ fontSize: 10, color: '#999' }}>{expandedAssembly === a.id ? '▼' : '▶'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#333' }}>{a.name}</div>
                  {a.description && <div style={{ fontSize: 11, color: '#999' }}>{a.description}</div>}
                </div>
                <button onClick={e => { e.stopPropagation(); onApplyAssembly(a, assemblyItems); }}
                  style={{ padding: '3px 8px', background: '#4CAF50', border: 'none', color: '#fff', borderRadius: 3, cursor: 'pointer', fontSize: 10, fontWeight: 500 }}>
                  Apply
                </button>
              </div>
              {expandedAssembly === a.id && (
                <div style={{ padding: '0 16px 8px 32px' }}>
                  {assemblyItems.map(ai => (
                    <div key={ai.id} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 11, color: '#666' }}>
                      <span style={{ flex: 1 }}>{ai.custom_name || ai.library_items?.name || '—'}</span>
                      <span>{ai.unit || ai.library_items?.unit}</span>
                      <span style={{ fontWeight: 500 }}>{fmtCost(ai.unit_cost || ai.library_items?.unit_cost)}</span>
                    </div>
                  ))}
                  {!assemblyItems.length && <div style={{ fontSize: 11, color: '#ccc', padding: '4px 0' }}>No items in assembly</div>}
                </div>
              )}
            </div>
          ))}
          {!assemblies.length && <div style={{ padding: 30, color: '#999', fontSize: 12, textAlign: 'center' }}>No assemblies yet</div>}
        </div>
      )}

      {/* Regional Pricing Tab */}
      {tab === 'regional' && (()=>{
        const region = rpRegionOverride || projectRegion || 'National';
        const availableRegions = regionalPricing?.multipliers?.map(m=>m.region) || ['National'];
        const allRP = regionalPricing?.pricing || [];
        const filtered = allRP.filter(p => !rpSearch || p.item_name.toLowerCase().includes(rpSearch.toLowerCase()) || p.category.toLowerCase().includes(rpSearch.toLowerCase()));
        // Group by category
        const grouped = {};
        for(const p of filtered){
          const cat = p.category || 'Other';
          if(!grouped[cat]) grouped[cat] = [];
          grouped[cat].push(p);
        }
        const catToApp = (cat) => {
          const lc = cat.toLowerCase();
          if(lc.includes('concrete')) return 'site_concrete';
          if(lc.includes('masonry')||lc.includes('block')||lc.includes('brick')) return 'masonry';
          if(lc.includes('asphalt')||lc.includes('paving')) return 'asphalt';
          if(lc.includes('earthwork')||lc.includes('grading')||lc.includes('excavat')) return 'grading';
          if(lc.includes('curb')) return 'curb_gutter';
          if(lc.includes('foundation')||lc.includes('footing')) return 'foundations';
          if(lc.includes('flatwork')||lc.includes('slab')||lc.includes('sidewalk')) return 'flatwork';
          return 'other';
        };
        return(
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={rpSearch} onChange={e => setRpSearch(e.target.value)} placeholder="Search regional items..."
              style={{ flex: 1, padding: '6px 10px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 12, outline: 'none', color: '#333' }} />
            <select value={region} onChange={e=>setRpRegionOverride(e.target.value)}
              style={{padding:'4px 6px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:11,color:'#4CAF50',fontWeight:600,background:'#fff',outline:'none',cursor:'pointer',flexShrink:0}}>
              {availableRegions.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
            <span style={{ fontSize: 10, color: '#999', flexShrink: 0 }}>{filtered.length} items</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {(()=>{
              // Trade colors and display order
              const TRADE_COLORS = {
                'Concrete':'#D4A04A','Masonry':'#C87941','Earthwork':'#6B8E23','Asphalt':'#808080',
                'Roofing':'#C0504D','Painting':'#5B9BD5','Flooring':'#4A90A4','Drywall':'#7B6BA4',
                'HVAC':'#4A90A4','Landscaping':'#4CAF50','Remodeling':'#E8A317',
              };
              const TRADE_DISPLAY_ORDER = ['Concrete','Masonry','Earthwork','Asphalt','Roofing','Painting','Flooring','Drywall','HVAC','Landscaping','Remodeling'];

              // Auto-group categories by their prefix (everything before " - ")
              const tradeMap = new Map();
              const allCats = Object.keys(grouped);
              for(const cat of allCats){
                const prefix = cat.includes(' - ') ? cat.split(' - ')[0].trim() : cat;
                if(!tradeMap.has(prefix)) tradeMap.set(prefix, []);
                tradeMap.get(prefix).push(cat);
              }

              // Build ordered trade groups
              const TRADE_ORDER = [];
              const added = new Set();
              for(const trade of TRADE_DISPLAY_ORDER){
                if(tradeMap.has(trade)){ TRADE_ORDER.push({trade:trade.toUpperCase(), color:TRADE_COLORS[trade]||'#999', cats:tradeMap.get(trade)}); added.add(trade); }
              }
              // Add any remaining trades not in the display order
              for(const [trade, cats] of tradeMap){
                if(!added.has(trade)) TRADE_ORDER.push({trade:trade.toUpperCase(), color:'#999', cats});
              }

              return TRADE_ORDER.map(tg=>{
                const tradeCats = tg.cats.filter(c=>grouped[c]);
                if(!tradeCats.length) return null;
                const tradeCollapsed = collapsedRPCats?.['_trade_'+tg.trade] !== true; // default closed
                const tradeTotal = tradeCats.reduce((s,c)=>s+(grouped[c]?.length||0),0);
                return(
                <div key={tg.trade}>
                  {/* Trade header */}
                  <div onClick={()=>setCollapsedRPCats(prev=>({...prev,['_trade_'+tg.trade]:!prev?.['_trade_'+tg.trade]}))}
                    style={{padding:'8px 12px',fontSize:12,fontWeight:700,color:tg.color,background:'#f0f0f0',cursor:'pointer',display:'flex',alignItems:'center',gap:6,borderBottom:'1px solid #E0E0E0',borderLeft:`3px solid ${tg.color}`,userSelect:'none'}}>
                    <span style={{fontSize:10}}>{tradeCollapsed?'▶':'▼'}</span>
                    {tg.trade}
                    <span style={{fontWeight:400,color:'#bbb',marginLeft:'auto',fontSize:11}}>{tradeTotal}</span>
                  </div>
                  {!tradeCollapsed && tradeCats.map(cat=>{
                    const catItems = grouped[cat];
                    const isCollapsed = collapsedRPCats?.[cat] !== true; // default closed
                    return(
                    <div key={cat}>
                      <div onClick={()=>setCollapsedRPCats(prev=>({...prev,[cat]:!prev?.[cat]}))}
                        style={{padding:'5px 12px 5px 24px',fontSize:11,fontWeight:600,color:'#666',background:'#f8f8f8',cursor:'pointer',display:'flex',alignItems:'center',gap:6,borderBottom:'1px solid #f0f0f0',userSelect:'none'}}>
                        <span style={{fontSize:8,color:'#bbb'}}>{isCollapsed?'▶':'▼'}</span>
                        {cat.split(' - ')[1]||cat}
                        <span style={{fontWeight:400,color:'#ccc',marginLeft:'auto'}}>{catItems.length}</span>
                      </div>
                {!isCollapsed && catItems.map(p => {
                  const rc = getRegionalCost(p, region, regionalPricing?.multipliers || []);
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 12px 6px 20px', borderBottom: '1px solid #f8f8f8', gap: 6 }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.item_name}</div>
                        <div style={{ fontSize: 10, color: '#bbb' }}>{p.unit}</div>
                      </div>
                      <span style={{ fontSize: 10, color: '#999', fontVariantNumeric: 'tabular-nums', width: 50, textAlign: 'right', flexShrink: 0 }}>M: ${rc.material.toFixed(0)}</span>
                      <span style={{ fontSize: 10, color: '#999', fontVariantNumeric: 'tabular-nums', width: 45, textAlign: 'right', flexShrink: 0 }}>L: ${rc.labor.toFixed(0)}</span>
                      <span style={{ fontWeight: 600, fontSize: 11, color: '#333', fontVariantNumeric: 'tabular-nums', width: 55, textAlign: 'right', flexShrink: 0 }}>${rc.total.toFixed(2)}</span>
                      <button onClick={() => onApplyItem({ name: p.item_name, category: catToApp(p.category), unit: p.unit, unit_cost: rc.total })}
                        style={{ padding: '2px 7px', background: '#4CAF50', border: 'none', color: '#fff', borderRadius: 3, cursor: 'pointer', fontSize: 9, fontWeight: 500, flexShrink: 0 }}>
                        Use
                      </button>
                      <button onClick={async()=>{
                        const {data}=await supabase.from('library_items').insert([{
                          name:p.item_name, category:catToApp(p.category), unit:p.unit,
                          unit_cost:rc.total, material_cost:rc.material, labor_cost:rc.labor,
                          trade:p.category.split(' - ')[0]||'', source:'regional',
                        }]).select().single();
                        if(data){setItems(prev=>[...prev,data]);alert('Saved to My Items');}
                      }}
                        style={{padding:'2px 5px',background:'none',border:'1px solid #E0E0E0',color:'#999',borderRadius:3,cursor:'pointer',fontSize:8,flexShrink:0}}
                        title="Save to My Items">
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
                    );
                  })}
                </div>
                );
              });
            })()}
            {!regionalPricing && <div style={{ padding: 30, color: '#999', fontSize: 12, textAlign: 'center' }}>Loading regional pricing...</div>}
            {regionalPricing && !filtered.length && <div style={{ padding: 30, color: '#999', fontSize: 12, textAlign: 'center' }}>No items match your search</div>}
          </div>
        </div>
        );
      })()}

      {/* Templates Tab */}
      {tab === 'templates' && (
        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column'}}>
          {/* Save current project as template */}
          {projectItems?.length>0&&(
            <div style={{padding:'10px 12px',borderBottom:'1px solid #f0f0f0',display:'flex',gap:6,alignItems:'center'}}>
              <input value={newTemplateName} onChange={e=>setNewTemplateName(e.target.value)} placeholder="Template name..."
                style={{flex:1,padding:'6px 10px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:12,outline:'none',color:'#333'}}/>
              <button disabled={!newTemplateName.trim()} onClick={async()=>{
                const tItems = projectItems.filter(i=>i.plan_id!=null).map(i=>({
                  category:i.category,description:i.description,unit:i.unit,unit_cost:i.unit_cost,
                  color:i.color,measurement_type:i.measurement_type,waste_percent:i.waste_percent||0,
                }));
                const {data}=await supabase.from('takeoff_templates').insert([{name:newTemplateName.trim(),items:tItems}]).select().single();
                if(data){setTemplates(prev=>[data,...prev]);setNewTemplateName('');}
              }} style={{padding:'6px 12px',background:'#4CAF50',border:'none',color:'#fff',borderRadius:4,cursor:'pointer',fontSize:11,fontWeight:500,opacity:newTemplateName.trim()?1:0.4}}>
                Save Current
              </button>
            </div>
          )}
          <div style={{flex:1,overflowY:'auto'}}>
            {templates.map(tmpl=>{
              const tmplItems = Array.isArray(tmpl.items)?tmpl.items:[];
              const isExpanded = expandedTemplate===tmpl.id;
              return(
                <div key={tmpl.id} style={{borderBottom:'1px solid #f0f0f0'}}>
                  <div style={{display:'flex',alignItems:'center',padding:'10px 12px',cursor:'pointer',gap:8}}
                    onClick={()=>setExpandedTemplate(isExpanded?null:tmpl.id)}>
                    <span style={{fontSize:10,color:'#999'}}>{isExpanded?'▼':'▶'}</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:500,color:'#333'}}>{tmpl.name}</div>
                      <div style={{fontSize:10,color:'#999'}}>{tmplItems.length} items{tmpl.description?' · '+tmpl.description:''}</div>
                    </div>
                    <button onClick={e=>{e.stopPropagation();onApplyTemplate?.(tmpl);}}
                      style={{padding:'4px 10px',background:'#4CAF50',border:'none',color:'#fff',borderRadius:3,cursor:'pointer',fontSize:10,fontWeight:500}}>
                      Apply
                    </button>
                    <button onClick={async e=>{
                      e.stopPropagation();
                      if(!window.confirm('Delete template "'+tmpl.name+'"?'))return;
                      await supabase.from('takeoff_templates').delete().eq('id',tmpl.id);
                      setTemplates(prev=>prev.filter(t=>t.id!==tmpl.id));
                    }} style={{background:'none',border:'none',color:'#ccc',cursor:'pointer',fontSize:14}}>&#10005;</button>
                  </div>
                  {isExpanded&&(
                    <div style={{padding:'0 12px 10px 28px'}}>
                      {tmplItems.map((it,i)=>(
                        <div key={i} style={{display:'flex',alignItems:'center',gap:6,padding:'3px 0',fontSize:11,color:'#666'}}>
                          <div style={{width:6,height:6,borderRadius:1,background:it.color||'#999',flexShrink:0}}/>
                          <span style={{flex:1}}>{it.description}</span>
                          <span style={{color:'#999'}}>{it.unit}</span>
                          <span style={{fontVariantNumeric:'tabular-nums'}}>${(it.unit_cost||0).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!templates.length&&<div style={{padding:30,color:'#999',fontSize:12,textAlign:'center'}}>No templates yet. Save your current takeoff items as a template above.</div>}
          </div>
        </div>
      )}

      {/* Edit Item Modal */}
      {editItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setEditItem(null)}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, width: 420, maxHeight: '80vh', overflow: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 16 }}>{editItem.id ? 'Edit Item' : 'New Item'}</div>
            {[
              ['name', 'Name', 'text'],
              ['trade', 'Trade', 'text'],
              ['description', 'Description', 'text'],
            ].map(([k, lbl, type]) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{lbl}</div>
                <input type={type} value={editItem[k] || ''} onChange={e => setEditItem(prev => ({ ...prev, [k]: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 13, color: '#333', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Category</div>
                <select value={editItem.category || 'other'} onChange={e => setEditItem(prev => ({ ...prev, category: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 12, color: '#333', outline: 'none' }}>
                  {TAKEOFF_CATS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Unit</div>
                <select value={editItem.unit || 'SF'} onChange={e => setEditItem(prev => ({ ...prev, unit: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 12, color: '#333', outline: 'none' }}>
                  {['SF', 'LF', 'CY', 'EA', 'LS', 'TN', 'LB', 'HR'].map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
              {[['unit_cost', 'Unit Cost'], ['labor_cost', 'Labor'], ['material_cost', 'Material']].map(([k, lbl]) => (
                <div key={k}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{lbl}</div>
                  <input type="number" step="0.01" value={editItem[k] || ''} onChange={e => setEditItem(prev => ({ ...prev, [k]: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 13, color: '#333', outline: 'none', boxSizing: 'border-box' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              {editItem.id && editItem.source !== 'stock' && (
                <button onClick={() => { if (window.confirm('Delete this item?')) deleteItem(editItem.id); }}
                  style={{ padding: '8px 14px', background: '#fef2f2', border: '1px solid #e0c0c0', color: '#C0504D', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>Delete</button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={() => setEditItem(null)} style={{ padding: '8px 14px', border: '1px solid #E0E0E0', background: '#fff', color: '#666', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
              <button onClick={() => saveItem(editItem)} style={{ padding: '8px 14px', background: '#4CAF50', border: 'none', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
