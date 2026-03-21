import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase.js';
import { TAKEOFF_CATS } from '../../lib/constants.js';
import { loadRegionalPricing, getRegionalCost, getRegionForState } from '../../lib/regionalPricing.js';

const CAT_MAP = Object.fromEntries(TAKEOFF_CATS.map(c => [c.id, c]));

export default function LibraryPanel({ onApplyItem, onApplyAssembly, onClose, projectRegion }) {
  const [tab, setTab] = useState('items');
  const [regionalPricing, setRegionalPricing] = useState(null);
  const [rpSearch, setRpSearch] = useState('');
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
    ]).then(([{ data: li }, { data: la }]) => {
      setItems(li || []);
      setAssemblies(la || []);
      setLoading(false);
    });
    loadRegionalPricing().then(d => setRegionalPricing(d)).catch(() => {});
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
        trade: item.trade, updated_at: new Date().toISOString(),
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
        {['items', 'assemblies', 'regional'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: '8px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? '#4CAF50' : '#666',
              borderBottom: tab === t ? '2px solid #4CAF50' : '2px solid transparent' }}>
            {t === 'items' ? 'Items' : t === 'assemblies' ? 'Assemblies' : 'Regional'}
          </button>
        ))}
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
      {tab === 'regional' && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={rpSearch} onChange={e => setRpSearch(e.target.value)} placeholder="Search regional items..."
              style={{ flex: 1, padding: '6px 10px', border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 12, outline: 'none', color: '#333' }} />
            <span style={{ fontSize: 11, color: '#999', flexShrink: 0 }}>{projectRegion || 'National'}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {regionalPricing?.pricing?.filter(p => !rpSearch || p.item_name.toLowerCase().includes(rpSearch.toLowerCase()) || p.category.toLowerCase().includes(rpSearch.toLowerCase()))
              .map(p => {
                const rc = getRegionalCost(p, projectRegion || 'National', regionalPricing.multipliers);
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0', gap: 8 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: '#333' }}>{p.item_name}</div>
                      <div style={{ fontSize: 10, color: '#999' }}>{p.category} · {p.unit}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 8 }}>
                      <div style={{ fontSize: 11, color: '#666', fontVariantNumeric: 'tabular-nums' }}>Mat: ${rc.material.toFixed(2)}</div>
                      <div style={{ fontSize: 11, color: '#666', fontVariantNumeric: 'tabular-nums' }}>Lab: ${rc.labor.toFixed(2)}</div>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 12, color: '#333', fontVariantNumeric: 'tabular-nums', width: 60, textAlign: 'right', flexShrink: 0 }}>
                      ${rc.total.toFixed(2)}
                    </div>
                    <button onClick={() => onApplyItem({ name: p.item_name, category: p.category === 'Concrete' ? 'site_concrete' : p.category === 'Masonry' ? 'masonry' : p.category === 'Paving' ? 'asphalt' : p.category === 'Earthwork' ? 'grading' : 'other', unit: p.unit, unit_cost: rc.total })}
                      style={{ padding: '3px 8px', background: '#4CAF50', border: 'none', color: '#fff', borderRadius: 3, cursor: 'pointer', fontSize: 10, fontWeight: 500, flexShrink: 0 }}>
                      Use
                    </button>
                  </div>
                );
              })}
            {!regionalPricing && <div style={{ padding: 30, color: '#999', fontSize: 12, textAlign: 'center' }}>Loading regional pricing...</div>}
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
