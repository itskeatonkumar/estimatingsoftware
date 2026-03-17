import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../../lib/theme.jsx';
import { ThemeToggle } from '../../lib/theme.jsx';
import { supabase } from '../../lib/supabase.js';
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
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newModal, setNewModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [orgMembers, setOrgMembers] = useState([]);

  useEffect(() => {
    supabase.from('precon_projects').select('*').order('created_at', { ascending: false })
      .then(({ data }) => {
        setProjects(data || []);
        setLoading(false);
      });
    // Fetch org members for team assignment dropdown
    (async () => {
      let orgId = null;
      const { data: rpcOrgId, error: rpcErr } = await supabase.rpc('get_my_org_id');
      if (!rpcErr && rpcOrgId) {
        orgId = rpcOrgId;
      } else {
        const { data: orgs } = await supabase.from('organizations').select('id').limit(1).single();
        orgId = orgs?.id;
      }
      if (!orgId) return;
      const { data: members, error: memErr } = await supabase.rpc('get_org_members', { p_org_id: orgId });
      if (!memErr && members?.length) {
        setOrgMembers(members);
      } else {
        const { data: mems } = await supabase.from('memberships').select('user_id, role').eq('org_id', orgId);
        if (mems?.length) {
          const { data: { user: me } } = await supabase.auth.getUser();
          setOrgMembers(mems.map(m => ({ user_id: m.user_id, email: m.user_id === me?.id ? me.email : m.user_id, role: m.role })));
        }
      }
    })();
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
            {orgMembers.map(m => <option key={m.user_id} value={m.email}>{m.email}</option>)}
          </select>
        </div>
      </div>

      {/* Project grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
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
                      <div style={{ fontSize: 14, fontWeight: 500, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
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
                    {p.bid_date && (
                      <div style={{ fontSize: 12, color: p.bid_date < new Date().toISOString().slice(0, 10) ? '#C0504D' : t.text3 }}>
                        Bid: {fmtDate(p.bid_date)}
                      </div>
                    )}
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
                      {orgMembers.map(m => <option key={m.user_id} value={m.email}>{m.email}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {newModal && (
        <TakeoffProjectModal
          project={null}
          apmProjects={[]}
          onSave={handleSave}
          onClose={() => setNewModal(false)}
        />
      )}
    </div>
  );
}

export default ProjectList;
