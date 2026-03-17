import React, { useState, useEffect } from 'react';
import { useTheme } from '../../lib/theme.jsx';
import { ThemeToggle } from '../../lib/theme.jsx';
import { supabase } from '../../lib/supabase.js';
import { TakeoffProjectModal } from './TakeoffComponents.jsx';

const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '';

const STATUS_COLORS = {
  estimating: '#F59E0B',
  bid_submitted: '#3B82F6',
  awarded: '#10B981',
  lost: '#EF4444',
  hold: '#71717a',
};

function ProjectList({ onSelectProject, user }) {
  const { t } = useTheme();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newModal, setNewModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    supabase.from('precon_projects').select('*').order('created_at', { ascending: false })
      .then(({ data }) => {
        setProjects(data || []);
        setLoading(false);
      });
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

  const filtered = projects.filter(p => {
    const matchSearch = !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.gc_name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const totalBidValue = filtered.reduce((s, p) => s + (Number(p.contract_value) || 0), 0);
  const awardedVal = filtered.filter(p => p.status === 'awarded').reduce((s, p) => s + (Number(p.contract_value) || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', height: 48, borderBottom: `1px solid ${t.border}`, background: t.bg2, flexShrink: 0, padding: '0 20px', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: t.text, letterSpacing: -0.3 }}>
          Estimating
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: t.text4 }}>{user?.email}</span>
        <ThemeToggle />
        <button onClick={() => supabase.auth.signOut()}
          style={{ background: 'none', border: `1px solid ${t.border}`, color: t.text3, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
          Sign Out
        </button>
      </div>

      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.border}`, background: t.bg, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
            {[
              { label: 'Projects', val: filtered.length, color: t.text },
              { label: 'Estimating', val: filtered.filter(p => p.status === 'estimating').length, color: '#F59E0B' },
              { label: 'Submitted', val: filtered.filter(p => p.status === 'bid_submitted').length, color: '#3B82F6' },
              { label: 'Awarded', val: filtered.filter(p => p.status === 'awarded').length, color: '#10B981' },
              { label: 'Bid Volume', val: '$' + totalBidValue.toLocaleString(), color: t.text, isText: true },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: s.isText ? 13 : 16, fontWeight: 700, color: s.color, fontFamily: "'DM Mono',monospace" }}>{s.val}</span>
                <span style={{ fontSize: 9, color: t.text4, fontWeight: 500 }}>{s.label}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setNewModal(true)}
            style={{ background: '#10B981', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            + New Project
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 260 }}>
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: t.text4, fontSize: 12 }}>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..."
              style={{ width: '100%', padding: '6px 8px 6px 26px', border: `1px solid ${t.border}`, borderRadius: 4, fontSize: 12, color: t.text, background: t.bg2, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {['all', 'estimating', 'bid_submitted', 'awarded', 'lost', 'hold'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              style={{
                padding: '4px 10px', borderRadius: 20,
                border: filterStatus === s ? `1px solid ${STATUS_COLORS[s] || t.text3}60` : `1px solid ${t.border}`,
                background: filterStatus === s ? (STATUS_COLORS[s] || t.text3) + '15' : 'transparent',
                color: filterStatus === s ? (STATUS_COLORS[s] || t.text3) : t.text4,
                fontSize: 10, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
              }}>
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Project grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 60, color: t.text4, fontSize: 12 }}>Loading projects...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📐</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 6 }}>
              {search || filterStatus !== 'all' ? 'No matching projects' : 'No projects yet'}
            </div>
            <div style={{ fontSize: 12, color: t.text3, marginBottom: 24 }}>
              {search || filterStatus !== 'all' ? 'Try adjusting your filters' : 'Create your first project to start estimating'}
            </div>
            {!search && filterStatus === 'all' && (
              <button onClick={() => setNewModal(true)}
                style={{ background: '#10B981', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                + New Project
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
          {filtered.map(p => {
            const statusColor = STATUS_COLORS[p.status] || '#71717a';
            return (
              <div key={p.id} onClick={() => onSelectProject(p)}
                style={{
                  background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 8, padding: 16,
                  cursor: 'pointer', transition: 'border-color 0.15s, transform 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#10B981'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = 'translateY(0)'; }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: t.text3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.address || p.gc_name || ''}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 9, padding: '3px 7px', borderRadius: 8,
                    background: statusColor + '20', color: statusColor,
                    fontFamily: "'DM Mono',monospace", fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap',
                  }}>
                    {(p.status || 'estimating').replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    {p.contract_value && (
                      <div style={{ fontSize: 15, fontWeight: 800, color: t.text, fontFamily: "'DM Mono',monospace" }}>
                        ${Number(p.contract_value).toLocaleString()}
                      </div>
                    )}
                    {p.gc_name && <div style={{ fontSize: 10, color: t.text4 }}>GC: {p.gc_name}</div>}
                  </div>
                  {p.bid_date && (
                    <div style={{
                      fontSize: 10,
                      color: p.bid_date < new Date().toISOString().slice(0, 10) ? '#EF4444' : t.text4,
                      fontFamily: "'DM Mono',monospace",
                    }}>
                      Bid: {fmtDate(p.bid_date)}
                    </div>
                  )}
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
