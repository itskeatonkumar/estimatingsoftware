import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTheme, labelStyle, inputStyle } from "../../lib/theme.jsx";
import { TAKEOFF_CATS, TAKEOFF_TYPES, TO_COLORS, CONSTRUCTION_SCALES, UNIT_COSTS_DEFAULT, ASSEMBLIES } from "../../lib/constants.js";
import { supabase } from "../../lib/supabase.js";
import { APMModal, APMField } from "../../components/ui/Modal.jsx";

function TakeoffItemModal({ item, onSave, onClose }) {
  const { t } = useTheme();
  const isNew = !item?.id;
  const cat = TAKEOFF_CATS.find(c=>c.id===item?.category) || TAKEOFF_CATS[0];
  const [form, setForm] = useState({
    category: cat.id, description: item?.description||'', quantity: item?.quantity||'',
    unit: item?.unit||cat.unit, unit_cost: item?.unit_cost||cat.defaultCost,
    ...(item||{})
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const total = (Number(form.quantity)||0) * (Number(form.multiplier)||1) * (Number(form.unit_cost)||0);
  const dynInput = {...inputStyle, background:t.input, borderColor:t.inputBorder, color:t.inputText, fontSize:13};

  const handleSave = async () => {
    const payload = {...form, quantity:Number(form.quantity)||0, unit_cost:Number(form.unit_cost)||0, multiplier:Number(form.multiplier)||1, height:Number(form.height)||0, total_cost:total};
    if (isNew) {
      const {data} = await supabase.from('takeoff_items').insert([payload]).select().single();
      if (data) onSave(data, true);
    } else {
      await supabase.from('takeoff_items').update(payload).eq('id', item.id);
      onSave({...item,...payload}, false);
    }
  };

  return (
    <APMModal title={isNew?'New Takeoff Item':'Edit Takeoff Item'} onClose={onClose} width={480}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <APMField label="Category">
          <select value={form.category} onChange={e=>{
            const c=TAKEOFF_CATS.find(x=>x.id===e.target.value)||TAKEOFF_CATS[0];
            set('category',e.target.value); set('unit',c.unit); set('unit_cost',c.defaultCost);
          }} style={{...dynInput}}>
            {TAKEOFF_CATS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </APMField>
        <APMField label="Description">
          <input value={form.description} onChange={e=>set('description',e.target.value)} style={{...dynInput,fontSize:14}} autoFocus />
        </APMField>
        <APMField label="Color">
          <div style={{display:'flex',flexWrap:'wrap',gap:5,padding:'4px 0'}}>
            {['#4CAF50','#5B9BD5','#F59E0B','#C0504D','#8B5CF6','#E8A317','#06B6D4','#EC4899','#84CC16','#A855F7','#14B8A6','#6B7280'].map(c=>(
              <button key={c} onClick={()=>set('color',c)}
                style={{width:22,height:22,borderRadius:5,background:c,border:form.color===c?'2px solid #fff':'2px solid transparent',
                  cursor:'pointer',padding:0,flexShrink:0,boxShadow:form.color===c?`0 0 0 2px ${c}`:undefined,transition:'box-shadow 0.1s'}}/>
            ))}
          </div>
        </APMField>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
          <APMField label="Quantity"><input type="number" value={form.quantity} onChange={e=>set('quantity',e.target.value)} style={{...dynInput}} /></APMField>
          <APMField label="Unit"><input value={form.unit} onChange={e=>set('unit',e.target.value)} style={{...dynInput}} /></APMField>
          <APMField label="Unit Cost ($)"><input type="number" value={form.unit_cost} onChange={e=>set('unit_cost',e.target.value)} style={{...dynInput}} /></APMField>
        </div>
        <div style={{display:'grid',gridTemplateColumns:form.measurement_type==='linear'?'1fr 1fr':'1fr',gap:10}}>
          <APMField label="Multiplier"><input type="number" value={form.multiplier||1} onChange={e=>set('multiplier',e.target.value)} style={{...dynInput}} /></APMField>
          {form.measurement_type==='linear'&&(
            <APMField label="Wall Height (ft)"><input type="number" value={form.height||''} onChange={e=>set('height',e.target.value)} placeholder="0 = LF only" style={{...dynInput}} /></APMField>
          )}
        </div>
        <div style={{background:t.bg5,borderRadius:6,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:11,color:t.text3,fontVariantNumeric:'tabular-nums'}}>TOTAL</span>
          <span style={{fontSize:15,fontWeight:700,color:t.text,fontVariantNumeric:'tabular-nums'}}>${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'space-between'}}>
        {!isNew && <button onClick={async()=>{const {error}=await supabase.from('takeoff_items').delete().eq('id',item.id).select();if(error){console.error('item delete error:',error);alert('Delete failed: '+error.message);}else{onSave(null,'delete');}}} style={{background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.3)',color:'#C0504D',padding:'8px 14px',borderRadius:6,cursor:'pointer',fontSize:12}}>Delete</button>}
        <div style={{display:'flex',gap:8,marginLeft:'auto'}}>
          <button onClick={onClose} style={{background:'none',border:`1px solid ${t.border2}`,color:t.text3,padding:'8px 18px',borderRadius:6,cursor:'pointer',fontSize:13}}>Cancel</button>
          <button onClick={handleSave} style={{background:'#E8A317',border:'none',color:'#000',padding:'8px 22px',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:700}}>Save</button>
        </div>
      </div>
    </APMModal>
  );
}

function UnitCostEditor({ onClose }) {
  const { t } = useTheme();
  const [costs, setCosts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('unitCosts')||'{}'); } catch{ return {}; }
  });
  const merged = {...UNIT_COSTS_DEFAULT,...costs};
  const set = (cat, field, val) => setCosts(prev => ({...prev, [cat]:{...merged[cat],[field]:Number(val)||0}}));
  const save = () => { localStorage.setItem('unitCosts', JSON.stringify(costs)); onClose(); };
  const dynInput = {...inputStyle, fontSize:12, padding:'4px 8px', background:t.input, borderColor:t.inputBorder, color:t.inputText};

  return (
    <APMModal title="Unit Cost Database" onClose={onClose} width={620}>
      <div style={{fontSize:11,color:t.text3,marginBottom:12,fontVariantNumeric:'tabular-nums'}}>Edit your material and labor rates. Changes apply to all new estimates.</div>
      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:6,marginBottom:8}}>
        {['Category','Mat $/unit','Lab $/unit','Unit'].map(h=>(
          <div key={h} style={{fontSize:9,color:t.text4,fontVariantNumeric:'tabular-nums',letterSpacing:0.5,padding:'0 4px'}}>{h}</div>
        ))}
      </div>
      <div style={{maxHeight:340,overflowY:'auto',display:'flex',flexDirection:'column',gap:4}}>
        {TAKEOFF_CATS.map(cat => {
          const c = merged[cat.id]||{mat:0,lab:0,unit:cat.unit};
          return (
            <div key={cat.id} style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:6,alignItems:'center',padding:'5px 4px',borderRadius:5,background:t.bg4}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{width:8,height:8,borderRadius:2,background:cat.color,flexShrink:0}}/>
                <span style={{fontSize:11,color:t.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cat.label}</span>
              </div>
              <input type="number" value={c.mat} onChange={e=>set(cat.id,'mat',e.target.value)} style={{...dynInput}}/>
              <input type="number" value={c.lab} onChange={e=>set(cat.id,'lab',e.target.value)} style={{...dynInput}}/>
              <input value={c.unit||cat.unit} onChange={e=>set(cat.id,'unit',e.target.value)} style={{...dynInput}}/>
            </div>
          );
        })}
      </div>
      <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
        <button onClick={onClose} style={{background:'none',border:`1px solid ${t.border2}`,color:t.text3,padding:'8px 18px',borderRadius:6,cursor:'pointer',fontSize:13}}>Cancel</button>
        <button onClick={save} style={{background:'#E8A317',border:'none',color:'#000',padding:'8px 22px',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:700}}>Save Rates</button>
      </div>
    </APMModal>
  );
}

