import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useOrg } from '../../lib/OrgContext.jsx';

const TYPES = ['title_block','scale_bar','sheet_number','room_label','symbol'];
const TYPE_LABEL = {title_block:'Title Block',scale_bar:'Scale Bar',sheet_number:'Sheet #',room_label:'Room Label',symbol:'Symbol'};
const TYPE_COLOR = {title_block:'#10B981',scale_bar:'#3B82F6',sheet_number:'#E8A317',room_label:'#7B6BA4',symbol:'#C0504D'};
const SYMBOL_TYPES = ['door','window','outlet','light_fixture','sprinkler_head','plumbing_fixture','fire_extinguisher','other'];

export default function AnnotationTool() {
  const { orgId } = useOrg();
  const [projects, setProjects] = useState([]);
  const [selProjectId, setSelProjectId] = useState(null);
  const [plans, setPlans] = useState([]);
  const [selPlan, setSelPlan] = useState(null);
  const [annotations, setAnnotations] = useState([]); // for current plan
  const [allAnnotatedIds, setAllAnnotatedIds] = useState(new Set());
  const [mode, setMode] = useState('title_block');
  const [drawing, setDrawing] = useState(null); // {startX, startY, curX, curY}
  const [pendingBox, setPendingBox] = useState(null); // {x, y, w, h} in image px
  const [labelForm, setLabelForm] = useState({});
  const [imgNat, setImgNat] = useState({ w: 1, h: 1 });
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [fitZoom, setFitZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState(null);
  const imgRef = useRef(null);
  const containerRef = useRef(null);

  // Load projects
  useEffect(() => {
    supabase.from('precon_projects').select('id, name').order('created_at', { ascending: false })
      .then(({ data }) => setProjects(data || [])).catch(() => {});
  }, []);

  // Load plans for selected project
  useEffect(() => {
    if (!selProjectId) { setPlans([]); return; }
    supabase.from('precon_plans').select('id, name, file_url').eq('project_id', selProjectId).order('created_at')
      .then(({ data }) => setPlans(data || [])).catch(() => {});
  }, [selProjectId]);

  // Load annotation status for all plans in project
  useEffect(() => {
    if (!selProjectId) return;
    supabase.from('ml_annotations').select('plan_id').eq('annotation_type', 'title_block')
      .then(({ data }) => {
        const ids = new Set((data || []).map(a => a.plan_id));
        setAllAnnotatedIds(ids);
      }).catch(() => {});
  }, [selProjectId, annotations]);

  // Load annotations for selected plan
  useEffect(() => {
    if (!selPlan) { setAnnotations([]); return; }
    supabase.from('ml_annotations').select('*').eq('plan_id', selPlan.id).order('created_at')
      .then(({ data }) => setAnnotations(data || [])).catch(() => {});
  }, [selPlan?.id]);

  // Image load — compute fit zoom
  const onImgLoad = () => {
    const img = imgRef.current;
    const ctr = containerRef.current;
    if (!img || !ctr) return;
    const nat = { w: img.naturalWidth, h: img.naturalHeight };
    setImgNat(nat);
    const cw = ctr.clientWidth - 40, ch = ctr.clientHeight - 40;
    const fit = Math.min(cw / nat.w, ch / nat.h, 1);
    setFitZoom(fit); setZoom(fit); setPanX((cw - nat.w * fit) / 2 + 20); setPanY((ch - nat.h * fit) / 2 + 20);
  };

  // Reset zoom when plan changes
  useEffect(() => { if (selPlan) { setZoom(1); setPanX(0); setPanY(0); } }, [selPlan?.id]);

  // Space key for pan mode
  useEffect(() => {
    const dn = (e) => { if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); setSpaceHeld(true); } };
    const up = (e) => { if (e.code === 'Space') setSpaceHeld(false); };
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  // Screen coords → image pixel coords (accounting for zoom + pan)
  const screenToImg = (e) => {
    const ctr = containerRef.current;
    if (!ctr) return { x: 0, y: 0 };
    const r = ctr.getBoundingClientRect();
    return { x: (e.clientX - r.left - panX) / zoom, y: (e.clientY - r.top - panY) / zoom };
  };

  // Scroll-to-zoom toward cursor
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1 / 1.15 : 1.15;
    setZoom(prev => {
      const nz = Math.min(5, Math.max(fitZoom * 0.5, prev * delta));
      const ctr = containerRef.current;
      if (!ctr) return nz;
      const r = ctr.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const scale = nz / prev;
      setPanX(px => mx - (mx - px) * scale);
      setPanY(py => my - (my - py) * scale);
      return nz;
    });
  }, [fitZoom]);

  // Attach wheel listener (passive:false required for preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Mouse handlers — pan vs draw
  const onMouseDown = (e) => {
    if (!selPlan) return;
    if (pendingBox) return;
    if (spaceHeld || e.button === 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panX, y: e.clientY - panY });
      return;
    }
    if (e.button !== 0) return;
    const p = screenToImg(e);
    setDrawing({ startX: p.x, startY: p.y, curX: p.x, curY: p.y });
  };
  const onMouseMove = (e) => {
    if (isPanning && panStart) {
      setPanX(e.clientX - panStart.x);
      setPanY(e.clientY - panStart.y);
      return;
    }
    if (!drawing) return;
    const p = screenToImg(e);
    setDrawing(prev => prev ? { ...prev, curX: p.x, curY: p.y } : null);
  };
  const onMouseUp = () => {
    if (isPanning) { setIsPanning(false); setPanStart(null); return; }
    if (!drawing) return;
    const x = Math.min(drawing.startX, drawing.curX);
    const y = Math.min(drawing.startY, drawing.curY);
    const w = Math.abs(drawing.curX - drawing.startX);
    const h = Math.abs(drawing.curY - drawing.startY);
    setDrawing(null);
    if (w < 5 || h < 5) return;
    setPendingBox({ x, y, w, h });
    const parts = (selPlan?.name || '').split(' - ');
    setLabelForm({ sheet_number: parts[0] || '', sheet_name: parts[1] || '', scale: '', symbol_type: 'door' });
  };

  // Save annotation
  const saveAnnotation = async (type, label) => {
    if (!pendingBox || !selPlan) return;
    // Boxes are in image pixel coords — normalize to 0-1
    const bbox = {
      x: pendingBox.x / imgNat.w,
      y: pendingBox.y / imgNat.h,
      width: pendingBox.w / imgNat.w,
      height: pendingBox.h / imgNat.h,
    };
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('ml_annotations').insert([{
      plan_id: selPlan.id,
      image_url: selPlan.file_url,
      page_width: imgNat.w,
      page_height: imgNat.h,
      annotation_type: type,
      bounding_box: bbox,
      label: label || null,
      annotated_by: user?.id || null,
    }]).select().single();
    if (error) { alert('Save failed: ' + error.message); return; }
    if (data) setAnnotations(prev => [...prev, data]);
    setPendingBox(null);
  };

  const deleteAnnotation = async (id) => {
    await supabase.from('ml_annotations').delete().eq('id', id);
    setAnnotations(prev => prev.filter(a => a.id !== id));
  };

  const nextUnannotated = () => {
    const unannotated = plans.filter(p => !allAnnotatedIds.has(p.id));
    if (unannotated.length) setSelPlan(unannotated[Math.floor(Math.random() * unannotated.length)]);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') { setPendingBox(null); setDrawing(null); }
      if (e.key === 't' || e.key === 'T') setMode('title_block');
      if (e.key === 's' || e.key === 'S') setMode('scale_bar');
      if (e.key === 'n' || e.key === 'N') nextUnannotated();
      if (e.key === 'z' || e.key === 'Z') { setPendingBox(null); }
      if (e.key === 'p' || e.key === 'P') {
        const idx = plans.findIndex(p => p.id === selPlan?.id);
        if (idx > 0) setSelPlan(plans[idx - 1]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [plans, selPlan, allAnnotatedIds]);

  // Load stats
  const loadStats = async () => {
    const { data } = await supabase.from('ml_annotations').select('annotation_type');
    if (!data) return;
    const counts = {};
    data.forEach(a => { counts[a.annotation_type] = (counts[a.annotation_type] || 0) + 1; });
    setStats({ total: data.length, counts });
    setShowStats(true);
  };

  // Export YOLO
  const exportYolo = async () => {
    const { data: all } = await supabase.from('ml_annotations').select('*');
    if (!all?.length) { alert('No annotations to export.'); return; }
    const classMap = { title_block: 0, scale_bar: 1, sheet_number: 2, room_label: 3, symbol: 4 };
    // Group by plan
    const byPlan = {};
    all.forEach(a => { if (!byPlan[a.plan_id]) byPlan[a.plan_id] = []; byPlan[a.plan_id].push(a); });
    // Build text files
    let csv = 'image_url,class,x_center,y_center,width,height,label\n';
    for (const [pid, anns] of Object.entries(byPlan)) {
      for (const a of anns) {
        const b = a.bounding_box;
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const cls = classMap[a.annotation_type] ?? 4;
        csv += `${a.image_url},${cls},${cx.toFixed(6)},${cy.toFixed(6)},${b.width.toFixed(6)},${b.height.toFixed(6)},${JSON.stringify(a.label || {})}\n`;
      }
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'annotations_yolo.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const annotatedCount = allAnnotatedIds.size;
  const totalPlans = plans.length;

  // ── RENDER ──
  return (
    <div style={{ display: 'flex', height: '100vh', background: '#111', color: '#ddd', fontFamily: 'system-ui, sans-serif' }}>
      {/* LEFT PANEL */}
      <div style={{ width: 250, borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: 12, borderBottom: '1px solid #333' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#10B981', marginBottom: 8 }}>Annotation Tool</div>
          <select value={selProjectId || ''} onChange={e => { setSelProjectId(Number(e.target.value) || null); setSelPlan(null); }}
            style={{ width: '100%', padding: '6px 8px', background: '#222', border: '1px solid #444', borderRadius: 4, color: '#ddd', fontSize: 12 }}>
            <option value="">Select project...</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {totalPlans > 0 && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{annotatedCount} / {totalPlans} annotated</span>
              <span>{totalPlans > 0 ? Math.round(annotatedCount / totalPlans * 100) : 0}%</span>
            </div>
            <div style={{ height: 4, background: '#333', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#10B981', width: `${totalPlans > 0 ? annotatedCount / totalPlans * 100 : 0}%` }} />
            </div>
            <button onClick={nextUnannotated} style={{ marginTop: 6, width: '100%', padding: '5px', background: '#222', border: '1px solid #444', color: '#10B981', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>
              Random unannotated [N]
            </button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {plans.map(p => (
            <div key={p.id} onClick={() => setSelPlan(p)}
              style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
                background: selPlan?.id === p.id ? '#1a2e1a' : 'transparent', borderBottom: '1px solid #222' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: allAnnotatedIds.has(p.id) ? '#10B981' : '#555', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selPlan?.id === p.id ? '#10B981' : '#999' }}>{p.name || 'Unnamed'}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: 8, borderTop: '1px solid #333', display: 'flex', gap: 4 }}>
          <button onClick={loadStats} style={{ flex: 1, padding: '5px', background: '#222', border: '1px solid #444', color: '#999', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>Stats</button>
          <button onClick={exportYolo} style={{ flex: 1, padding: '5px', background: '#222', border: '1px solid #444', color: '#999', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>Export CSV</button>
        </div>
      </div>

      {/* CENTER — Canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Mode toolbar */}
        <div style={{ padding: '6px 12px', borderBottom: '1px solid #333', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {TYPES.map(t => (
            <button key={t} onClick={() => setMode(t)}
              style={{ padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: mode === t ? TYPE_COLOR[t] + '30' : '#222', border: `1px solid ${mode === t ? TYPE_COLOR[t] : '#444'}`, color: mode === t ? TYPE_COLOR[t] : '#888' }}>
              {TYPE_LABEL[t]} {t === 'title_block' ? '[T]' : t === 'scale_bar' ? '[S]' : ''}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {selPlan && <span style={{ fontSize: 10, color: '#666' }}>{selPlan.name}</span>}
        </div>

        {/* Image area */}
        <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', position: 'relative', background: '#0a0a0a', cursor: spaceHeld || isPanning ? 'grab' : 'crosshair' }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
          {selPlan ? (
            <div style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0 }}>
              <img ref={imgRef} src={selPlan.file_url} alt="" onLoad={onImgLoad}
                style={{ display: 'block', userSelect: 'none', pointerEvents: 'none' }} draggable={false} />
              {/* Saved annotations (in image-pixel coords via normalized * natW/H) */}
              {annotations.map(a => {
                const b = a.bounding_box;
                return (
                  <div key={a.id} style={{ position: 'absolute', left: b.x * imgNat.w, top: b.y * imgNat.h, width: b.width * imgNat.w, height: b.height * imgNat.h,
                    border: `${2/zoom}px solid ${TYPE_COLOR[a.annotation_type] || '#10B981'}`, borderRadius: 2, pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', top: -14/zoom, left: 0, fontSize: 9/zoom, background: TYPE_COLOR[a.annotation_type] || '#10B981', color: '#fff', padding: `${1/zoom}px ${4/zoom}px`, borderRadius: 2, whiteSpace: 'nowrap', transformOrigin: 'top left' }}>
                      {TYPE_LABEL[a.annotation_type] || a.annotation_type}
                    </div>
                  </div>
                );
              })}
              {/* Drawing box (image-pixel coords) */}
              {drawing && (
                <div style={{ position: 'absolute',
                  left: Math.min(drawing.startX, drawing.curX), top: Math.min(drawing.startY, drawing.curY),
                  width: Math.abs(drawing.curX - drawing.startX), height: Math.abs(drawing.curY - drawing.startY),
                  border: `${2/zoom}px dashed #10B981`, background: 'rgba(16,185,129,0.08)', pointerEvents: 'none' }} />
              )}
              {/* Pending box (image-pixel coords) */}
              {pendingBox && (
                <div style={{ position: 'absolute', left: pendingBox.x, top: pendingBox.y, width: pendingBox.w, height: pendingBox.h,
                  border: `${2/zoom}px solid ${TYPE_COLOR[mode]}`, background: `${TYPE_COLOR[mode]}15`, pointerEvents: 'none' }} />
              )}
            </div>
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 14 }}>Select a plan to start annotating</div>
          )}
          {/* Zoom controls */}
          {selPlan && (
            <div style={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 4, alignItems: 'center', zIndex: 10 }}>
              <button onClick={() => setZoom(z => Math.max(fitZoom * 0.5, z / 1.3))} style={{ width: 28, height: 28, background: '#222', border: '1px solid #444', color: '#ddd', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>&minus;</button>
              <span style={{ fontSize: 11, color: '#888', minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(5, z * 1.3))} style={{ width: 28, height: 28, background: '#222', border: '1px solid #444', color: '#ddd', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>+</button>
              <button onClick={onImgLoad} style={{ padding: '4px 8px', background: '#222', border: '1px solid #444', color: '#888', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>Fit</button>
            </div>
          )}
        </div>

        {/* Label form */}
        {pendingBox && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid #333', background: '#1a1a1a', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#888' }}>Label as:</span>
            {mode === 'title_block' && (<>
              <input value={labelForm.sheet_number || ''} onChange={e => setLabelForm(p => ({ ...p, sheet_number: e.target.value }))} placeholder="Sheet #"
                style={{ width: 80, padding: '4px 6px', background: '#222', border: '1px solid #444', borderRadius: 3, color: '#ddd', fontSize: 11 }} />
              <input value={labelForm.sheet_name || ''} onChange={e => setLabelForm(p => ({ ...p, sheet_name: e.target.value }))} placeholder="Sheet Name"
                style={{ width: 160, padding: '4px 6px', background: '#222', border: '1px solid #444', borderRadius: 3, color: '#ddd', fontSize: 11 }} />
              <button onClick={() => saveAnnotation('title_block', { sheet_number: labelForm.sheet_number, sheet_name: labelForm.sheet_name })}
                style={{ padding: '4px 12px', background: '#10B981', border: 'none', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Save Title Block</button>
            </>)}
            {mode === 'scale_bar' && (<>
              <input value={labelForm.scale || ''} onChange={e => setLabelForm(p => ({ ...p, scale: e.target.value }))} placeholder='e.g. 1/4"=1&apos;-0"'
                style={{ width: 140, padding: '4px 6px', background: '#222', border: '1px solid #444', borderRadius: 3, color: '#ddd', fontSize: 11 }} />
              <button onClick={() => saveAnnotation('scale_bar', { scale: labelForm.scale })}
                style={{ padding: '4px 12px', background: '#3B82F6', border: 'none', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Save Scale</button>
            </>)}
            {mode === 'sheet_number' && (
              <button onClick={() => saveAnnotation('sheet_number', { text: selPlan?.name?.split(' - ')[0] || '' })}
                style={{ padding: '4px 12px', background: '#E8A317', border: 'none', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Save Sheet #</button>
            )}
            {mode === 'room_label' && (<>
              <input value={labelForm.room || ''} onChange={e => setLabelForm(p => ({ ...p, room: e.target.value }))} placeholder="Room name"
                style={{ width: 120, padding: '4px 6px', background: '#222', border: '1px solid #444', borderRadius: 3, color: '#ddd', fontSize: 11 }} />
              <button onClick={() => saveAnnotation('room_label', { text: labelForm.room })}
                style={{ padding: '4px 12px', background: '#7B6BA4', border: 'none', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Save Room</button>
            </>)}
            {mode === 'symbol' && (<>
              <select value={labelForm.symbol_type || 'door'} onChange={e => setLabelForm(p => ({ ...p, symbol_type: e.target.value }))}
                style={{ padding: '4px 6px', background: '#222', border: '1px solid #444', borderRadius: 3, color: '#ddd', fontSize: 11 }}>
                {SYMBOL_TYPES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
              <button onClick={() => saveAnnotation('symbol', { symbol_type: labelForm.symbol_type || 'door' })}
                style={{ padding: '4px 12px', background: '#C0504D', border: 'none', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Save Symbol</button>
            </>)}
            <button onClick={() => setPendingBox(null)} style={{ padding: '4px 10px', background: '#333', border: 'none', color: '#999', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>Cancel [Esc]</button>
          </div>
        )}
      </div>

      {/* RIGHT PANEL */}
      <div style={{ width: 250, borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #333', fontSize: 12, fontWeight: 600 }}>
          Annotations {annotations.length > 0 && <span style={{ color: '#10B981' }}>({annotations.length})</span>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {annotations.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 11 }}>No annotations yet.<br />Draw a box on the plan.</div>}
          {annotations.map(a => (
            <div key={a.id} style={{ padding: '8px 12px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLOR[a.annotation_type] || '#555', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: TYPE_COLOR[a.annotation_type] || '#888' }}>{TYPE_LABEL[a.annotation_type]}</div>
                <div style={{ fontSize: 10, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.label?.sheet_number || a.label?.scale || a.label?.symbol_type || a.label?.text || '—'}
                </div>
              </div>
              <button onClick={() => deleteAnnotation(a.id)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12 }}>&times;</button>
            </div>
          ))}
        </div>
      </div>

      {/* Stats modal */}
      {showStats && stats && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowStats(false)}>
          <div style={{ background: '#1a1a1a', borderRadius: 12, padding: 24, width: 400, border: '1px solid #333' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#10B981', marginBottom: 16 }}>Annotation Stats</div>
            <div style={{ fontSize: 13, color: '#ddd', marginBottom: 12 }}>Total: <strong>{stats.total}</strong></div>
            {Object.entries(stats.counts || {}).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: TYPE_COLOR[type] || '#555' }} />
                <span style={{ flex: 1, fontSize: 12, color: '#999' }}>{TYPE_LABEL[type] || type}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#ddd', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
              </div>
            ))}
            <button onClick={() => setShowStats(false)} style={{ marginTop: 16, width: '100%', padding: '8px', background: '#333', border: 'none', color: '#ddd', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
