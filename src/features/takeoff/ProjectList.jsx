import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../../lib/theme.jsx';
import { ThemeToggle } from '../../lib/theme.jsx';
import { supabase } from '../../lib/supabase.js';
import { useOrg } from '../../lib/OrgContext.jsx';
import { TakeoffProjectModal } from './TakeoffComponents.jsx';

const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '';

const STATUS_COLORS = {
  estimating: '#E8A317',
  pending_approval: '#7B6BA4',
  approved: '#4A90A4',
  bid_submitted: '#5B9BD5',
  awarded: '#4CAF50',
  lost: '#C0504D',
  hold: '#808080',
};

const STATUS_OPTIONS = ['estimating', 'pending_approval', 'approved', 'bid_submitted', 'awarded', 'lost', 'hold'];

function ProjectList({ onSelectProject, user }) {
  const { t } = useTheme();
  const { orgId, orgs, isSuperAdmin, viewAllOrgs, setViewAllOrgs, switchOrg, orgFilter } = useOrg();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newModal, setNewModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [orgMembers, setOrgMembers] = useState([]);
  const [viewMode, setViewMode] = useState(()=>{ try{return localStorage.getItem('projectView')||'grid';}catch{return 'grid';} });
  const [calMonth, setCalMonth] = useState(()=>{ const d=new Date(); return {year:d.getFullYear(),month:d.getMonth()}; });
  const [dragCard, setDragCard] = useState(null);
  const [shareProject, setShareProject] = useState(null); // project being shared
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState('editor');
  const [shareMembers, setShareMembers] = useState([]);

  useEffect(() => {
    (async()=>{
      const {data:{user:me}}=await supabase.auth.getUser();
      // My projects (org-filtered)
      let q=supabase.from('precon_projects').select('*').order('created_at',{ascending:false});
      if(orgId && !(isSuperAdmin&&viewAllOrgs)) q=q.or(`org_id.eq.${orgId},org_id.is.null`);
      const {data:myProjects,error}=await q;
      if(error) console.error('[projects] load error:',error);
      let all=myProjects||[];
      // Shared projects
      if(me){
        const {data:shares}=await supabase.from('project_shares').select('project_id').eq('user_id',me.id);
        if(shares?.length){
          const sharedIds=shares.map(s=>s.project_id);
          const myIds=new Set(all.map(p=>p.id));
          const missing=sharedIds.filter(id=>!myIds.has(id));
          if(missing.length){
            const {data:sharedProjects}=await supabase.from('precon_projects').select('*').in('id',missing);
            if(sharedProjects) all=[...all,...sharedProjects.map(p=>({...p,_shared:true}))];
          }
        }
      }
      setProjects(all);
      setLoading(false);
    })();
    // Fetch team members from profiles table (skip silently if table doesn't exist)
    supabase.from('profiles').select('id, email, full_name')
      .then(({ data, error }) => {
        if (!error && data?.length) setOrgMembers(data.map(p => ({ user_id: p.id, email: p.email, name: p.full_name })));
      })
      .catch(() => {});
    // Safety: force loading off after 5s in case query hangs
    const t = setTimeout(() => setLoading(false), 5000);
    return () => clearTimeout(t);
  }, []);

  const handleSave = async (data, type) => {
    if (type === 'delete') {
      const { error } = await supabase.rpc('delete_precon_project', { p_id: data?.id });
      if (error) { alert('Delete failed: ' + error.message); }
      else { setProjects(prev => prev.filter(p => p.id !== data?.id)); }
      setNewModal(false);
      return;
    }
    if (type === true) { setProjects(prev => [data, ...prev]); }
    else { setProjects(prev => prev.map(p => p.id === data.id ? data : p)); }
    setNewModal(false);
  };

  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} project${selected.size > 1 ? 's' : ''}? This permanently removes all takeoff data.`)) return;
    setDeleting(true);
    const ids = [...selected];
    for (const id of ids) {
      const { error } = await supabase.rpc('delete_precon_project', { p_id: id });
      if (error) { console.error('delete failed', id, error); }
    }
    setProjects(prev => prev.filter(p => !selected.has(p.id)));
    setSelected(new Set());
    setDeleting(false);
  };

  const updateField = async (id, field, value) => {
    const { error } = await supabase.from('precon_projects').update({ [field]: value }).eq('id', id);
    if (error) { console.error('update failed', error); return; }
    setProjects(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = projects.filter(p => {
    const matchSearch = !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.gc_name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || p.status === filterStatus;
    const matchAssignee = filterAssignee === 'all' || (filterAssignee === 'unassigned' ? !p.assigned_to : p.assigned_to === filterAssignee);
    return matchSearch && matchStatus && matchAssignee;
  });

  const totalBidValue = filtered.reduce((s, p) => s + (Number(p.contract_value) || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: t.bg }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', height: 48, borderBottom: `1px solid ${t.border}`, background: t.bg2, flexShrink: 0, padding: '0 24px', gap: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>
          Estimating
        </div>
        {/* Org switcher */}
        {orgs.length>1&&(
          <select value={orgId||''} onChange={e=>switchOrg(e.target.value)}
            style={{padding:'4px 8px',border:`1px solid ${t.border}`,borderRadius:4,fontSize:11,color:t.text2,background:t.bg,outline:'none',cursor:'pointer'}}>
            {orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {orgs.length===1&&<span style={{fontSize:11,color:t.text3}}>{orgs[0]?.name}</span>}
        {/* Super admin toggle */}
        {isSuperAdmin&&(
          <label style={{display:'flex',alignItems:'center',gap:4,fontSize:10,color:'#7B6BA4',cursor:'pointer'}}>
            <input type="checkbox" checked={viewAllOrgs} onChange={e=>setViewAllOrgs(e.target.checked)} style={{accentColor:'#7B6BA4'}}/>
            All Orgs
          </label>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: t.text3 }}>{user?.email}</span>
        <ThemeToggle />
        <button onClick={() => supabase.auth.signOut()}
          style={{ background: 'none', border: `1px solid ${t.border}`, color: t.text2, padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
          Sign out
        </button>
      </div>

      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${t.border}`, background: t.bg2, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 24, alignItems: 'baseline' }}>
            {[
              { label: 'Projects', val: filtered.length, color: t.text },
              { label: 'Estimating', val: filtered.filter(p => p.status === 'estimating').length, color: STATUS_COLORS.estimating },
              { label: 'Submitted', val: filtered.filter(p => p.status === 'bid_submitted').length, color: STATUS_COLORS.bid_submitted },
              { label: 'Awarded', val: filtered.filter(p => p.status === 'awarded').length, color: STATUS_COLORS.awarded },
              { label: 'Bid volume', val: '$' + totalBidValue.toLocaleString(), color: t.text, mono: true },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: s.mono ? 14 : 18, fontWeight: 600, color: s.color, fontFamily: s.mono ? 'inherit' : 'inherit' }}>{s.val}</span>
                <span style={{ fontSize: 12, color: t.text3 }}>{s.label}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selected.size > 0 && (
              <button onClick={bulkDelete} disabled={deleting}
                style={{ background: '#C0504D', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                {deleting ? 'Deleting...' : `Delete ${selected.size}`}
              </button>
            )}
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())}
                style={{ background: 'none', border: `1px solid ${t.border}`, color: t.text2, padding: '8px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                Clear
              </button>
            )}
            <button onClick={() => setNewModal(true)}
              style={{ background: '#4CAF50', border: 'none', color: '#fff', padding: '8px 20px', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              New Project
            </button>
            {/* View toggle */}
            <div style={{ display: 'flex', border: `1px solid ${t.border}`, borderRadius: 4, overflow: 'hidden', marginLeft: 8 }}>
              {[['grid','Grid'],['pipeline','Pipeline'],['calendar','Calendar']].map(([id,lbl])=>(
                <button key={id} onClick={()=>{setViewMode(id);try{localStorage.setItem('projectView',id);}catch{}}}
                  style={{padding:'6px 12px',border:'none',cursor:'pointer',fontSize:11,fontWeight:viewMode===id?600:400,
                    background:viewMode===id?'#4CAF50':'transparent',color:viewMode===id?'#fff':t.text3}}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..."
            style={{ width: 240, padding: '7px 12px', border: `1px solid ${t.border}`, borderRadius: 4, fontSize: 13, color: t.text, background: t.bg, outline: 'none', boxSizing: 'border-box' }} />
          {['all', ...STATUS_OPTIONS].map(s => {
            const active = filterStatus === s;
            return (
              <button key={s} onClick={() => setFilterStatus(s)}
                style={{
                  padding: '5px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
                  border: active ? `1px solid ${STATUS_COLORS[s] || '#333'}` : `1px solid ${t.border}`,
                  background: active ? (STATUS_COLORS[s] || '#333') + '18' : 'transparent',
                  color: active ? (STATUS_COLORS[s] || t.text) : t.text3,
                  fontWeight: active ? 500 : 400,
                }}>
                {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </button>
            );
          })}
          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
            style={{
              padding: '5px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
              border: `1px solid ${t.border}`, background: t.bg, color: filterAssignee !== 'all' ? t.text : t.text3,
              outline: 'none',
            }}>
            <option value="all">All estimators</option>
            <option value="unassigned">Unassigned</option>
            {orgMembers.map(m => <option key={m.user_id} value={m.email}>{m.name || m.email}</option>)}
          </select>
        </div>
      </div>

      {/* Pipeline View */}
      {viewMode==='pipeline'&&(
        <div style={{flex:1,overflowX:'auto',overflowY:'hidden',display:'flex',gap:12,padding:'16px 16px'}}>
          {STATUS_OPTIONS.map(status=>{
            const col=filtered.filter(p=>p.status===status);
            const colTotal=col.reduce((s,p)=>s+(Number(p.contract_value)||0),0);
            const sc=STATUS_COLORS[status]||'#999';
            return(
              <div key={status} style={{minWidth:200,width:200,flexShrink:0,display:'flex',flexDirection:'column',background:'#f5f5f5',borderRadius:6,overflow:'hidden'}}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.background='#e8f5e9';}}
                onDragLeave={e=>{e.currentTarget.style.background='#f5f5f5';}}
                onDrop={async e=>{
                  e.currentTarget.style.background='#f5f5f5';
                  if(!dragCard) return;
                  await supabase.from('precon_projects').update({status}).eq('id',dragCard);
                  setProjects(prev=>prev.map(p=>p.id===dragCard?{...p,status}:p));
                  setDragCard(null);
                }}>
                <div style={{padding:'10px 12px',borderBottom:`2px solid ${sc}`,display:'flex',alignItems:'center',gap:6}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:sc,flexShrink:0}}/>
                  <span style={{fontSize:11,fontWeight:600,color:'#333',flex:1}}>{status.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>
                  <span style={{fontSize:10,color:'#999'}}>{col.length}</span>
                </div>
                <div style={{flex:1,overflowY:'auto',padding:6,display:'flex',flexDirection:'column',gap:6}}>
                  {col.sort((a,b)=>(a.bid_date||'z').localeCompare(b.bid_date||'z')).map(p=>(
                    <div key={p.id} draggable onDragStart={()=>setDragCard(p.id)}
                      onClick={()=>onSelectProject(p)}
                      style={{background:'#fff',border:'1px solid #E0E0E0',borderRadius:4,padding:'10px 12px',cursor:'grab',borderLeft:`3px solid ${sc}`}}
                      onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 6px rgba(0,0,0,0.08)'}
                      onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
                      <div style={{fontSize:12,fontWeight:500,color:'#333',marginBottom:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                      {p.gc_name&&<div style={{fontSize:10,color:'#999',marginBottom:2}}>{p.gc_name}</div>}
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        {p.contract_value?<span style={{fontSize:11,fontWeight:600,color:'#333'}}>${Number(p.contract_value).toLocaleString()}</span>:<span/>}
                        {p.bid_date&&<span style={{fontSize:10,color:p.bid_date<new Date().toISOString().slice(0,10)?'#C0504D':'#999'}}>{fmtDate(p.bid_date)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{padding:'6px 12px',borderTop:'1px solid #E0E0E0',fontSize:10,color:'#999',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>
                  ${colTotal.toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Calendar View */}
      {viewMode==='calendar'&&(()=>{
        const {year,month}=calMonth;
        const firstDay=new Date(year,month,1).getDay();
        const daysInMonth=new Date(year,month+1,0).getDate();
        const today=new Date().toISOString().slice(0,10);
        const monthLabel=new Date(year,month).toLocaleString('en-US',{month:'long',year:'numeric'});
        const cells=[];
        for(let i=0;i<firstDay;i++) cells.push(null);
        for(let d=1;d<=daysInMonth;d++) cells.push(d);
        while(cells.length%7!==0) cells.push(null);
        // Group projects by bid_date
        const byDate={};
        filtered.forEach(p=>{if(p.bid_date) {if(!byDate[p.bid_date])byDate[p.bid_date]=[];byDate[p.bid_date].push(p);}});
        return(
        <div style={{flex:1,overflowY:'auto',padding:24}}>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
            <button onClick={()=>setCalMonth(prev=>{const m=prev.month-1;return m<0?{year:prev.year-1,month:11}:{...prev,month:m};})}
              style={{background:'none',border:`1px solid ${t.border}`,color:t.text3,padding:'4px 10px',borderRadius:4,cursor:'pointer',fontSize:14}}>&#8249;</button>
            <span style={{fontSize:16,fontWeight:600,color:'#333',minWidth:160,textAlign:'center'}}>{monthLabel}</span>
            <button onClick={()=>setCalMonth(prev=>{const m=prev.month+1;return m>11?{year:prev.year+1,month:0}:{...prev,month:m};})}
              style={{background:'none',border:`1px solid ${t.border}`,color:t.text3,padding:'4px 10px',borderRadius:4,cursor:'pointer',fontSize:14}}>&#8250;</button>
            <button onClick={()=>{const d=new Date();setCalMonth({year:d.getFullYear(),month:d.getMonth()});}}
              style={{background:'none',border:`1px solid ${t.border}`,color:t.text3,padding:'4px 10px',borderRadius:4,cursor:'pointer',fontSize:11}}>Today</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1,background:'#E0E0E0',border:'1px solid #E0E0E0',borderRadius:4,overflow:'hidden'}}>
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>(
              <div key={d} style={{padding:'6px',fontSize:10,fontWeight:600,color:'#999',textAlign:'center',background:'#f5f5f5'}}>{d}</div>
            ))}
            {cells.map((day,i)=>{
              const dateStr=day?`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`:null;
              const dayProjects=dateStr?byDate[dateStr]||[]:[];
              const isToday=dateStr===today;
              return(
                <div key={i} style={{minHeight:80,padding:4,background:'#fff',border:isToday?'2px solid #4CAF50':'none',position:'relative'}}>
                  {day&&<div style={{fontSize:11,fontWeight:isToday?700:400,color:isToday?'#4CAF50':'#666',marginBottom:2}}>{day}</div>}
                  {dayProjects.slice(0,3).map(p=>(
                    <div key={p.id} onClick={()=>onSelectProject(p)}
                      style={{fontSize:9,padding:'2px 4px',marginBottom:2,borderRadius:3,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                        background:(STATUS_COLORS[p.status]||'#999')+'20',color:STATUS_COLORS[p.status]||'#999',borderLeft:`2px solid ${STATUS_COLORS[p.status]||'#999'}`}}>
                      {p.name}
                    </div>
                  ))}
                  {dayProjects.length>3&&<div style={{fontSize:8,color:'#999',padding:'0 4px'}}>+{dayProjects.length-3} more</div>}
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {/* Project grid */}
      {viewMode==='grid'&&<div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 60, color: t.text3, fontSize: 13 }}>Loading projects...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 80 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: t.text, marginBottom: 8 }}>
              {search || filterStatus !== 'all' ? 'No matching projects' : 'No projects yet'}
            </div>
            <div style={{ fontSize: 13, color: t.text3, marginBottom: 24 }}>
              {search || filterStatus !== 'all' ? 'Try adjusting your filters' : 'Create your first project to start estimating'}
            </div>
            {!search && filterStatus === 'all' && (
              <button onClick={() => setNewModal(true)}
                style={{ background: '#4CAF50', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                New Project
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
          {filtered.map(p => {
            const statusColor = STATUS_COLORS[p.status] || '#808080';
            const isSelected = selected.has(p.id);
            return (
              <div key={p.id} onClick={() => onSelectProject(p)}
                style={{
                  background: t.bg2, border: `1px solid ${isSelected ? '#5B9BD5' : t.border}`, borderRadius: 4, padding: '16px 18px',
                  cursor: 'pointer', transition: 'border-color 0.15s',
                  position: 'relative',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = '#4CAF50'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = isSelected ? '#5B9BD5' : ''; }}>
                {/* Checkbox */}
                <div onClick={e => toggleSelect(p.id, e)}
                  style={{ position: 'absolute', top: 12, left: 12, width: 16, height: 16, borderRadius: 2,
                    border: `1.5px solid ${isSelected ? '#5B9BD5' : t.border}`,
                    background: isSelected ? '#5B9BD5' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 2 }}>
                  {isSelected && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>&#10003;</span>}
                </div>
                <div style={{ marginLeft: 22 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <input
                          defaultValue={p.name || ''}
                          onClick={e => e.stopPropagation()}
                          onBlur={e => { const v = e.target.value.trim(); if (v && v !== p.name) updateField(p.id, 'name', v); }}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                          style={{ fontSize: 14, fontWeight: 500, color: t.text, background: 'transparent', border: 'none', outline: 'none', flex:1, padding: 0, cursor: 'text', minWidth:0 }}
                        />
                        {p._shared&&<span style={{fontSize:8,background:'#EBF5FB',color:'#5B9BD5',padding:'1px 5px',borderRadius:8,flexShrink:0}}>Shared</span>}
                        <button onClick={e=>{e.stopPropagation();setShareProject(p);
                          supabase.from('project_shares').select('*, profiles(email,full_name)').eq('project_id',p.id).then(({data})=>setShareMembers(data||[]));
                        }} style={{background:'none',border:'none',color:t.text4,cursor:'pointer',fontSize:12,flexShrink:0,padding:'0 2px'}} title="Share">&#128279;</button>
                      </div>
                      <div style={{ fontSize: 12, color: t.text3, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.address || p.gc_name || ''}
                      </div>
                    </div>
                    {/* Inline status dropdown */}
                    <select value={p.status || 'estimating'}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { e.stopPropagation(); updateField(p.id, 'status', e.target.value); }}
                      style={{
                        fontSize: 11, padding: '3px 6px', borderRadius: 4,
                        background: statusColor + '18', color: statusColor, textAlign: 'center',
                        border: `1px solid ${statusColor}40`, cursor: 'pointer',
                        fontWeight: 500, flexShrink: 0,
                      }}>
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      {p.contract_value && (
                        <div style={{ fontSize: 16, fontWeight: 600, color: t.text }}>
                          ${Number(p.contract_value).toLocaleString()}
                        </div>
                      )}
                      {p.gc_name && <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>GC: {p.gc_name}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
                      <span style={{ fontSize: 11, color: t.text3 }}>Bid:</span>
                      <input type="date" defaultValue={p.bid_date || ''}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateField(p.id, 'bid_date', e.target.value || null)}
                        style={{ fontSize: 12, color: p.bid_date && p.bid_date < new Date().toISOString().slice(0, 10) ? '#C0504D' : t.text3, background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', padding: 0 }}
                      />
                    </div>
                  </div>
                  {/* Team member */}
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}` }} onClick={e => e.stopPropagation()}>
                    <select
                      value={p.assigned_to || ''}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { e.stopPropagation(); updateField(p.id, 'assigned_to', e.target.value || null); }}
                      style={{
                        width: '100%', padding: '4px 8px', fontSize: 12, border: `1px solid ${t.border}`,
                        borderRadius: 4, background: t.bg, color: p.assigned_to ? t.text : t.text3, outline: 'none', boxSizing: 'border-box',
                        cursor: 'pointer',
                      }}>
                      <option value="">Unassigned</option>
                      {orgMembers.map(m => <option key={m.user_id} value={m.email}>{m.name || m.email}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>}

      {newModal && (
        <TakeoffProjectModal
          project={null}
          apmProjects={[]}
          onSave={handleSave}
          onClose={() => setNewModal(false)}
        />
      )}
      {/* Share Modal */}
      {shareProject&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShareProject(null)}>
          <div style={{background:'#fff',borderRadius:8,width:440,maxHeight:'70vh',display:'flex',flexDirection:'column',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid #E0E0E0',display:'flex',alignItems:'center'}}>
              <span style={{flex:1,fontSize:15,fontWeight:600,color:'#333'}}>Share "{shareProject.name}"</span>
              <button onClick={()=>setShareProject(null)} style={{background:'none',border:'none',color:'#999',cursor:'pointer',fontSize:18}}>&times;</button>
            </div>
            {/* Invite row */}
            <div style={{padding:'12px 20px',borderBottom:'1px solid #f0f0f0',display:'flex',gap:6}}>
              <input value={shareEmail} onChange={e=>setShareEmail(e.target.value)} placeholder="Email address..."
                style={{flex:1,padding:'7px 10px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:12,outline:'none',color:'#333'}}/>
              <select value={shareRole} onChange={e=>setShareRole(e.target.value)}
                style={{padding:'7px 8px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:11,outline:'none',color:'#666'}}>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button onClick={async()=>{
                if(!shareEmail.trim()) return;
                const {data:profile}=await supabase.from('profiles').select('id,email,full_name').eq('email',shareEmail.trim().toLowerCase()).single();
                if(!profile){alert('User not found — they need to create an account first.');return;}
                const {data:{user:me}}=await supabase.auth.getUser();
                const {error}=await supabase.from('project_shares').insert([{project_id:shareProject.id,user_id:profile.id,role:shareRole,invited_by:me?.id}]);
                if(error){alert('Share failed: '+error.message);return;}
                setShareMembers(prev=>[...prev,{user_id:profile.id,role:shareRole,profiles:profile}]);
                setShareEmail('');
              }} style={{padding:'7px 14px',background:'#4CAF50',border:'none',color:'#fff',borderRadius:4,cursor:'pointer',fontSize:11,fontWeight:500,flexShrink:0}}>
                Invite
              </button>
            </div>
            {/* Members list */}
            <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
              {shareMembers.map((m,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 20px',borderBottom:'1px solid #f8f8f8'}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'#4CAF50',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:12,flexShrink:0}}>
                    {(m.profiles?.email||'?')[0].toUpperCase()}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:'#333'}}>{m.profiles?.full_name||m.profiles?.email||'Unknown'}</div>
                    <div style={{fontSize:10,color:'#999'}}>{m.profiles?.email}</div>
                  </div>
                  <span style={{fontSize:10,color:'#5B9BD5',fontWeight:500}}>{m.role}</span>
                  <button onClick={async()=>{
                    await supabase.from('project_shares').delete().eq('project_id',shareProject.id).eq('user_id',m.user_id);
                    setShareMembers(prev=>prev.filter(x=>x.user_id!==m.user_id));
                  }} style={{background:'none',border:'none',color:'#ccc',cursor:'pointer',fontSize:12}}>&times;</button>
                </div>
              ))}
              {shareMembers.length===0&&<div style={{padding:20,color:'#999',fontSize:12,textAlign:'center'}}>No collaborators yet</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectList;