// ── Assembly Picker ───────────────────────────────────
function AssemblyPicker({ onApply, onClose }) {
  const { t } = useTheme();
  const [sel, setSel] = useState(null);
  const [qty, setQty] = useState('');

  const apply = () => {
    if(!sel||!qty) return;
    const asm = ASSEMBLIES.find(a=>a.id===sel);
    if(!asm) return;
    const costs = (() => { try { return {...UNIT_COSTS_DEFAULT,...JSON.parse(localStorage.getItem('unitCosts')||'{}')}; } catch{ return UNIT_COSTS_DEFAULT; } })();
    const items = asm.items.map(it => {
      const q = Number(qty) * it.qty_factor;
      const c = costs[it.category]||UNIT_COSTS_DEFAULT[it.category]||{mat:0,lab:0};
      const uc = (c.mat||0)+(c.lab||0);
      return { category:it.category, description:it.description, quantity:Math.round(q*10)/10, unit:it.unit, unit_cost:uc, total_cost:Math.round(q*uc*100)/100, measurement_type:'manual', ai_generated:false };
    });
    onApply(items);
  };

  return (
    <APMModal title="Assembly Library" onClose={onClose} width={480}>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {ASSEMBLIES.map(asm=>(
          <div key={asm.id} onClick={()=>setSel(asm.id)}
            style={{border:`1px solid ${sel===asm.id?'#E8A317':t.border}`,borderRadius:8,padding:'10px 12px',cursor:'pointer',background:sel===asm.id?'rgba(249,115,22,0.06)':t.bg4,transition:'all 0.1s'}}>
            <div style={{fontSize:13,fontWeight:700,color:sel===asm.id?'#E8A317':t.text,marginBottom:4}}>{asm.label}</div>
            <div style={{fontSize:10,color:t.text4,fontVariantNumeric:'tabular-nums'}}>{asm.items.map(i=>i.description).join(' · ')}</div>
          </div>
        ))}
      </div>
      {sel&&(
        <div style={{marginTop:14,display:'flex',alignItems:'center',gap:10}}>
          <div style={{flex:1}}>
            <label style={labelStyle}>Base Quantity ({ASSEMBLIES.find(a=>a.id===sel)?.items[0]?.unit||'SF'})</label>
            <input type="number" value={qty} onChange={e=>setQty(e.target.value)} placeholder="e.g. 2500" style={{...inputStyle,fontSize:14,width:'100%'}} autoFocus/>
          </div>
        </div>
      )}
      <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
        <button onClick={onClose} style={{background:'none',border:`1px solid ${t.border2}`,color:t.text3,padding:'8px 18px',borderRadius:6,cursor:'pointer',fontSize:13}}>Cancel</button>
        <button onClick={apply} disabled={!sel||!qty} style={{background:'#E8A317',border:'none',color:'#000',padding:'8px 22px',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:700,opacity:sel&&qty?1:0.4}}>Apply Assembly</button>
      </div>
    </APMModal>
  );
}

// ── Bid Summary Modal ─────────────────────────────────
function BidSummaryModal({ project, items, onClose }) {
  const { t } = useTheme();
  const [overhead, setOverhead] = useState(10);
  const [markup, setMarkup] = useState(8);
  const [bond, setBond] = useState(1.5);
  const [notes, setNotes] = useState('');

  const subtotal = items.reduce((s,i)=>s+(i.total_cost||0),0);
  const overheadAmt = subtotal * (overhead/100);
  const bondAmt = (subtotal+overheadAmt) * (bond/100);
  const markupAmt = (subtotal+overheadAmt+bondAmt) * (markup/100);
  const total = subtotal+overheadAmt+bondAmt+markupAmt;

  const catGroups = TAKEOFF_CATS.map(cat=>{
    const its = items.filter(i=>i.category===cat.id);
    return its.length?{...cat,subtotal:its.reduce((s,i)=>s+(i.total_cost||0),0)}:null;
  }).filter(Boolean);

  const printBid = () => {
    const win = window.open('','_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Bid Estimate - ${project.name}</title>
    <style>
      body{font-family:'Arial',sans-serif;max-width:800px;margin:40px auto;color:#111;font-size:13px}
      h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 8px;color:#333;border-bottom:1px solid #ddd;padding-bottom:4px}
      .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #E8A317}
      .logo{font-size:18px;font-weight:800;color:#E8A317}.sub{font-size:11px;color:#666;margin-top:2px}
      table{width:100%;border-collapse:collapse;margin-bottom:16px}th{text-align:left;padding:6px 8px;font-size:11px;color:#666;border-bottom:2px solid #eee;text-transform:uppercase;letter-spacing:0.5px}
      td{padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:12px}.right{text-align:right}.bold{font-weight:700}
      .total-row{background:#f9f9f9;font-weight:700}.grand-total{background:#E8A317;color:#000;font-size:15px}
      .notes{background:#fffdf7;border:1px solid #E8A31740;border-radius:6px;padding:12px;margin-top:16px;font-size:12px;color:#555}
      @media print{body{margin:20px}}
    </style></head><body>
    <div class="header">
      <div>
        <div class="logo">${project.company==='fcg'?'Foundation Construction Group LLC':project.company==='brc'?'BR Concrete Inc.':'P4S Corp'}</div>
        <div class="sub">Concrete & Masonry Contractor</div>
      </div>
      <div style="text-align:right">
        <div class="bold" style="font-size:16px">BID ESTIMATE</div>
        <div class="sub">Date: ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>
        <div class="sub">Bid #: ${Date.now().toString().slice(-6)}</div>
      </div>
    </div>
    <h1>${project.name}</h1>
    <div class="sub">${project.address||''} ${project.gc_name?'· GC: '+project.gc_name:''}</div>
    <h2>Cost Breakdown by Division</h2>
    <table>
      <thead><tr><th>Division</th><th class="right">Amount</th></tr></thead>
      <tbody>
        ${catGroups.map(c=>`<tr><td>${c.label}</td><td class="right">$${c.subtotal.toLocaleString('en-US',{minimumFractionDigits:2})}</td></tr>`).join('')}
        <tr class="total-row"><td class="bold">Direct Cost Subtotal</td><td class="right bold">$${subtotal.toLocaleString('en-US',{minimumFractionDigits:2})}</td></tr>
      </tbody>
    </table>
    <h2>Bid Summary</h2>
    <table>
      <tbody>
        <tr><td>Direct Cost Subtotal</td><td class="right">$${subtotal.toLocaleString('en-US',{minimumFractionDigits:2})}</td></tr>
        <tr><td>Overhead & General Conditions (${overhead}%)</td><td class="right">$${overheadAmt.toLocaleString('en-US',{minimumFractionDigits:2})}</td></tr>
        <tr><td>Bond (${bond}%)</td><td class="right">$${bondAmt.toLocaleString('en-US',{minimumFractionDigits:2})}</td></tr>
        <tr><td>Markup / Profit (${markup}%)</td><td class="right">$${markupAmt.toLocaleString('en-US',{minimumFractionDigits:2})}</td></tr>
        <tr class="grand-total"><td class="bold" style="padding:10px 8px">TOTAL BID PRICE</td><td class="right bold" style="padding:10px 8px;font-size:16px">$${total.toLocaleString('en-US',{minimumFractionDigits:2})}</td></tr>
      </tbody>
    </table>
    ${notes?`<div class="notes"><strong>Clarifications / Exclusions:</strong><br/>${notes.split('\n').join('<br/>')}</div>`:''}
    <div style="margin-top:30px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:12px">This estimate is valid for 30 days from date of issue. Prices subject to material cost fluctuations. Does not include permits unless noted.</div>
    </body></html>`);
    win.document.close(); win.focus(); setTimeout(()=>win.print(),500);
  };

  const dynInput = {...inputStyle,fontSize:13,width:'70px',textAlign:'right',padding:'5px 8px'};

  return (
    <APMModal title="Bid Summary" onClose={onClose} width={560}>
      <div style={{display:'flex',flexDirection:'column',gap:0}}>
        {/* Cost breakdown */}
        <div style={{background:t.bg4,borderRadius:8,padding:14,marginBottom:12}}>
          <div style={{fontSize:10,color:t.text4,fontVariantNumeric:'tabular-nums',letterSpacing:0.5,marginBottom:10}}>DIVISION COSTS</div>
          {catGroups.map(cat=>(
            <div key={cat.id} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${t.border}`}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{width:8,height:8,borderRadius:2,background:cat.color}}/>
                <span style={{fontSize:12,color:t.text}}>{cat.label}</span>
              </div>
              <span style={{fontSize:12,fontWeight:600,color:t.text,fontVariantNumeric:'tabular-nums'}}>${cat.subtotal.toLocaleString()}</span>
            </div>
          ))}
          <div style={{display:'flex',justifyContent:'space-between',paddingTop:8,marginTop:4}}>
            <span style={{fontSize:12,fontWeight:700,color:t.text}}>Direct Cost Subtotal</span>
            <span style={{fontSize:13,fontWeight:700,color:t.text,fontVariantNumeric:'tabular-nums'}}>${subtotal.toLocaleString()}</span>
          </div>
        </div>

        {/* Adjustments */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:12}}>
          {[['Overhead %',overhead,setOverhead],['Bond %',bond,setBond],['Markup %',markup,setMarkup]].map(([lbl,val,setter])=>(
            <APMField key={lbl} label={lbl}>
              <input type="number" value={val} onChange={e=>setter(Number(e.target.value)||0)} style={{...dynInput,width:'100%'}}/>
            </APMField>
          ))}
        </div>

        {/* Total */}
        <div style={{background:'linear-gradient(135deg,#E8A317,#ea580c)',borderRadius:8,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <span style={{fontSize:13,fontWeight:700,color:'#000'}}>TOTAL BID PRICE</span>
          <span style={{fontSize:22,fontWeight:800,color:'#000',fontVariantNumeric:'tabular-nums'}}>${total.toLocaleString('en-US',{minimumFractionDigits:0})}</span>
        </div>

        <APMField label="Clarifications / Exclusions">
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="e.g. Does not include permits, demo, or haul-off..." style={{...inputStyle,minHeight:70,resize:'vertical',fontSize:13}}/>
        </APMField>
      </div>
      <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
        <button onClick={onClose} style={{background:'none',border:`1px solid ${t.border2}`,color:t.text3,padding:'8px 18px',borderRadius:6,cursor:'pointer',fontSize:13}}>Close</button>
        <button onClick={printBid} style={{background:'#111',border:'1px solid #333',color:'#fff',padding:'8px 18px',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:700}}>🖨 Print / PDF</button>
      </div>
    </APMModal>
  );
}

// ── Takeoff Project Modal ─────────────────────────────
function TakeoffProjectModal({ project, apmProjects, onSave, onClose }) {
  const { t } = useTheme();
  const isNew = !project?.id;
  const [form, setForm] = useState({
    name:'', company:'fcg', address:'', gc_name:'', bid_date:'', contract_value:'', apm_project_id:null, status:'estimating',
    ...(project||{})
  });
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const dynInput = {...inputStyle,background:'var(--inp)',borderColor:'var(--inpbd)',color:'var(--inptx)',fontSize:13};

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const payload = {...form, contract_value: form.contract_value?Number(form.contract_value):null};
    delete payload.id; delete payload.created_at;
    if (isNew) {
      const {data, error} = await supabase.from('precon_projects').insert([payload]).select().single();
      if (error) { alert('Error creating project: ' + error.message); setSaving(false); return; }
      if (data) onSave(data, true);
    } else {
      const {data, error} = await supabase.from('precon_projects').update(payload).eq('id', project.id).select().single();
      if (error) { alert('Error saving: ' + error.message); setSaving(false); return; }
      onSave({...project,...(data||form)}, false);
    }
    setSaving(false);
  };

  return (
    <APMModal title={isNew?'New Takeoff Project':'Edit Project'} onClose={onClose} width={500}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <APMField label="Project Name"><input value={form.name} onChange={e=>set('name',e.target.value)} style={{...dynInput,fontSize:15}} autoFocus/></APMField>
        <div style={{display:'grid',gridTemplateColumns:'1fr',gap:12}}>
          <APMField label="Status">
            <select value={form.status} onChange={e=>set('status',e.target.value)} style={{...dynInput}}>
              {['estimating','pending_approval','approved','bid_submitted','awarded','lost','hold'].map(s=><option key={s} value={s}>{s.replace(/_/g,' ').toUpperCase()}</option>)}
            </select>
          </APMField>
        </div>
        <APMField label="Address"><input value={form.address||''} onChange={e=>set('address',e.target.value)} style={{...dynInput}}/></APMField>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <APMField label="GC / Owner"><input value={form.gc_name||''} onChange={e=>set('gc_name',e.target.value)} style={{...dynInput}}/></APMField>
          <APMField label="Bid Due Date"><input type="date" value={form.bid_date||''} onChange={e=>set('bid_date',e.target.value)} style={{...dynInput}}/></APMField>
        </div>
        <APMField label="Estimated Contract Value"><input type="number" value={form.contract_value||''} onChange={e=>set('contract_value',e.target.value)} placeholder="0" style={{...dynInput}}/></APMField>
        {apmProjects?.length>0&&(
          <APMField label="Link to APM Project (optional)">
            <select value={form.apm_project_id||''} onChange={e=>set('apm_project_id',e.target.value||null)} style={{...dynInput}}>
              <option value="">— None —</option>
              {apmProjects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </APMField>
        )}
      </div>
      <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'space-between'}}>
        {!isNew&&<button onClick={()=>{if(window.confirm('Delete "'+project.name+'"? This will permanently remove the project and all takeoff data.'))onSave(project,'delete');}} style={{background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.3)',color:'#C0504D',padding:'8px 14px',borderRadius:6,cursor:'pointer',fontSize:12}}>Delete</button>}
        <div style={{display:'flex',gap:8,marginLeft:'auto'}}>
          <button onClick={onClose} style={{background:'none',border:`1px solid var(--bd2)`,color:'var(--tx3)',padding:'8px 18px',borderRadius:6,cursor:'pointer',fontSize:13}}>Cancel</button>
          <button onClick={handleSave} disabled={saving||!form.name.trim()} style={{background:'#E8A317',border:'none',color:'#000',padding:'8px 22px',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:700}}>{saving?'Saving...':isNew?'Create':'Save'}</button>
        </div>
      </div>
    </APMModal>
  );
}

// ── New Condition Creator ─────────────────────────────────────────
// Fast: type name → pick measurement type → creates and arms
function AddItemInline({ cat, selPlan, project, items, onCreated }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mt, setMt] = useState('area');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef();

  if(!open) return(
    <div style={{padding:'4px 10px 4px 16px'}}>
      <button onClick={()=>{setOpen(true);setTimeout(()=>inputRef.current?.focus(),40);}}
        style={{width:'100%',background:'none',border:`1px dashed ${cat.color}55`,color:cat.color,
          padding:'4px 0',borderRadius:4,cursor:'pointer',fontSize:9,fontWeight:700,
          fontVariantNumeric:'tabular-nums',opacity:0.7}}>
        + Add item
      </button>
    </div>
  );

  const handleCreate = async () => {
    if(!name.trim()) return;
    setSaving(true);
    const unitMap = {area:'SF',linear:'LF',count:'EA',manual:'LS'};
    const payload = {
      project_id:project.id, plan_id:selPlan.id,
      category:cat.id, description:name.trim(),
      quantity:0, unit:unitMap[mt]||cat.unit, unit_cost:cat.defaultCost, total_cost:0,
      measurement_type:mt, points:[], color:cat.color,
      ai_generated:false, sort_order:items.length,
    };
    const {data} = await supabase.from('takeoff_items').insert([payload]).select().single();
    if(data) onCreated(data);
    setName(''); setOpen(false); setSaving(false);
  };

  return(
    <div style={{padding:'6px 10px 6px 16px',background:`${cat.color}08`,borderTop:`1px dashed ${cat.color}40`}}>
      <input ref={inputRef} value={name} onChange={e=>setName(e.target.value)}
        placeholder={`Item name (e.g. Sidewalk, Footing...)`}
        onKeyDown={e=>{if(e.key==='Enter'&&name.trim())handleCreate();if(e.key==='Escape')setOpen(false);}}
        style={{width:'100%',background:t.bg3,border:`1px solid ${cat.color}60`,color:t.text,
          borderRadius:4,padding:'5px 8px',fontSize:10,outline:'none',boxSizing:'border-box',marginBottom:6}}/>
      <div style={{display:'flex',gap:4,marginBottom:6}}>
        {[{id:'area',icon:'⬡',lbl:'SF'},{id:'linear',icon:'━',lbl:'LF'},{id:'count',icon:'✕',lbl:'EA'}].map(m=>(
          <button key={m.id} onClick={()=>setMt(m.id)}
            style={{flex:1,padding:'3px 0',border:`1px solid ${mt===m.id?cat.color:t.border}`,
              background:mt===m.id?`${cat.color}25`:'transparent',
              color:mt===m.id?cat.color:t.text4,
              borderRadius:3,cursor:'pointer',fontSize:8,fontVariantNumeric:'tabular-nums',fontWeight:700}}>
            {m.icon} {m.lbl}
          </button>
        ))}
      </div>
      <div style={{display:'flex',gap:4}}>
        <button onClick={handleCreate} disabled={!name.trim()||saving}
          style={{flex:1,background:cat.color,border:'none',color:'#000',padding:'5px 0',borderRadius:4,
            cursor:name.trim()?'pointer':'not-allowed',fontSize:10,fontWeight:700,opacity:name.trim()?1:0.4}}>
          {saving?'...':'✓ Add & Measure'}
        </button>
        <button onClick={()=>setOpen(false)}
          style={{background:'none',border:`1px solid ${t.border}`,color:t.text4,padding:'5px 8px',borderRadius:4,cursor:'pointer',fontSize:10}}>✕</button>
      </div>
    </div>
  );
}

function NewConditionRow({ selPlan, project, items, onCreated }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [cat, setCat] = useState('site_concrete');
  const [mt, setMt] = useState('area');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef();

  // Auto-set measure type from category default
  const catDef = TAKEOFF_CATS.find(c=>c.id===cat)||TAKEOFF_CATS[0];
  const unitLabel = catDef.unit;

  const handleCreate = async () => {
    if(!selPlan?.id||!name.trim()) return;
    setSaving(true);
    const payload = {
      project_id: project.id, plan_id: selPlan.id,
      category: cat, description: name.trim(),
      quantity: 0, unit: unitLabel, unit_cost: catDef.defaultCost, total_cost: 0,
      measurement_type: mt, points: [], color: catDef.color,
      ai_generated: false, sort_order: items.length,
    };
    const {data} = await supabase.from('takeoff_items').insert([payload]).select().single();
    if(data) onCreated(data);
    setName(''); setOpen(false); setSaving(false);
  };

  if(!open) return(
    <div style={{padding:'6px 8px',borderBottom:`1px solid ${t.border}`,flexShrink:0}}>
      <button onClick={()=>{setOpen(true);setTimeout(()=>inputRef.current?.focus(),50);}}
        disabled={!selPlan?.id}
        style={{width:'100%',background:'rgba(16,185,129,0.08)',border:'1px dashed rgba(16,185,129,0.4)',color:'#4CAF50',padding:'7px 0',borderRadius:5,cursor:selPlan?.id?'pointer':'not-allowed',fontSize:11,fontWeight:700,fontVariantNumeric:'tabular-nums',opacity:selPlan?.id?1:0.4}}>
        + NEW ITEM
      </button>
    </div>
  );

  return(
    <div style={{padding:'10px 8px',borderBottom:`1px solid #4CAF50`,background:'rgba(16,185,129,0.04)',flexShrink:0}}>
      {/* Step 1: Name */}
      <div style={{fontSize:8,color:'#4CAF50',fontVariantNumeric:'tabular-nums',letterSpacing:0.8,marginBottom:4}}>ITEM NAME</div>
      <input ref={inputRef} value={name} onChange={e=>setName(e.target.value)}
        placeholder="e.g. Sidewalk, Curb & Gutter, Footing..."
        onKeyDown={e=>{if(e.key==='Enter'&&name.trim()) handleCreate(); if(e.key==='Escape') setOpen(false);}}
        style={{width:'100%',background:t.bg3,border:`1px solid ${t.border2}`,color:t.text,borderRadius:4,padding:'6px 8px',fontSize:11,outline:'none',marginBottom:8,boxSizing:'border-box'}}/>

      {/* Step 2: Category */}
      <div style={{fontSize:8,color:t.text4,fontVariantNumeric:'tabular-nums',letterSpacing:0.8,marginBottom:4}}>CATEGORY</div>
      <select value={cat} onChange={e=>setCat(e.target.value)}
        style={{width:'100%',background:t.bg3,border:`1px solid ${t.border2}`,color:t.text,borderRadius:4,padding:'5px 7px',fontSize:11,marginBottom:8,boxSizing:'border-box'}}>
        {TAKEOFF_CATS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
      </select>

      {/* Step 3: Measure type */}
      <div style={{fontSize:8,color:t.text4,fontVariantNumeric:'tabular-nums',letterSpacing:0.8,marginBottom:4}}>MEASURE AS</div>
      <div style={{display:'flex',gap:4,marginBottom:10}}>
        {[{id:'area',icon:'⬡',label:'Area (SF)'},{id:'linear',icon:'━',label:'Linear (LF)'},{id:'count',icon:'✕',label:'Count (EA)'}].map(m=>(
          <button key={m.id} onClick={()=>setMt(m.id)}
            style={{flex:1,padding:'5px 0',border:`1px solid ${mt===m.id?'#4CAF50':t.border}`,
              background:mt===m.id?'rgba(16,185,129,0.15)':'rgba(0,0,0,0.2)',
              color:mt===m.id?'#4CAF50':'#888',
              borderRadius:4,cursor:'pointer',fontSize:9,fontVariantNumeric:'tabular-nums',fontWeight:700}}>
            <div style={{fontSize:12}}>{m.icon}</div>
            <div style={{fontSize:8,marginTop:1}}>{m.label}</div>
          </button>
        ))}
      </div>

      <div style={{display:'flex',gap:5}}>
        <button onClick={handleCreate} disabled={!name.trim()||saving}
          style={{flex:1,background:'#4CAF50',border:'none',color:'#000',padding:'7px 0',borderRadius:4,cursor:name.trim()?'pointer':'not-allowed',fontSize:11,fontWeight:700,opacity:name.trim()?1:0.4}}>
          {saving?'Saving...':'✓ Create & Start Measuring'}
        </button>
        <button onClick={()=>setOpen(false)}
          style={{background:'none',border:`1px solid ${t.border}`,color:t.text4,padding:'7px 10px',borderRadius:4,cursor:'pointer',fontSize:11}}>✕</button>
      </div>
    </div>
  );
}

// ── Inline Item Editor (expands in sidebar row) ──────────────────
function InlineItemEditor({ item, cat, onSave, onDelete }) {
  const { t } = useTheme();
  const [form, setForm] = useState({
    description: item.description||'',
    category: item.category||'other',
    quantity: item.quantity||'',
    unit: item.unit||'SF',
    unit_cost: item.unit_cost||0,
    multiplier: item.multiplier||1,
    height: item.height||0,
    measurement_type: item.measurement_type||'manual',
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const total = (Number(form.quantity)||0) * (Number(form.multiplier)||1) * (Number(form.unit_cost)||0);
  const inp = {background:t.bg5,border:`1px solid ${t.border2}`,color:t.text,borderRadius:4,padding:'4px 6px',fontSize:10,fontVariantNumeric:'tabular-nums',width:'100%',outline:'none'};
  return(
    <div style={{padding:'8px',background:t.bg3,borderTop:`1px solid ${cat.color}40`}}>
      {/* Description */}
      <input value={form.description} onChange={e=>set('description',e.target.value)}
        placeholder="Description" autoFocus
        style={{...inp,marginBottom:6,fontSize:11}}
        onKeyDown={e=>e.key==='Enter'&&onSave(form)}/>
      {/* Category */}
      <select value={form.category} onChange={e=>{
        const c=TAKEOFF_CATS.find(x=>x.id===e.target.value)||TAKEOFF_CATS[0];
        set('category',e.target.value); set('unit',c.unit); set('unit_cost',c.defaultCost);
      }} style={{...inp,marginBottom:6}}>
        {TAKEOFF_CATS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      {/* Qty / Unit / Rate row */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 60px 1fr',gap:4,marginBottom:6}}>
        <div>
          <div style={{fontSize:8,color:t.text4,fontVariantNumeric:'tabular-nums',marginBottom:2}}>QTY</div>
          <input type="number" value={form.quantity} onChange={e=>set('quantity',e.target.value)}
            style={{...inp}} onKeyDown={e=>e.key==='Enter'&&onSave(form)}/>
        </div>
        <div>
          <div style={{fontSize:8,color:t.text4,fontVariantNumeric:'tabular-nums',marginBottom:2}}>UNIT</div>
          <input value={form.unit} onChange={e=>set('unit',e.target.value)} style={{...inp}}/>
        </div>
        <div>
          <div style={{fontSize:8,color:t.text4,fontVariantNumeric:'tabular-nums',marginBottom:2}}>$/UNIT</div>
          <input type="number" value={form.unit_cost} onChange={e=>set('unit_cost',e.target.value)}
            style={{...inp}} onKeyDown={e=>e.key==='Enter'&&onSave(form)}/>
        </div>
      </div>
      {/* Multiplier + Wall Height row */}
      <div style={{display:'grid',gridTemplateColumns:form.measurement_type==='linear'?'1fr 1fr':'1fr',gap:4,marginBottom:6}}>
        <div>
          <div style={{fontSize:8,color:t.text4,fontVariantNumeric:'tabular-nums',marginBottom:2}}>MULTIPLIER</div>
          <input type="number" value={form.multiplier} onChange={e=>set('multiplier',e.target.value)}
            style={{...inp}} onKeyDown={e=>e.key==='Enter'&&onSave(form)}/>
        </div>
        {form.measurement_type==='linear'&&(
          <div>
            <div style={{fontSize:8,color:t.text4,fontVariantNumeric:'tabular-nums',marginBottom:2}}>WALL HT (ft)</div>
            <input type="number" value={form.height||''} onChange={e=>set('height',e.target.value)}
              placeholder="0" style={{...inp}} onKeyDown={e=>e.key==='Enter'&&onSave(form)}/>
          </div>
        )}
      </div>
      {/* Total */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,padding:'4px 6px',background:t.bg5,borderRadius:4}}>
        <span style={{fontSize:9,color:t.text4,fontVariantNumeric:'tabular-nums'}}>TOTAL</span>
        <span style={{fontSize:12,fontWeight:700,color:'#4CAF50',fontVariantNumeric:'tabular-nums'}}>${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
      </div>
      {/* Actions */}
      <div style={{display:'flex',gap:4}}>
        <button onClick={()=>onSave(form)} style={{flex:1,background:'#4CAF50',border:'none',color:'#000',padding:'5px 0',borderRadius:4,cursor:'pointer',fontSize:10,fontWeight:700}}>✓ Save</button>
        <button onClick={onDelete} style={{background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',color:'#C0504D',padding:'5px 8px',borderRadius:4,cursor:'pointer',fontSize:10}}>✕</button>
      </div>
    </div>
  );
}

export { TakeoffItemModal, UnitCostEditor, AssemblyPicker, BidSummaryModal, TakeoffProjectModal, AddItemInline, NewConditionRow, InlineItemEditor };
