import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTheme } from "../../lib/theme.jsx";
import { TAKEOFF_CATS as STATIC_CATS, TAKEOFF_TYPES, TO_COLORS, CONSTRUCTION_SCALES, UNIT_COSTS_DEFAULT, ASSEMBLIES, COMPANIES, AI_MODEL, AI_MODEL_FAST } from "../../lib/constants.js";
import { loadCategories, getCachedCategories, findCategory } from "../../lib/categories.js";
import { supabase } from "../../lib/supabase.js";
import { calcArea, calcLinear, bezierPt, bezierLength, calcShapeArea, calcShapeLength, buildShapePath, normalizeShapes, splitShapeHoles, pointInPoly, clipPolygonToOuter, calcShapeNetArea, snapToAngle, idMatch } from "../../lib/geometry.js";
import { TakeoffItemModal, UnitCostEditor, AssemblyPicker, BidSummaryModal, TakeoffProjectModal, AddItemInline, NewConditionRow, InlineItemEditor } from "./TakeoffComponents.jsx";
import { generateProposalPdf } from "./proposalPdf.js";
import LibraryPanel from "./LibraryPanel.jsx";
import { loadRegionalPricing, getRegionForState, getRegionalCost, getDefaultCostForCategory } from "../../lib/regionalPricing.js";

const fmtDate = d => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}) : '';

// ── PlanRow: file-scope memo'd component (prevents unmount/remount on parent render) ──
const PlanRow = React.memo(({ p, folderId, cnt, isMarked, isActive, isOpen, dragOverId, handlersRef, searchQuery }) => {
  const H = handlersRef.current;
  const t = H.t;
  return (
    <div onClick={() => {
        if (!H.openTabs.includes(p.id)) H.setOpenTabs(prev => [...prev, p.id]);
        H.setSelPlan(p); H.setShowOverview(false);
        if (p.scale_px_per_ft) H.setScale(p.scale_px_per_ft);
        else { H.setScale(null); H.setPresetScale(''); }
        H.setLeftTab('takeoffs');
      }}
      draggable
      onDragStart={() => { H.planDragRef.current = p.id; }}
      onDragOver={(e) => { e.preventDefault(); H.setPlanDragOver(p.id); }}
      onDragLeave={() => { if (H.planDragOver === p.id) H.setPlanDragOver(null); }}
      onDrop={(e) => {
        e.preventDefault();
        const fromId = H.planDragRef.current;
        if (!fromId || fromId === p.id) { H.setPlanDragOver(null); return; }
        H.setPlans(prev => {
          const next = [...prev];
          const fromIdx = next.findIndex(x => x.id === fromId);
          const toIdx = next.findIndex(x => x.id === p.id);
          if (fromIdx < 0 || toIdx < 0) return prev;
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return next;
        });
        H.setPlanDragOver(null); H.planDragRef.current = null;
      }}
      onDragEnd={() => { H.setPlanDragOver(null); H.planDragRef.current = null; }}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px 5px 20px', borderRadius: 5,
        cursor: 'grab', marginBottom: 1,
        background: isActive ? 'rgba(16,185,129,0.1)' : dragOverId === p.id ? 'rgba(59,130,246,0.1)' : 'transparent',
        borderLeft: isActive ? '2px solid #4CAF50' : isMarked ? '2px solid rgba(16,185,129,0.35)' : '2px solid transparent',
        borderTop: dragOverId === p.id ? '2px solid #5B9BD5' : '2px solid transparent',
        transition: 'background 0.1s'
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: isActive ? 700 : 400, color: isActive ? '#4CAF50' : t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(()=>{
          const name = p.name||'Unnamed';
          if(!searchQuery) return name;
          const re = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi');
          const parts = name.split(re);
          if(parts.length===1) return name;
          return parts.map((s,i)=>re.test(s)?<mark key={i} style={{background:'#FFEB3B',color:'#333',padding:'0 1px',borderRadius:1}}>{s}</mark>:s);
        })()}</div>
        {searchQuery && p.ocr_text?.toLowerCase().includes(searchQuery.toLowerCase()) && (
          <div style={{ fontSize: 8, color: '#4CAF50', marginTop: 1 }}>Content match</div>
        )}
        <div style={{ fontSize: 8, color: t.text4, display: 'flex', alignItems: 'center', gap: 3 }}>
          {isMarked && <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#4CAF50', flexShrink: 0 }} />}
          <span>{cnt ? `${cnt} item${cnt !== 1 ? 's' : ''}` : 'No items'}{isOpen ? ' · open' : ''}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <button onClick={async () => {
          const n = window.prompt('Rename:', p.name || '');
          if (n?.trim() && p.id !== 'preview') {
            await supabase.from('precon_plans').update({ name: n.trim() }).eq('id', p.id);
            H.setPlans(prev => prev.map(x => x.id === p.id ? { ...x, name: n.trim() } : x));
            if (H.selPlan?.id === p.id) H.setSelPlan(prev => ({ ...prev, name: n.trim() }));
          }
        }} style={{ fontSize: 8, padding: '2px 4px', borderRadius: 3, border: `1px solid ${t.border}`, background: 'none', color: t.text4, cursor: 'pointer' }}>✎</button>
        <button onClick={async (e) => {
          const btn = e.currentTarget; btn.textContent = '…'; btn.disabled = true;
          // Try free text parsing first
          const textName = H.parseSheetNameFromText?.(p.ocr_text||'', p.text_positions);
          let finalName = null;
          if(textName && textName.length > 2 && textName !== p.name) { finalName = textName; }
          else { finalName = await H.aiNameSheet(p.file_url, p.name || 'Sheet'); }
          if (finalName && finalName !== p.name && p.id !== 'preview') {
            await supabase.from('precon_plans').update({ name: finalName }).eq('id', p.id);
            H.setPlans(prev => prev.map(x => x.id === p.id ? { ...x, name: finalName } : x));
            if (H.selPlan?.id === p.id) H.setSelPlan(prev => ({ ...prev, name: finalName }));
          }
          btn.textContent = '✦'; btn.disabled = false;
        }} style={{ fontSize: 8, padding: '2px 4px', borderRadius: 3, border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.06)', color: '#7B6BA4', cursor: 'pointer' }} title="AI name">✦</button>
        <button onClick={async () => {
          if (p.id === 'preview') return;
          const withTakeoffs = window.confirm('Duplicate with takeoffs?\n\nOK = Plan + Takeoffs\nCancel = Plan Only');
          const { data: newPlan } = await supabase.from('precon_plans').insert([{ project_id: p.project_id, name: (p.name || 'Sheet') + ' (Copy)', file_url: p.file_url, file_type: p.file_type, scale_px_per_ft: p.scale_px_per_ft }]).select().single();
          if (!newPlan) return;
          const clonedItems = [];
          if (withTakeoffs) {
            const planItemsToDup = H.items.filter(i => i.plan_id === p.id);
            for (const it of planItemsToDup) {
              const { id, ...rest } = it;
              const { data: ni } = await supabase.from('takeoff_items').insert([{ ...rest, plan_id: newPlan.id }]).select().single();
              if (ni) clonedItems.push(ni);
            }
          }
          H.setPlans(prev => {
            const idx = prev.findIndex(x => x.id === p.id);
            const next = [...prev];
            next.splice(idx + 1, 0, newPlan);
            return next;
          });
          if (folderId && H.planSets[folderId]) {
            const folder = H.planSets[folderId];
            const folderPlanIds = [...(folder.planIds || [])];
            const origIdx = folderPlanIds.indexOf(p.id);
            if (origIdx >= 0) folderPlanIds.splice(origIdx + 1, 0, newPlan.id);
            else folderPlanIds.push(newPlan.id);
            H.savePlanSets({ ...H.planSets, [folderId]: { ...folder, planIds: folderPlanIds } });
          }
          if (clonedItems.length) H.setItems(prev => [...prev, ...clonedItems]);
        }} style={{ fontSize: 8, padding: '2px 4px', borderRadius: 3, border: '1px solid rgba(59,130,246,0.3)', background: 'none', color: '#5B9BD5', cursor: 'pointer' }} title="Duplicate plan">⧉</button>
        <button onClick={async () => {
          if (!window.confirm('Delete this sheet?')) return;
          if (p.id !== 'preview') { const { error } = await supabase.from('precon_plans').delete().eq('id', p.id).select(); if (error) { console.error('plan delete error:', error); alert('Delete failed: ' + error.message); return; } }
          H.setPlans(prev => prev.filter(x => x.id !== p.id));
          H.setOpenTabs(prev => prev.filter(id => id !== p.id));
          if (H.selPlan?.id === p.id) H.setSelPlan(null);
          const updated = {};
          Object.entries(H.planSets).forEach(([bid, s]) => { updated[bid] = { ...s, planIds: (s.planIds || []).filter(id => id !== p.id) }; });
          H.savePlanSets(updated);
        }} style={{ fontSize: 8, padding: '2px 4px', borderRadius: 3, border: '1px solid rgba(239,68,68,0.25)', background: 'none', color: '#C0504D', cursor: 'pointer' }}>✕</button>
      </div>
    </div>
  );
});

function TakeoffWorkspace({ project, onBack, apmProjects, onExitToOps }) {
  const { t } = useTheme();
  const [plans, setPlans] = useState([]);
  const [planSets, setPlanSets] = useState({}); // {batchId:{name,planIds:[]}} persisted to localStorage
  const [namingAll, setNamingAll] = useState(false);
  const [uploadTargetFolder, setUploadTargetFolder] = useState(null);
  const [plansFilter, setPlansFilter] = useState('all'); // 'all' | 'marked'
  const [selPlan, setSelPlan] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiCredits, setAiCredits] = useState(null); // {available, monthly, used, purchased, reset_at}
  const [showCreditsDD, setShowCreditsDD] = useState(false);
  const [showSheetSelector, setShowSheetSelector] = useState(false);
  const [selectedSheets, setSelectedSheets] = useState(new Set());
  const [aiProgress, setAiProgress] = useState(null); // {current, total} during batch
  const [tool, setTool] = useState('select');
  const [activePts, setActivePts] = useState([]);
  const [hoverPt, setHoverPt] = useState(null);
  const [scale, setScale] = useState(null);
  const [scaleStep, setScaleStep] = useState(null);
  const [scalePts, setScalePts] = useState([]);
  const [scaleDist, setScaleDist] = useState('');
  const [scaleUnit, setScaleUnit] = useState('ft');
  const [imgNat, setImgNat] = useState({w:1,h:1});
  const [imgDisp, setImgDisp] = useState({w:1,h:1});
  const [editItem, setEditItem] = useState(null);
  const [planB64, setPlanB64] = useState(null);
  const [planMime, setPlanMime] = useState('image/png');
  const [rightTab, setRightTab] = useState('items');
  const [mainView, setMainView] = useState('workspace'); // 'workspace' | 'reports'
  const [reportSort, setReportSort] = useState({col:'description',asc:true});
  const [reportSearch, setReportSearch] = useState('');
  const [reportType, setReportType] = useState('takeoff_quantity');
  const [reportGroupBy, setReportGroupBy] = useState('none'); // 'none'|'category'|'sheet'|'type'
  const [reportCols, setReportCols] = useState({name:true,description:true,quantity:true,unit:true,scale:true,location:true,revision:true,trade:true,unit_cost:true,total_cost:true});
  const [showColDropdown, setShowColDropdown] = useState(false);
  const [proposalCompany, setProposalCompany] = useState(project.company || 'fcg');
  const [proposalScope, setProposalScope] = useState(() => {
    try { return localStorage.getItem(`proposalScope_${project.id}`) || ''; } catch { return ''; }
  });
  const [proposalTerms, setProposalTerms] = useState(() => {
    try { return localStorage.getItem(`proposalTerms_${project.id}`) || ''; } catch { return ''; }
  });
  const [companyProfile, setCompanyProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem('companyProfile') || 'null'); } catch { return null; }
  });
  const [clientInfo, setClientInfo] = useState({
    name: project.client_name || '', company: project.client_company || project.gc_name || '',
    address: project.client_address || '', email: project.client_email || '', phone: project.client_phone || '',
  });
  const [editModal, setEditModal] = useState(null); // 'scope'|'terms'|'client'|'company'|null
  const [estSubTab, setEstSubTab] = useState('worksheet'); // 'summary' | 'worksheet'
  const [estGroupBy, setEstGroupBy] = useState('category'); // 'category'|'sheet'|'trade'|'location'|'none'
  const [collapsedEstGroups, setCollapsedEstGroups] = useState({});
  const [regionalData, setRegionalData] = useState(null); // {pricing, multipliers, states, stateToRegion}
  const [dynamicCats, setDynamicCats] = useState(null);
  const TAKEOFF_CATS = dynamicCats || STATIC_CATS;
  const [showCatManager, setShowCatManager] = useState(false);
  const [editCat, setEditCat] = useState(null);
  const projectRegion = regionalData ? getRegionForState(project.state_code) : 'National';
  const [overheadPct, setOverheadPct] = useState(0);
  const [profitPct, setProfitPct] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showScalePicker, setShowScalePicker] = useState(false);
  const [presetScale, setPresetScale] = useState('');
  const [planDpi, setPlanDpi] = useState(144); // DPI — PDFs render at scale 2.0 (72*2=144)
  const [showAssembly, setShowAssembly] = useState(false);
  const [showUnitCosts, setShowUnitCosts] = useState(false);
  const [showBidSummary, setShowBidSummary] = useState(false);
  const [editProject, setEditProject] = useState(false);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [planErr, setPlanErr] = useState(null);
  const pdfDocRef = useRef(null);
  const imgRef = useRef();
  const canvasRef = useRef();
  const svgRef = useRef();
  const fileRef = useRef();
  const containerRef = useRef();
  const panRef = useRef({active:false, startX:0, startY:0, scrollX:0, scrollY:0});
  const clickTimerRef = useRef(null);   // debounce single vs double click
  const pendingClickRef = useRef(null); // pending single-click event pos
  const itemsRef = useRef(items); // always-current items ref — fixes stale closure in appendMeasurement
  const activePtsRef    = useRef([]);
  const activeCondIdRef = useRef(null);
  const selPlanRef      = useRef(null);
  const commitCurrentPtsRef = useRef(null); // assigned mid-render after appendMeasurement is defined
  const deleteShapesRef  = useRef(null); // assigned each render — callable from keydown
  const copyShapesRef    = useRef(null); // assigned each render — callable from keydown
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [activeCondId, setActiveCondId] = useState(null); // condition currently armed for drawing
  const [estSaving, setEstSaving] = useState(null);
  const [estHover, setEstHover] = useState(null);
  const [collapsedCats, setCollapsedCats] = useState({});
  const [archMode, setArchMode] = useState(false);        // legacy arch toggle (area arcs)
  const [archCtrlPending, setArchCtrlPending] = useState(false); // area: next click = ctrl pt
  // ── New tool features ──────────────────────────────────────────────────
  const [snapEnabled, setSnapEnabled]   = useState(false); // S-key angle snap
  const [arcPending, setArcPending]     = useState(false); // A-key arc mode
  const [selectedShapes, setSelectedShapes] = useState(new Set()); // shape-level: "itemId::shapeIdx"
  const selectedShapesRef               = useRef(new Set()); // always-current ref for keydown
  const [clipboard, setClipboard]       = useState([]);    // copy/paste buffer
  const clipboardRef                    = useRef([]);       // always-current ref for keydown
  const [eraserHover, setEraserHover]   = useState(null);  // {itemId,shapeIdx}
  const [lassoRect, setLassoRect]       = useState(null);  // {sx,sy,ex,ey} live lasso box
  const [copyFlash, setCopyFlash]         = useState(0);     // >0 = show 'Copied N' briefly
  const [dragOffset, setDragOffset]       = useState(null);  // {dx,dy} during shape drag
  const [vertexDrag, setVertexDrag]       = useState(null);  // {itemId,shapeIdx,vertexIdx,point:{x,y}}
  const dragOffsetRef                     = useRef(null);
  const vertexDragRef                     = useRef(null);
  const undoStackRef                    = useRef([]);
  const redoStackRef                    = useRef([]);
  const pasteOffsetRef                  = useRef(0);        // accumulates per paste
  const lassoStartRef                   = useRef(null);     // lasso drag start
  const suppressNextClickRef            = useRef(false);    // suppress SVG click after lasso drag
  const [showMoveMenu, setShowMoveMenu] = useState(null);
  const [takeoffStep, setTakeoffStep] = useState(null); // null | 'type' | 'create' | 'settings'
  const [newTOType, setNewTOType] = useState(null);
  const [newTOName, setNewTOName] = useState('');
  const [newTODesc, setNewTODesc] = useState('');
  const [newTOColor, setNewTOColor] = useState('#4CAF50');
  const [newTOCat, setNewTOCat] = useState('other');
  const [newTOSize, setNewTOSize] = useState('medium');
  const [creatingTO, setCreatingTO] = useState(false);
  const [toSearch, setToSearch] = useState('');
  const [collapsedPlans, setCollapsedPlans] = useState({});
  const [showSheetsDD, setShowSheetsDD] = useState(false);
  const [showScalePanel, setShowScalePanel] = useState(false);
  const [customScaleInput, setCustomScaleInput] = useState('');
  const [openTabs, setOpenTabs] = useState([]); // plan IDs open as browser tabs
  const planDragRef = useRef(null);
  const [planDragOver, setPlanDragOver] = useState(null);
  const [leftTab, setLeftTab] = useState('takeoffs'); // 'plans' | 'takeoffs' | 'library'
  const [showOverview, setShowOverview] = useState(true); // plan overview grid
  const [markupMode, setMarkupMode] = useState(null); // null | 'highlight' | 'cloud' | 'callout' | 'dimension' | 'text' | 'legend'
  const [markups, setMarkups] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`markups_${project.id}`)||'[]'); } catch { return []; }
  });
  const [activeMarkup, setActiveMarkup] = useState(null); // markup being drawn
  const [markupColor, setMarkupColor] = useState('#FF6B6B');
  const [markupDrag, setMarkupDrag] = useState(null); // {id, startMouse, startPos, resize?}
  const markupDragRef = useRef(null);

  // Persist markups to localStorage
  useEffect(() => {
    try { localStorage.setItem(`markups_${project.id}`, JSON.stringify(markups)); } catch {}
  }, [markups, project.id]);

  // ── Always-current refs: assigned synchronously each render (correct React pattern) ──
  // avoids TDZ crash that useEffect([dep]) would cause when refs precede state declarations
  itemsRef.current        = items;          // must be sync — keydown delete reads this
  activePtsRef.current    = activePts;
  activeCondIdRef.current = activeCondId;
  selPlanRef.current      = selPlan;
  selectedShapesRef.current = selectedShapes;
  clipboardRef.current    = clipboard;
  dragOffsetRef.current   = dragOffset;
  vertexDragRef.current   = vertexDrag;
  markupDragRef.current   = markupDrag;

  // ── Pre-computed lookup maps (O(n) once, O(1) per row) ─────────────────
  const planItemCountMap = useMemo(() => {
    const m = new Map();
    for (const it of items) { if (it.plan_id != null) m.set(it.plan_id, (m.get(it.plan_id) || 0) + 1); }
    return m;
  }, [items]);

  const planMarkedSet = useMemo(() => {
    const s = new Set();
    for (const it of items) { if (it.points?.length && it.plan_id != null) s.add(it.plan_id); }
    return s;
  }, [items]);

  const planMap = useMemo(() => {
    const m = new Map();
    for (const p of plans) m.set(p.id, p);
    return m;
  }, [plans]);

  // ── Plan search state ──────────────────────────────────────────────────
  const [planSearch, setPlanSearch] = useState('');

  // ── Undo / Redo helpers ────────────────────────────────────────────────
  const pushUndo = () => {
    const snap = JSON.parse(JSON.stringify(itemsRef.current));
    undoStackRef.current = [...undoStackRef.current.slice(-29), snap];
    redoStackRef.current = [];
  };

  const syncAllItemsToSupabase = (its) => {
    const planId = selPlanRef.current?.id;
    if(!planId) return;
    its.filter(i=>i.plan_id===planId).forEach(i=>{
      supabase.from('takeoff_items').update({points:i.points,quantity:i.quantity,total_cost:i.total_cost}).eq('id',i.id);
    });
  };

  const undo = () => {
    if(!undoStackRef.current.length) return;
    const prev = undoStackRef.current[undoStackRef.current.length-1];
    undoStackRef.current = undoStackRef.current.slice(0,-1);
    redoStackRef.current = [...redoStackRef.current, JSON.parse(JSON.stringify(itemsRef.current))];
    setItems(prev);
    syncAllItemsToSupabase(prev);
  };

  const redo = () => {
    if(!redoStackRef.current.length) return;
    const next = redoStackRef.current[redoStackRef.current.length-1];
    redoStackRef.current = redoStackRef.current.slice(0,-1);
    undoStackRef.current = [...undoStackRef.current, JSON.parse(JSON.stringify(itemsRef.current))];
    setItems(next);
    syncAllItemsToSupabase(next);
  };

  useEffect(()=>{
    const pid = project.id;
    // Load plan sets from localStorage
    try {
      const stored = JSON.parse(localStorage.getItem(`planSets_${pid}`)||'{}');
      setPlanSets(stored);
    } catch(e){}
    Promise.all([
      supabase.from('precon_plans').select('*').eq('project_id',pid).order('created_at'),
      supabase.from('takeoff_items').select('*').eq('project_id',pid).order('sort_order'),
    ]).then(([{data:p,error:e1},{data:i,error:e2}])=>{
      if(e1) console.error('[load] plans error:', e1);
      if(e2) console.error('[load] items error:', e2);
      console.log('[load] plans:', (p||[]).length, 'items:', (i||[]).length, 'plans with ocr_text:', (p||[]).filter(x=>x.ocr_text).length);
      const pl=p||[];
      const validItems=(i||[]).filter(it=>it.plan_id!=null);
      setPlans(pl); setItems(validItems);
      if(pl.length>0){setSelPlan(pl[0]); if(pl[0].scale_px_per_ft) setScale(pl[0].scale_px_per_ft);}
      setLoading(false);
    });
  },[project.id]);

  // Load dynamic categories + regional pricing
  useEffect(()=>{
    loadCategories().then(cats=>setDynamicCats(cats)).catch(()=>{});
    loadRegionalPricing().then(data=>setRegionalData(data)).catch(()=>{});
  },[]);

  // Load AI credits on mount (skip silently if org tables don't exist)
  useEffect(()=>{
    supabase.rpc('get_ai_credits').then(({data,error})=>{
      if(!error && data) setAiCredits(data);
      else setAiCredits({available:999,monthly:999,used:0,purchased:0,reset_at:null});
    });
  },[]);

  // Helper: save planSets to localStorage
  const savePlanSets = (sets) => {
    setPlanSets(sets);
    try { localStorage.setItem(`planSets_${project.id}`, JSON.stringify(sets)); } catch(e){}
  };

  // Human-readable scale label from px/ft value
  const scaleLabel = (s, preset) => {
    if (preset) return preset;
    if (!s) return 'Not set';
    // Try to reverse-match to a construction scale
    const dpi = planDpi || 144;
    for (const cs of CONSTRUCTION_SCALES) {
      const expected = (dpi * 12) / cs.ratio;
      if (Math.abs(expected - s) / s < 0.02) return cs.label; // within 2%
    }
    // Derive: 1" on paper = (dpi / scale) feet
    const ftPerInch = dpi / s;
    if (ftPerInch >= 1) return `1" = ${Math.round(ftPerInch)}'`;
    return `Scale: ${Math.round(s * 10) / 10} px/ft`;
  };

  // Points stored as raw SVG pixel coords — no normalization needed
  // toPx is identity: SVG coord space = image pixel space
  const toPx=(x,y)=>({x,y});

  // Helper: get effective display quantity and unit for an item
  // Linear items with height → SF (LF × height = SF wall area)
  // DB stores raw LF — height conversion is display-time only
  const getDisplayQtyUnit = (item) => {
    let rawQty = (item.quantity || 0) * (item.multiplier || 1);
    const mt = item.measurement_type;
    const h = item.height || 0;
    let unit = item.unit || '';
    // Linear × height → SF
    if (mt === 'linear' && h > 0) { rawQty = rawQty * h; unit = 'SF'; }
    // Pitch multiplier (roofing)
    const pitchMult = item.pitch_multiplier || 1;
    if (pitchMult !== 1) rawQty = rawQty * pitchMult;
    // Waste factor
    const waste = item.waste_percent || 0;
    if (waste > 0) rawQty = rawQty * (1 + waste / 100);
    return { qty: rawQty, unit };
  };

  // Compute total cost for an item using all factors
  const computeTotalCost = (item, qty) => {
    const q = qty != null ? qty : (item.quantity || 0);
    const mult = item.multiplier || 1;
    const hFactor = (item.measurement_type === 'linear' && item.height > 0) ? item.height : 1;
    const pitchMult = item.pitch_multiplier || 1;
    const wasteFactor = 1 + (item.waste_percent || 0) / 100;
    return q * mult * hFactor * pitchMult * wasteFactor * (item.unit_cost || 0);
  };

  // Highlight search term in text
  const highlightText = (text, query) => {
    if (!query || !text) return text || '';
    const q = query.trim();
    if (!q) return text;
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    if (parts.length === 1) return text;
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} style={{background:'#FFEB3B',color:'#333',padding:'0 1px',borderRadius:1}}>{part}</mark> : part
    );
  };

  // planItems: strict per-sheet item list. Defined early so all handlers can use it.
  // IMPORTANT: items with null plan_id are excluded — they have no valid page association.
  const planItems=items.filter(i=>i.plan_id!=null && i.plan_id===selPlan?.id);

  // Sidebar shows ALL project items (across all plans) so you can arm any takeoff
  // regardless of which plan you're currently on. Items are deduplicated by
  // description+category — the first item found acts as the "canonical" arm target;
  // the sibling logic in appendMeasurement handles per-plan branching automatically.
  const sidebarItems = items.filter(i=>i.project_id===project.id);

  const getSvgPos=(e)=>{
    const c=containerRef.current;
    if(!c) return {x:0,y:0};
    const cr=c.getBoundingClientRect();
    // Mouse offset from container top-left, plus scroll, divided by zoom = SVG pixel coord
    return {
      x:(e.clientX - cr.left + c.scrollLeft) / zoom,
      y:(e.clientY - cr.top  + c.scrollTop)  / zoom,
    };
  };

  const calcArea=(pts)=>{
    if(!scale||pts.length<3) return 0;
    let a=0;
    for(let i=0;i<pts.length;i++){
      const j=(i+1)%pts.length;
      a+=pts[i].x*pts[j].y - pts[j].x*pts[i].y;
    }
    return Math.abs(a)/2/(scale*scale); // px² → ft²
  };

  const calcLinear=(p1,p2)=>{
    if(!scale) return 0;
    return Math.sqrt((p2.x-p1.x)**2+(p2.y-p1.y)**2)/scale; // px → ft
  };

  const fitZoomToContainer=({w,h})=>{
    const c=containerRef.current;
    if(!c||w<4||h<4) return;
    const cw=c.clientWidth;
    if(cw<1) return;
    const fit=(cw/w)*0.98; // fit to width, scroll vertically
    setZoom(parseFloat(Math.min(fit,2).toFixed(2)));
  };

  const handleImgLoad=()=>{
    const img=imgRef.current;
    if(!img) return;
    const nat={w:img.naturalWidth, h:img.naturalHeight};
    setImgNat(nat);
    setImgDisp({w:img.offsetWidth||img.naturalWidth, h:img.offsetHeight||img.naturalHeight});
    if(selPlan?.file_url) dimCacheRef.current[selPlan.file_url] = nat;
    fitZoomToContainer(nat);
  };

  const renderPdfPage = async (doc, pageN=1) => {
    if(!doc) return;
    // Wait for canvas to be in DOM
    let canvas = canvasRef.current;
    if(!canvas){
      await new Promise(r=>setTimeout(r,120));
      canvas = canvasRef.current;
    }
    if(!canvas) return;
    setRendering(true);
    try {
      const page = await doc.getPage(pageN);
      const viewport = page.getViewport({scale: 2.0});
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      await page.render({canvasContext: ctx, viewport}).promise;
      const nat={w:viewport.width, h:viewport.height};
      setImgNat(nat);
      setImgDisp({w:viewport.width, h:viewport.height});
      setPlanDpi(144); // PDF.js at scale:2 × 72pt/in = 144px/in
      fitZoomToContainer(nat);
    } catch(e){ console.error('renderPdfPage error', e); }
    setRendering(false);
  };

  const loadPdf = async (src) => {
    const lib = await ensurePdfLib();
    if(!lib) return null;
    try {
      lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const doc = await lib.getDocument(src).promise;
      pdfDocRef.current = doc;
      setPdfDoc(doc);
      await renderPdfPage(doc, 1);
      return doc;
    } catch(e) {
      console.error('PDF load error:', e);
      return null;
    }
  };

  const ensurePdfLib = () => new Promise((resolve)=>{
    if(window.pdfjsLib){ resolve(window.pdfjsLib); return; }
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload=()=>resolve(window.pdfjsLib);
    s.onerror=()=>resolve(null);
    document.head.appendChild(s);
  });

  // Cleanup blob URLs on unmount
  useEffect(()=>{
    return ()=>{ if(blobUrl&&blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl); };
  },[blobUrl]);

  // Sync spaceHeld into panRef so mousedown handler (non-closure) can read it
  useEffect(()=>{ panRef.current._spaceHeld = spaceHeld; },[spaceHeld]);

  useEffect(()=>{
    const handleKey=(e)=>{
      // Ignore if typing in an input/textarea
      const tag=(e.target?.tagName||'').toLowerCase();
      if(tag==='input'||tag==='textarea'||tag==='select'||e.target?.isContentEditable) return;

      if(e.key===' '){ e.preventDefault(); setSpaceHeld(true); }

      if(e.key==='Escape'){
        setActivePts([]); setScalePts([]); setScaleStep(null);
        setTool('select'); setShowScalePicker(false);
        setArcPending(false); setArchMode(false); setArchCtrlPending(false);
        setSelectedShapes(new Set());
        setDragOffset(null); setVertexDrag(null);
        setActiveCondId(null); setMarkupMode(null); setActiveMarkup(null);
      }

      // V — switch to Select tool
      if(e.key==='v'||e.key==='V'){
        if(!(e.ctrlKey||e.metaKey)){
          setTool('select'); setActivePts([]); setArcPending(false); setArchMode(false);
        }
      }

      // S — toggle angle snap (45°/60°/90°)
      if(e.key==='s'||e.key==='S'){
        setSnapEnabled(p=>!p);
      }

      // A — arc mode: next click becomes a bezier control point (_ctrl), then auto-deactivates
      if(e.key==='a'||e.key==='A'){
        const condId = activeCondIdRef.current;
        const cond = itemsRef.current.find(i=>String(i.id)===String(condId));
        if(cond && (cond.measurement_type==='linear'||cond.measurement_type==='area')){
          // Only allow arc if we have at least 1 point (need a start point for the curve)
          if(activePtsRef.current.length >= 1){
            setArcPending(true);
          }
        }
      }

      // Ctrl+Z — undo
      if((e.ctrlKey||e.metaKey)&&(e.key==='z'||e.key==='Z')&&!e.shiftKey){
        e.preventDefault(); undo(); return;
      }
      // Ctrl+Y or Ctrl+Shift+Z — redo
      if((e.ctrlKey||e.metaKey)&&((e.key==='y'||e.key==='Y')||((e.key==='z'||e.key==='Z')&&e.shiftKey))){
        e.preventDefault(); redo(); return;
      }

      // Delete / Backspace — remove last point if drawing, or delete selected shapes
      if(e.key==='Delete'||e.key==='Backspace'){
        // If actively drawing points, remove the last one
        if(activePtsRef.current.length > 0){
          e.preventDefault(); e.stopPropagation();
          // If removing a _through point, deactivate arc mode
          if(activePtsRef.current[activePtsRef.current.length-1]?._through) setArcPending(false);
          setActivePts(prev => prev.slice(0, -1));
          return;
        }
        if(!selectedShapesRef.current.size) return;
        e.preventDefault(); e.stopPropagation();
        if(e.repeat) return;
        if(deleteShapesRef.current) deleteShapesRef.current();
      }

      // Ctrl+C — copy selected shapes
      if((e.ctrlKey||e.metaKey)&&(e.key==='c'||e.key==='C')){
        if(copyShapesRef.current) copyShapesRef.current();
      }

      // Ctrl+V — paste shape-level clipboard with offset
      if((e.ctrlKey||e.metaKey)&&(e.key==='v'||e.key==='V')){
        const src = clipboardRef.current;
        if(!src.length) return;
        pushUndo();
        pasteOffsetRef.current = (pasteOffsetRef.current || 0) + 40;
        const OFF = pasteOffsetRef.current;
        const shift = (sh) => sh.map(p=>({...p, x:p.x+OFF, y:p.y+OFF}));
        // Append pasted shapes to the SAME item they were copied from
        const newSelKeys = [];
        src.forEach(({item, shapes})=>{
          const existing = itemsRef.current.find(i=>String(i.id)===String(item.id));
          if(!existing) return;
          const existingShapes = normalizeShapes(existing.points);
          const shiftedShapes = shapes.map(shift);
          const newPoints = [...existingShapes, ...shiftedShapes];
          // Recompute quantity
          const mt = existing.measurement_type;
          let qty = 0;
          if(mt==='area') qty = newPoints.reduce((s,sh)=>s+calcShapeNetArea(sh),0);
          else if(mt==='linear'){ qty = newPoints.reduce((s,sh)=>{let t=0;for(let i=1;i<sh.length;i++)t+=calcLinear(sh[i-1],sh[i]);return s+t;},0); }
          else if(mt==='count') qty = newPoints.length;
          qty = Math.round(qty*10)/10;
          const total_cost = computeTotalCost(existing, qty);
          setItems(prev=>prev.map(i=>String(i.id)===String(item.id)?{...i,points:newPoints,quantity:qty,total_cost}:i));
          supabase.from('takeoff_items').update({points:newPoints,quantity:qty,total_cost}).eq('id',item.id);
          // Select the newly pasted shapes
          shiftedShapes.forEach((_,si)=>newSelKeys.push(`${item.id}::${existingShapes.length+si}`));
        });
        if(newSelKeys.length) setSelectedShapes(new Set(newSelKeys));
      }
    };
    const handleKeyUp=(e)=>{ if(e.key===' ') setSpaceHeld(false); };
    window.addEventListener('keydown',handleKey, true); // capture phase — nothing can intercept
    window.addEventListener('keyup',handleKeyUp);
    return ()=>{ window.removeEventListener('keydown',handleKey, true); window.removeEventListener('keyup',handleKeyUp); };
  },[]);

  // Container callback ref — attaches wheel + pan handlers
  const containerCallbackRef = (el) => {
    if(containerRef.current){
      containerRef.current.removeEventListener('wheel', containerRef._wheelHandler);
    }
    if(el){
      // Wheel zoom toward cursor
      const wheelHandler = (e)=>{
        // Don't hijack scroll when showing overview grid
        if(!selPlanRef.current) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.05 : 0.95;
        const rect = el.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const contentX = el.scrollLeft + mouseX;
        const contentY = el.scrollTop + mouseY;
        setZoom(prev => {
          const newZoom = Math.min(4, Math.max(0.05, parseFloat((prev*factor).toFixed(2))));
          requestAnimationFrame(()=>{
            el.scrollLeft = contentX*(newZoom/prev) - mouseX;
            el.scrollTop  = contentY*(newZoom/prev) - mouseY;
          });
          return newZoom;
        });
      };
      el.addEventListener('wheel', wheelHandler, {passive:false});
      containerRef.current = el;
      containerRef._wheelHandler = wheelHandler;
    }
  };

  // Compute isPdf synchronously from file_type (blob URLs don't reveal type)
  const isPdfPlan = !!(selPlan && (
    selPlan.file_type?.includes('pdf')
    || selPlan.file_url?.startsWith('data:application/pdf')
  ));

  // Cache natural dimensions so auto-fit doesn't re-trigger on revisit
  const dimCacheRef = useRef({});
  const prevBlobUrlRef = useRef(null);

  useEffect(()=>{
    if(!selPlan) return;
    if(selPlan.scale_px_per_ft){ setScale(selPlan.scale_px_per_ft); }
    else { setScale(null); setPresetScale(''); }
    setActiveCondId(null); setTool('select'); setActivePts([]);
    pdfDocRef.current = null;
    setPdfDoc(null);
    setPlanErr(null);

    // Use public URL directly — no SDK download needed, browser caches it
    const url = selPlan.file_url;
    if(!url) return;

    // Restore cached dimensions if we've seen this plan before
    const cached = dimCacheRef.current[url];
    if(cached){
      setImgNat(cached);
    } else {
      setImgNat({w:1,h:1});
    }
    setBlobUrl(url);
  },[selPlan?.id, selPlan?.file_url]);

  useEffect(()=>{
    if(!blobUrl || !selPlan) return;
    if(selPlan.file_type?.includes('pdf') || selPlan.file_url?.startsWith('data:application/pdf')){
      loadPdf(blobUrl);
    }
  },[blobUrl]);

  // Catch images that loaded before React attached onLoad (blob URLs can decode instantly)
  useEffect(()=>{
    if(!blobUrl || isPdfPlan) return;
    const raf = requestAnimationFrame(()=>{
      const img = imgRef.current;
      if(img && img.complete && img.naturalWidth > 0){
        handleImgLoad();
      }
    });
    return ()=>cancelAnimationFrame(raf);
  },[blobUrl]);

  const getUnitCosts = () => { try{ return {...UNIT_COSTS_DEFAULT,...JSON.parse(localStorage.getItem('unitCosts')||'{}')}; }catch{return UNIT_COSTS_DEFAULT;} };

  const autoDetectScale = async () => {
    if(!selPlan) return;
    setAnalyzing(true);
    let b64=planB64; let mime=planMime;
    if(!b64){
      try{
        const res=await fetch(selPlan.file_url);
        const blob=await res.blob(); mime=blob.type||'image/png';
        b64=await new Promise(resolve=>{const r=new FileReader();r.onload=e=>resolve(e.target.result.split(',')[1]);r.readAsDataURL(blob);});
      }catch(e){setAnalyzing(false);alert('Could not load plan');return;}
    }
    const isImg=mime.startsWith('image/');
    const block=isImg?{type:'image',source:{type:'base64',media_type:mime,data:b64}}:{type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}};
    try{
      const res=await fetch('/api/claude',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:AI_MODEL,max_tokens:256,
          messages:[{role:'user',content:[block,{type:'text',text:'Look at this construction drawing. Find the scale bar or scale notation in the title block or anywhere on the drawing. Return ONLY a JSON object like: {"scale":"1\"=20ft","found":true} or {"found":false} if you cannot find one. No other text.'}]}]})});
      const json=await res.json();
      const text=json?.content?.find(b=>b.type==='text')?.text||'';
      const parsed=JSON.parse(text.replace(/```json|```/g,'').trim());
      if(parsed.found&&parsed.scale){
        const match=CONSTRUCTION_SCALES.find(s=>s.label===parsed.scale||s.label.replace('ft',"'")===parsed.scale);
        if(match){
          const pxPerFt=(planDpi*12)/match.ratio;
          setScale(pxPerFt); setPresetScale(match.label);
          if(selPlan?.id&&selPlan.id!=='preview') await supabase.from('precon_plans').update({scale_px_per_ft:pxPerFt}).eq('id',selPlan.id);
          alert('✓ Scale detected: '+match.label);
        } else {
          alert('Detected scale "'+parsed.scale+'" — select it manually from the dropdown.');
        }
      } else { alert('Could not auto-detect scale. Please set manually.'); }
    }catch(e){ alert('Auto-detect failed: '+e.message); }
    setAnalyzing(false);
  };

  const saveItem = async (itemData) => {
    const catDef = TAKEOFF_CATS.find(c=>c.id===itemData.category)||TAKEOFF_CATS[TAKEOFF_CATS.length-1];
    const costs = getUnitCosts();
    // Try regional pricing first, fall back to local costs
    let uc = itemData.unit_cost;
    if(uc == null && regionalData){
      uc = getDefaultCostForCategory(itemData.category, projectRegion, regionalData.pricing, regionalData.multipliers);
    }
    if(uc == null) uc = (costs[itemData.category]?.mat||0)+(costs[itemData.category]?.lab||0);
    const total_cost = (itemData.quantity||0)*(itemData.multiplier||1)*uc;
    const pid = project.id;
    const payload = {...itemData, project_id:pid, plan_id:selPlan?.id, unit_cost:uc, total_cost, color:catDef.color, ai_generated:false, sort_order:items.length};
    const {data, error} = await supabase.from('takeoff_items').insert([payload]).select().single();
    if(error) console.error('[saveItem] insert error:', error);
    if(data){
      setItems(prev=>[...prev,data]);
      // Auto-expand in sidebar for quick rename/recategorize — no floating modal
      setEditItem(data);
      setRightTab('items');
    }
  };

  // appendMeasurement: add a drawn shape to the active condition.
  // points stored as array-of-shapes: [ [{x,y},...], [{x,y},...] ]
  // qty = sum of all shapes (area, linear, perimeter) or count of shapes (count)
  const appendMeasurement = async (condId, newShape) => {
    if(!scale){ console.warn('appendMeasurement: no scale set'); return; }
    pushUndo();
    let item = itemsRef.current.find(i=>String(i.id)===String(condId));
    if(!item){ console.warn('appendMeasurement: item not found', condId); return; }

    // ── Cross-plan drawing: shapes accumulate on the original item.
    //    Tag each shape with _planId so we know which sheet it came from. ──
    // Tag shape with plan ID so we know which sheet it came from
    if(selPlan?.id && newShape.length > 0) {
      newShape[0] = { ...newShape[0], _planId: selPlan.id };
    }
    // Detect legacy flat points and upgrade
    const existing = item.points;
    let shapes = [];
    if(!existing || existing.length===0) {
      shapes = [];
    } else if(Array.isArray(existing[0]) || (existing[0] && typeof existing[0].x === 'undefined')) {
      shapes = existing; // already array-of-shapes
    } else {
      shapes = [existing]; // legacy flat → wrap
    }
    shapes = [...shapes, newShape];

    // Recompute total quantity
    let qty = 0;
    if(item.measurement_type==='area'){
      qty = shapes.reduce((s,sh)=> s + calcShapeNetArea(sh), 0);
      qty = Math.round(qty*10)/10;
    } else if(item.measurement_type==='linear'){
      qty = shapes.reduce((s,sh)=>{
        const hasArcs = sh.some(p=>p._ctrl);
        if(hasArcs) {
          const pxLen = calcShapeLength(sh);
          return s + (scale ? pxLen/scale : 0);
        }
        // polyline: sum all segments
        let seg=0;
        for(let i=1;i<sh.length;i++) seg+=calcLinear(sh[i-1],sh[i]);
        return s+seg;
      },0);
      // Store raw LF — height conversion happens at display time
      qty = Math.round(qty*10)/10;
    } else if(item.measurement_type==='count'){
      qty = shapes.length;
    }

    const total_cost = computeTotalCost(item, qty);
    const updated = {...item, points:shapes, quantity:qty, total_cost};
    const {error:updErr} = await supabase.from('takeoff_items').update({points:shapes, quantity:qty, total_cost}).eq('id', item.id);
    if(updErr) console.error('[appendMeasurement] update error:', updErr);
    setItems(prev=>prev.map(i=>String(i.id)===String(item.id) ? updated : i));
    // Keep tool armed — stay ready for more shapes
  };

  // commitCurrentPtsRef — callable from keydown without stale closure
  commitCurrentPtsRef.current = () => {
    const pts = activePtsRef.current;
    const condId = activeCondIdRef.current;
    if(pts.length >= 2 && condId){
      appendMeasurement(condId, pts);
      setActivePts([]);
      return pts[pts.length-1];
    }
    return pts.length ? pts[pts.length-1] : null;
  };

  // appendMeasurementHole: embed a cutout into the target shape using _holeStart markers
  const appendMeasurementHole = async (condId, holePts) => {
    pushUndo();
    const item = itemsRef.current.find(i=>String(i.id)===String(condId));
    if(!item||item.measurement_type!=='area') return;
    const shapes = normalizeShapes(item.points);
    if(!shapes.length){ console.warn('cutout: no shapes to cut from'); return; }

    // Clean hole points
    const cleanHole = holePts.map(p=>{const {_hole, ...rest}=p; return rest;}).filter(p=>!p._holeStart);

    // Find which shape the hole centroid falls inside
    const holeCentroid = {
      x: cleanHole.reduce((s,p)=>s+p.x,0)/cleanHole.length,
      y: cleanHole.reduce((s,p)=>s+p.y,0)/cleanHole.length,
    };
    let targetIdx = -1;
    for(let si=0; si<shapes.length; si++){
      const {outer} = splitShapeHoles(shapes[si]);
      const realOuter = outer.filter(p=>!p._ctrl);
      if(realOuter.length>=3 && pointInPoly(holeCentroid, realOuter)){
        targetIdx = si; break;
      }
    }
    if(targetIdx<0) targetIdx = shapes.findIndex(sh=>splitShapeHoles(sh).outer.length>=3);
    if(targetIdx<0){ console.warn('cutout: no valid shape found'); return; }

    // Embed hole into the target shape
    const newShapes = shapes.map((sh, si)=>{
      if(si !== targetIdx) return sh;
      return [...sh, {_holeStart:true, x:0, y:0}, ...cleanHole];
    });

    // Recompute area
    const qty = Math.round(newShapes.reduce((s,sh) => s + calcShapeNetArea(sh), 0)*10)/10;
    const total_cost = computeTotalCost(item, Math.max(0, qty));
    const updated = {...item, points:newShapes, quantity:Math.max(0,qty), total_cost};
    await supabase.from('takeoff_items').update({points:newShapes, quantity:Math.max(0,qty), total_cost}).eq('id', condId);
    setItems(prev=>prev.map(i=>String(i.id)===String(condId)?updated:i));
  };

  // processClick: single-click adds a point
  // Applies angle snap when enabled. Handles arc-pending 3-click flow, cutout, area, linear.
  const processClick=(rawPt)=>{
    if(!activeCondId) return;
    const activeCond = itemsRef.current.find(i=>String(i.id)===String(activeCondId));
    if(!activeCond) return;
    const mt = activeCond.measurement_type;

    // Snap to angle from last placed point
    const lastPlaced = activePtsRef.current.length ? activePtsRef.current[activePtsRef.current.length-1] : null;
    const pt = snapToAngle(lastPlaced, rawPt);

    // ── Arc-pending mode (A key): insert control point then endpoint ───────
    // Works for both linear and area. Two clicks after pressing A:
    //   Click 1: control point (peak of curve, stored with _ctrl:true)
    //   Click 2: endpoint of curve (normal point, arc auto-deactivates)
    if(arcPending){
      const lastPt = activePtsRef.current[activePtsRef.current.length-1];
      const hasThroughPending = lastPt?._through;
      if(!hasThroughPending){
        // First arc click: store the THROUGH point (where user wants the curve to pass)
        setActivePts(prev=>[...prev, {...pt, _through:true}]);
      } else {
        // Second arc click: endpoint. Compute real bezier control point from through-point.
        const startPt = activePtsRef.current[activePtsRef.current.length-2]; // point before through
        const throughPt = lastPt; // the through point
        const endPt = pt;
        const ctrl = {
          x: 2 * throughPt.x - 0.5 * startPt.x - 0.5 * endPt.x,
          y: 2 * throughPt.y - 0.5 * startPt.y - 0.5 * endPt.y,
          _ctrl: true,
        };
        // Replace the _through point with the computed _ctrl, then add endpoint
        setActivePts(prev => [...prev.slice(0, -1), ctrl, endPt]);
        setArcPending(false);
      }
      return;
    }

    // ── Cutout mode: draw hole polygon for area item ───────────────────────
    if(tool==='cutout' && mt==='area'){
      setActivePts(prev=>[...prev, pt]);
      return;
    }

    // ── Normal straight-line clicks ──
    if(mt==='linear' || mt==='area'){
      setActivePts(prev=>[...prev, pt]);
    }
  };

  // finishShape: double-click saves whatever is drawn
  // extraPt = the double-click position that never made it into activePts due to debounce cancellation
  const finishShape=(extraPt=null)=>{
    if(!activeCondId) return;
    const activeCond = itemsRef.current.find(i=>String(i.id)===String(activeCondId));
    if(!activeCond) return;
    const mt = activeCond.measurement_type;
    const rawPts = extraPt ? [...activePts, extraPt] : activePts;
    const lastPlaced = rawPts.length ? rawPts[rawPts.length-2]||null : null;
    const pts = extraPt ? [...activePts, snapToAngle(lastPlaced, extraPt)] : activePts;

    // Cutout finish — save as hole shape (first point flagged _hole:true)
    if(tool==='cutout' && mt==='area' && pts.filter(p=>!p._ctrl).length>=3){
      appendMeasurementHole(activeCondId, pts);
      setActivePts([]); return;
    }
    if(mt==='linear' && pts.length>=2){
      appendMeasurement(activeCondId, pts);
      setActivePts([]);
    } else if(mt==='area' && pts.filter(p=>!p._ctrl).length>=3){
      appendMeasurement(activeCondId, pts);
      setActivePts([]); setArchCtrlPending(false);
    }
  };

  const handleSvgClick=(e)=>{
    if(!selPlan) return;
    if(e.button===2) return;
    // ── Markup: Legend — click to place ──
    if(markupMode==='legend'){
      const pos = getSvgPos(e);
      const legendItems = items.filter(i=>i.plan_id===selPlan.id && i.points?.length).map(i=>({
        color: i.color || '#999',
        name: i.description || 'Unnamed',
        qty: i.quantity || 0,
        unit: i.unit || '',
        type: i.measurement_type,
      }));
      if(!legendItems.length){ alert('No takeoffs on this plan to show in legend.'); return; }
      setMarkups(prev=>[...prev, {id:Date.now(), type:'legend', planId:selPlan.id, pos, items:legendItems}]);
      setMarkupMode(null);
      return;
    }
    // ── Markup: Dimension Line — two clicks ──
    if(markupMode==='dimension'){
      const pos = getSvgPos(e);
      if(!activeMarkup){
        // First click — start point
        setActiveMarkup({type:'dimension', p1:pos, p2:null});
      } else if(activeMarkup.type==='dimension' && activeMarkup.p1){
        // Second click — finish
        const p1 = activeMarkup.p1;
        const p2 = pos;
        const dist = scale ? Math.sqrt((p2.x-p1.x)**2+(p2.y-p1.y)**2)/scale : Math.sqrt((p2.x-p1.x)**2+(p2.y-p1.y)**2);
        const unit = scale ? 'ft' : 'px';
        const label = scale ? `${Math.round(dist*100)/100} ${unit}` : `${Math.round(dist)} ${unit}`;
        setMarkups(prev=>[...prev, {id:Date.now(), type:'dimension', planId:selPlan.id, p1, p2, label, color:markupColor}]);
        setActiveMarkup(null);
      }
      return;
    }
    // Eraser click — delete the hovered shape, full item, or markup
    if(tool==='eraser'){
      if(eraserHover?.markupId){
        setMarkups(prev=>prev.filter(m=>m.id!==eraserHover.markupId));
        setEraserHover(null);
        return;
      }
      if(eraserHover){
        pushUndo();
        const {itemId,shapeIdx} = eraserHover;
        const item = itemsRef.current.find(i=>i.id===itemId);
        if(!item) return;
        const shapes = Array.isArray(item.points[0]) ? item.points : [item.points];
        if(shapes.length<=1){
          // Delete the whole item
          setItems(prev=>prev.filter(i=>i.id!==itemId));
          supabase.from('takeoff_items').delete().eq('id',itemId).select().then(({data:del,error})=>{ if(error) console.error('eraser del',error); else if(!del||del.length===0) console.warn('eraser: RLS blocked delete for',itemId); });
        } else {
          // Remove just this shape
          const newShapes=shapes.filter((_,i)=>i!==shapeIdx);
          // Recompute qty
          const mt=item.measurement_type;
          let qty=0;
          if(mt==='area') qty=newShapes.reduce((s,sh)=>s+calcShapeNetArea(sh),0);
          else if(mt==='linear'){ qty=newShapes.reduce((s,sh)=>{let t=0;for(let i=1;i<sh.length;i++)t+=calcLinear(sh[i-1],sh[i]);return s+t;},0); }
          else if(mt==='count') qty=newShapes.length;
          qty=Math.round(qty*10)/10;
          const total_cost=computeTotalCost(item, qty);
          setItems(prev=>prev.map(i=>i.id===itemId?{...i,points:newShapes,quantity:qty,total_cost}:i));
          supabase.from('takeoff_items').update({points:newShapes,quantity:qty,total_cost}).eq('id',itemId).then(({error})=>{ if(error) console.error('eraser upd',error); });
        }
        setEraserHover(null);
      }
      return;
    }
    if(spaceHeld) return;
    if(tool==='select'){
      // Suppress click fired immediately after a lasso drag-release
      if(suppressNextClickRef.current){ suppressNextClickRef.current=false; return; }
      // Plain click on empty canvas clears selection
      setSelectedShapes(new Set());
      return;
    }
    const pt=getSvgPos(e);
    // Scale calibration — no debounce
    if(tool==='scale'&&scaleStep==='picking'){
      const npts=[...scalePts,pt];
      setScalePts(npts);
      if(npts.length===2) setScaleStep('entering');
      return;
    }
    if(!activeCondId) return;
    const activeCond = itemsRef.current.find(i=>String(i.id)===String(activeCondId));
    if(!activeCond) return;
    // Count is instant, no debounce needed
    if(activeCond.measurement_type==='count'){
      appendMeasurement(activeCondId, [pt]); return;
    }
    // Debounce: 220ms — if dblclick fires, cancel pending single
    if(clickTimerRef.current) clearTimeout(clickTimerRef.current);
    pendingClickRef.current = pt;
    clickTimerRef.current = setTimeout(()=>{
      if(pendingClickRef.current){ processClick(pendingClickRef.current); pendingClickRef.current=null; }
      clickTimerRef.current=null;
    }, 220);
  };

  const handleSvgDoubleClick=(e)=>{
    if(!selPlan||spaceHeld||tool==='select') return;
    if(clickTimerRef.current){ clearTimeout(clickTimerRef.current); clickTimerRef.current=null; }
    const lastPt = pendingClickRef.current; // grab before clearing
    pendingClickRef.current=null;
    finishShape(lastPt); // include the final point that debounce cancelled
  };

  const handleSvgContextMenu=(e)=>{
    e.preventDefault();
    // Delete vertex on right-click
    const vtxEl = e.target.closest && e.target.closest('[data-vertex]');
    if(vtxEl){
      const iid = vtxEl.dataset.itemId;
      const si = Number(vtxEl.dataset.shapeIdx);
      const vi = Number(vtxEl.dataset.vertexIdx);
      const item = itemsRef.current.find(i=>String(i.id)===String(iid));
      if(!item) return;
      pushUndo();
      const shapes = normalizeShapes(item.points);
      const sh = shapes[si];
      if(!sh) return;
      const realCount = sh.filter(p=>!p._ctrl&&!p._holeStart).length;
      const minPts = item.measurement_type==='area' ? 3 : 2;
      if(realCount <= minPts){
        // Delete entire shape
        const newShapes = shapes.filter((_,i)=>i!==si);
        if(newShapes.length===0){
          setItems(prev=>prev.filter(i=>String(i.id)!==String(iid)));
          supabase.from('takeoff_items').delete().eq('id',iid);
        } else {
          const mt=item.measurement_type; let qty=0;
          if(mt==='area') qty=newShapes.reduce((s,s2)=>s+calcShapeNetArea(s2),0);
          else if(mt==='linear'){ qty=newShapes.reduce((s,s2)=>{let t=0;for(let i=1;i<s2.length;i++)t+=calcLinear(s2[i-1],s2[i]);return s+t;},0); }
          else if(mt==='count') qty=newShapes.length;
          qty=Math.round(qty*10)/10;
          const total_cost=computeTotalCost(item, qty);
          setItems(prev=>prev.map(i=>String(i.id)===String(iid)?{...i,points:newShapes,quantity:qty,total_cost}:i));
          supabase.from('takeoff_items').update({points:newShapes,quantity:qty,total_cost}).eq('id',iid);
        }
      } else {
        // Remove just this vertex
        const newSh = sh.filter((_,i)=>i!==vi);
        const newShapes = shapes.map((s,i)=>i===si?newSh:s);
        const mt=item.measurement_type; let qty=0;
        if(mt==='area') qty=newShapes.reduce((s,s2)=>s+calcShapeNetArea(s2),0);
        else if(mt==='linear'){ qty=newShapes.reduce((s,s2)=>{let t=0;for(let i=1;i<s2.length;i++)t+=calcLinear(s2[i-1],s2[i]);return s+t;},0); }
        else if(mt==='count') qty=newShapes.length;
        qty=Math.round(qty*10)/10;
        const total_cost=computeTotalCost(item, qty);
        setItems(prev=>prev.map(i=>String(i.id)===String(iid)?{...i,points:newShapes,quantity:qty,total_cost}:i));
        supabase.from('takeoff_items').update({points:newShapes,quantity:qty,total_cost}).eq('id',iid);
      }
      setSelectedShapes(new Set());
    }
  };

  const handleSvgRightPan=(e)=>{
    if(e.button!==2) return;
    e.preventDefault();
    const c=containerRef.current; if(!c) return;
    const sx=e.clientX, sy=e.clientY, scrollX=c.scrollLeft, scrollY=c.scrollTop;
    const onMove=(ev)=>{ c.scrollLeft=scrollX-(ev.clientX-sx); c.scrollTop=scrollY-(ev.clientY-sy); };
    const onUp=()=>{ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
  };

  const handleSvgMove=(e)=>{
    if(panRef.current.active){ // dragging — update scroll
      const c=containerRef.current;
      if(c){
        c.scrollLeft = panRef.current.scrollX - (e.clientX - panRef.current.startX);
        c.scrollTop  = panRef.current.scrollY - (e.clientY - panRef.current.startY);
      }
      return;
    }
    const rawPt = getSvgPos(e);
    // ── Markup drag in progress ──
    if(markupDragRef.current){
      const md = markupDragRef.current;
      const dx = rawPt.x - md.startMouse.x;
      const dy = rawPt.y - md.startMouse.y;
      if(md.resize){
        // Resize: adjust scale
        const dist = Math.sqrt(dx*dx+dy*dy);
        const sign = (dx+dy)>0?1:-1;
        const newScale = Math.max(0.4, Math.min(3, md.startScale + sign*dist*0.002));
        setMarkups(prev=>prev.map(m=>m.id===md.id?{...m,scale:newScale}:m));
      } else {
        // Move
        setMarkups(prev=>prev.map(m=>{
          if(m.id!==md.id) return m;
          if(m.type==='legend') return {...m, pos:{x:md.startPos.x+dx, y:md.startPos.y+dy}};
          if(m.type==='dimension') return {...m, p1:{x:md.startP1.x+dx,y:md.startP1.y+dy}, p2:{x:md.startP2.x+dx,y:md.startP2.y+dy}};
          return m;
        }));
      }
      return;
    }
    // Apply snap to the hover cursor position for preview
    const lastPlaced = activePtsRef.current.length ? activePtsRef.current[activePtsRef.current.length-1] : null;
    const snapped = snapToAngle(lastPlaced, rawPt);
    setHoverPt(snapped);
    // Eraser: track which shape is under cursor
    if(tool==='eraser'){
      // Find closest item shape to cursor (crude hit-test: bounding box)
      let found=null;
      const threshold = 12/zoom;
      for(const it of itemsRef.current.filter(i=>i.plan_id===selPlanRef.current?.id&&i.points?.length)){
        const shapes = (Array.isArray(it.points[0]) ? it.points : [it.points]);
        shapes.forEach((sh,si)=>{
          if(it.measurement_type==='count'&&sh[0]){
            const d=Math.hypot(sh[0].x-rawPt.x,sh[0].y-rawPt.y);
            if(d<threshold*3) found={itemId:it.id,shapeIdx:si};
          } else {
            const realPts=sh.filter(p=>!p._ctrl&&!p._hole&&!p._holeStart);
            for(let pi=1;pi<realPts.length;pi++){
              const a=realPts[pi-1],b=realPts[pi];
              // Point-to-segment distance
              const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
              const t=len2===0?0:Math.max(0,Math.min(1,((rawPt.x-a.x)*dx+(rawPt.y-a.y)*dy)/len2));
              const px=a.x+t*dx,py=a.y+t*dy;
              const d=Math.hypot(rawPt.x-px,rawPt.y-py);
              if(d<threshold) found={itemId:it.id,shapeIdx:si};
            }
          }
        });
      }
      // Also check markup dimension lines and legends
      if(!found){
        const mThreshold = 12/zoom;
        for(const m of markups){
          if(m.planId!==selPlanRef.current?.id) continue;
          if(m.type==='dimension'){
            const a=m.p1, b=m.p2;
            const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
            const tt=len2===0?0:Math.max(0,Math.min(1,((rawPt.x-a.x)*dx+(rawPt.y-a.y)*dy)/len2));
            const px=a.x+tt*dx,py=a.y+tt*dy;
            const d=Math.hypot(rawPt.x-px,rawPt.y-py);
            if(d<mThreshold){ found={markupId:m.id}; break; }
          }
          if(m.type==='legend'){
            const w=200/zoom, h=(11/zoom)*1.8+(8/zoom)*2+(m.items.length*(11/zoom)*1.6);
            if(rawPt.x>=m.pos.x && rawPt.x<=m.pos.x+w && rawPt.y>=m.pos.y && rawPt.y<=m.pos.y+h){
              found={markupId:m.id}; break;
            }
          }
        }
      }
      setEraserHover(found);
    } else {
      setEraserHover(null);
    }
  };

  const handleSvgMouseDown=(e)=>{
    // Middle-click or space+left = always pan
    const forceP = e.button===1 || panRef.current._spaceHeld;
    // Select tool + left-click without space = lasso box
    const doLasso = !forceP && e.button===0 && tool==='select';
    // Drawing tools + space+left = pan; any other left in drawing mode = ignore (handled by click)
    const doPan = forceP || (!doLasso && (e.button===1 || tool==='select'));

    // ── Midpoint click: insert a new vertex ──
    if(doLasso && e.target.closest && e.target.closest('[data-midpoint]')){
      const mel = e.target.closest('[data-midpoint]');
      const iid = mel.dataset.itemId;
      const si = Number(mel.dataset.shapeIdx);
      const ei = Number(mel.dataset.edgeIdx);
      const item = itemsRef.current.find(i=>String(i.id)===String(iid));
      if(!item) return;
      e.stopPropagation(); e.preventDefault();
      pushUndo();
      const shapes = normalizeShapes(item.points);
      const sh = shapes[si];
      if(!sh) return;
      const a = sh[ei], b = sh[(ei+1)%sh.length];
      if(!a||!b) return;
      const newPt = {x:(a.x+b.x)/2, y:(a.y+b.y)/2};
      const newSh = [...sh.slice(0,ei+1), newPt, ...sh.slice(ei+1)];
      const newShapes = shapes.map((s,i)=>i===si?newSh:s);
      const mt=item.measurement_type; let qty=0;
      if(mt==='area') qty=newShapes.reduce((s,s2)=>s+calcShapeNetArea(s2),0);
      else if(mt==='linear'){ qty=newShapes.reduce((s,s2)=>{let t=0;for(let i=1;i<s2.length;i++)t+=calcLinear(s2[i-1],s2[i]);return s+t;},0); }
      else if(mt==='count') qty=newShapes.length;
      qty=Math.round(qty*10)/10;
      const total_cost=computeTotalCost(item, qty);
      setItems(prev=>prev.map(i=>String(i.id)===String(iid)?{...i,points:newShapes,quantity:qty,total_cost}:i));
      supabase.from('takeoff_items').update({points:newShapes,quantity:qty,total_cost}).eq('id',iid);
      return;
    }

    // ── Vertex drag: mousedown on a vertex handle ──
    if(doLasso && e.target.closest && e.target.closest('[data-vertex]')){
      const vel = e.target.closest('[data-vertex]');
      const iid = vel.dataset.itemId;
      const si = Number(vel.dataset.shapeIdx);
      const vi = Number(vel.dataset.vertexIdx);
      const item = itemsRef.current.find(i=>String(i.id)===String(iid));
      if(!item) return;
      const shapes = normalizeShapes(item.points);
      const origPt = shapes[si]?.[vi];
      if(!origPt) return;
      e.stopPropagation(); e.preventDefault();
      setVertexDrag({itemId:iid, shapeIdx:si, vertexIdx:vi, point:{x:origPt.x, y:origPt.y}});
      const onMove=(mv)=>{
        const cur = getSvgPos(mv);
        setVertexDrag(prev=>prev?{...prev, point:{x:cur.x, y:cur.y}}:null);
      };
      const onUp=()=>{
        window.removeEventListener('mousemove',onMove);
        window.removeEventListener('mouseup',onUp);
        const vd = vertexDragRef.current;
        if(vd) commitVertexDrag(vd);
        setVertexDrag(null);
        suppressNextClickRef.current = true;
      };
      window.addEventListener('mousemove',onMove);
      window.addEventListener('mouseup',onUp);
      return;
    }

    // ── Shape drag: mousedown on an already-selected shape ──
    if(doLasso && e.target.closest && e.target.closest('[data-shape]')){
      const sel = e.target.closest('[data-shape]');
      const iid = sel.dataset.itemId;
      const si = sel.dataset.shapeIdx;
      if(iid!=null && si!=null){
        const shapeKey = `${iid}::${si}`;
        if(selectedShapesRef.current.has(shapeKey)){
          e.stopPropagation(); e.preventDefault();
          const startPt = getSvgPos(e);
          let moved = false;
          const onMove=(mv)=>{
            const cur = getSvgPos(mv);
            const dx = cur.x - startPt.x;
            const dy = cur.y - startPt.y;
            if(!moved && Math.abs(dx)<4 && Math.abs(dy)<4) return;
            moved = true;
            setDragOffset({dx, dy});
          };
          const onUp=()=>{
            window.removeEventListener('mousemove',onMove);
            window.removeEventListener('mouseup',onUp);
            if(moved){
              commitShapeDrag(dragOffsetRef.current);
              suppressNextClickRef.current = true;
            }
            setDragOffset(null);
          };
          window.addEventListener('mousemove',onMove);
          window.addEventListener('mouseup',onUp);
          return;
        }
      }
      // Shape not selected — let click handler select it (fall through to lasso which returns)
      return;
    }

    if(doLasso){
      e.stopPropagation();
      const startPt = getSvgPos(e);
      lassoStartRef.current = startPt;
      setLassoRect({sx:startPt.x, sy:startPt.y, ex:startPt.x, ey:startPt.y});
      const onMove=(mv)=>{
        const cur = getSvgPos(mv);
        setLassoRect({sx:startPt.x, sy:startPt.y, ex:cur.x, ey:cur.y});
      };
      const onUp=(up)=>{
        window.removeEventListener('mousemove',onMove);
        window.removeEventListener('mouseup',onUp);
        const cur = getSvgPos(up);
        setLassoRect(null);
        lassoStartRef.current = null;
        // Select all items whose centroid falls inside the lasso box
        const minX=Math.min(startPt.x,cur.x), maxX=Math.max(startPt.x,cur.x);
        const minY=Math.min(startPt.y,cur.y), maxY=Math.max(startPt.y,cur.y);
        const moved = Math.abs(cur.x-startPt.x)>4 || Math.abs(cur.y-startPt.y)>4;
        if(moved){
          suppressNextClickRef.current = true; // block the click event that fires right after mouseup
          const hit = new Set();
          itemsRef.current.filter(i=>i.plan_id===selPlanRef.current?.id&&i.points?.length).forEach(it=>{
            const shapes = Array.isArray(it.points[0]) ? it.points : (it.points[0]?.x!=null?[it.points]:it.points);
            shapes.forEach((sh,si)=>{
              const realPts = sh.filter(p=>!p._ctrl&&!p._hole&&!p._holeStart);
              if(!realPts.length) return;
              const cx=realPts.reduce((s,p)=>s+p.x,0)/realPts.length;
              const cy=realPts.reduce((s,p)=>s+p.y,0)/realPts.length;
              if(cx>=minX&&cx<=maxX&&cy>=minY&&cy<=maxY) hit.add(`${it.id}::${si}`);
            });
          });
          if(hit.size>0){
            setSelectedShapes(prev=>{
              if(up.shiftKey){ const n=new Set(prev); hit.forEach(k=>n.add(k)); return n; }
              return hit;
            });
          }
        }
        // If no drag (just a click), clear selection handled by handleSvgClick
      };
      window.addEventListener('mousemove',onMove);
      window.addEventListener('mouseup',onUp);
      return;
    }

    if(!doPan) return;
    if(e.button===1) e.preventDefault();
    e.stopPropagation();
    const c=containerRef.current;
    panRef.current = {...panRef.current, active:true, startX:e.clientX, startY:e.clientY,
      scrollX:c?c.scrollLeft:0, scrollY:c?c.scrollTop:0};
    const onUp=()=>{
      panRef.current.active=false;
      window.removeEventListener('mouseup',onUp);
    };
    window.addEventListener('mouseup',onUp);
  };

  // ── Arch / bezier helpers ─────────────────────────────────────────────
  const bezierLength = (p1, ctrl, p2, steps=40) => {
    let len=0, prev=p1;
    for(let i=1;i<=steps;i++){
      const t=i/steps;
      const x=(1-t)**2*p1.x+2*(1-t)*t*ctrl.x+t**2*p2.x;
      const y=(1-t)**2*p1.y+2*(1-t)*t*ctrl.y+t**2*p2.y;
      len+=Math.sqrt((x-prev.x)**2+(y-prev.y)**2);
      prev={x,y};
    }
    return len;
  };
  const bezierPt = (p1, ctrl, p2, t) => ({
    x:(1-t)**2*p1.x+2*(1-t)*t*ctrl.x+t**2*p2.x,
    y:(1-t)**2*p1.y+2*(1-t)*t*ctrl.y+t**2*p2.y,
  });
  const buildShapePath = (pts, close=false) => {
    if(!pts||!pts.length) return '';
    let d=`M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    let i=1;
    while(i<pts.length){
      if(pts[i]?._ctrl && i+1<pts.length){
        d+=` Q${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)} ${pts[i+1].x.toFixed(2)},${pts[i+1].y.toFixed(2)}`;
        i+=2;
      } else {
        d+=` L${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)}`;
        i++;
      }
    }
    if(close) d+=' Z';
    return d;
  };
  const calcShapeLength = (pts) => {
    if(!pts||pts.length<2) return 0;
    let total=0, i=1;
    while(i<pts.length){
      if(pts[i]?._ctrl && i+1<pts.length){
        total+=bezierLength(pts[i-1]??pts[0], pts[i], pts[i+1]);
        i+=2;
      } else {
        const a=pts[i-1]??pts[0], b=pts[i];
        total+=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2);
        i++;
      }
    }
    return total;
  };
  const calcShapeArea = (expandedPts) => {
    // Expand arc segments for shoelace
    const expanded=[];
    let i=0;
    while(i<expandedPts.length){
      if(expandedPts[i+1]?._ctrl && i+2<expandedPts.length){
        for(let s=0;s<=20;s++) expanded.push(bezierPt(expandedPts[i],expandedPts[i+1],expandedPts[i+2],s/20));
        i+=3;
      } else { expanded.push(expandedPts[i]); i++; }
    }
    return calcArea(expanded);
  };

  const confirmScale=async()=>{
    if(!scaleDist||scalePts.length<2) return;
    const p1=scalePts[0]; const p2=scalePts[1]; // raw pixel coords
    const pxDist=Math.sqrt((p2.x-p1.x)**2+(p2.y-p1.y)**2);
    const realFt=Number(scaleDist)*(scaleUnit==='in'?1/12:1);
    const pxPerFt=pxDist/realFt;
    setScale(pxPerFt); setPresetScale(''); setScaleStep(null); setScalePts([]); setScaleDist(''); setTool('select');
    if(selPlan){
      await supabase.from('precon_plans').update({scale_px_per_ft:pxPerFt}).eq('id',selPlan.id);
      setSelPlan(prev=>({...prev,scale_px_per_ft:pxPerFt}));
      setPlans(prev=>prev.map(p=>p.id===selPlan.id?{...p,scale_px_per_ft:pxPerFt}:p));
    }
  };

  // Fallback: prettify filename when AI naming fails
  const autoNameSheet = (filename, existingPlans) => {
    let name = filename.replace(/\.[^.]+$/, '');
    name = name.replace(/[-_]/g, ' ').replace(/\s+/g,' ').trim();
    const sheetMatch = name.match(/^([A-Z]{1,2})[-\s]?(\d+\.?\d*)$/i);
    if(sheetMatch) {
      const prefixes = {A:'Architectural',S:'Structural',C:'Civil',M:'Mechanical',E:'Electrical',P:'Plumbing',L:'Landscape',G:'General',FP:'Fire Protection'};
      const prefix = prefixes[sheetMatch[1].toUpperCase()];
      if(prefix) name = `${sheetMatch[1].toUpperCase()}-${sheetMatch[2]} ${prefix}`;
    }
    const base = name;
    let count = 2;
    while(existingPlans.some(p=>p.name===name)) { name = `${base} (${count++})`; }
    return name;
  };

  // AI sheet name extraction — delegates entirely to /api/name-sheet serverless function
  // That function fetches the image server-side (no CORS), sends to Anthropic directly
  // Client never touches the image data — no canvas, no base64 overhead, no Vercel body limit
  // Parse sheet name from extracted PDF text (FREE — no API call)
  // Uses positioned items to only look at the TITLE BLOCK area (bottom-right ~30% of page)
  const parseSheetNameFromText = (rawText, textPositions) => {
    if(!rawText || rawText.length < 10) return null;

    // If we have positioned items, only search the title block region (bottom-right)
    let titleBlockText = rawText;
    if(textPositions && Array.isArray(textPositions) && textPositions.length > 0){
      // Find page extents
      let maxX = 0, maxY = 0;
      for(const item of textPositions){ maxX = Math.max(maxX, item.x+item.w); maxY = Math.max(maxY, item.y+item.h); }
      // Title block = bottom 35% height, right 55% width
      const minX = maxX * 0.45, minY = maxY * 0.65;
      const tbItems = textPositions.filter(item => item.x >= minX && item.y >= minY);
      if(tbItems.length > 0){
        titleBlockText = tbItems.map(i => i.str).join(' ');
      }
    }

    // Strategy: find ALL sheet-number-like patterns, then pick the best one
    // Sheet numbers: A1.0, C-3, S1.1, ES1.0, FP1.0, M2.0, etc.
    const sheetNumRe = /\b([A-Z]{1,3}\d{1,2}(?:\.\d{1,2})?)\b/g;
    const titleKeywords = /(?:SITE|FLOOR|FOUNDATION|FRAMING|ROOF|CEILING|MECHANICAL|ELECTRICAL|PLUMBING|STRUCTURAL|GRADING|UTILITY|LANDSCAPE|DEMOLITION|DETAIL|ELEVATION|SECTION|PLAN|LAYOUT|SCHEDULE|DRAINAGE|PAVING|LIGHTING|LIFE SAFETY|FIRE PROTECTION|FIRE|REFLECTED|ENLARGED|PARTIAL|OVERALL|GENERAL|POWER|SYSTEMS|INTERIOR|EXTERIOR|ARCHITECTURAL|CONCRETE|LEGEND|RISER|SPECIFICATION|NOTE|ACCESSIBILITY|VENDOR|CRITERIA|RECEIVING|PET WASH|STANDARD)/i;

    let bestMatch = null;
    let match;
    while((match = sheetNumRe.exec(titleBlockText)) !== null){
      const num = match[1];
      const afterNum = titleBlockText.slice(match.index + num.length, match.index + num.length + 80);
      const titleMatch = afterNum.match(/^\s*[-–—]?\s*([A-Z][A-Z\s&\/,.'()#-]{2,70})/);
      console.log('[parseSheetName] found num:', num, 'afterNum:', afterNum.slice(0,40), 'titleMatch:', titleMatch?.[1]?.slice(0,40));
      if(titleMatch){
        let title = titleMatch[1].trim().replace(/\s+/g, ' ');
        const hasKeyword = titleKeywords.test(title);
        title = title
          .replace(/\s+\d+['"\u2019-].*$/,'')
          .replace(/\s+(This|The|Tel:|Fax:|Project|Job|Date|Revision|SCALE|BY WHO|BOTTOM OF|EXPOSED|ACTUAL|PRE-FINISHED|VENTED|ROOF SLOPE|TOP OF|NOTE:|PRINTING|FOR |HOURS|INCHES|PROVIDE|COLD-FORMED|RIGHT WALL|SECTION \d).*/i, '')
          .replace(/\s+[A-Z]\d+\.\d+.*$/,'')
          .replace(/\s+\d{3,}.*$/,'')
          .replace(/\s+(SQ\.?\s*FT|A\.?F\.?F|TYP|EQUAL|EXIT|PERMANENT|DRESSING|VESTIBULE|CORRIDOR|EMPLOYEE|PEPSI|ELECTRIC RACEWAY|DISPLAY|CABINET|DRYER|TABLE|JOIST|STOREFRONT|HSS|WF BEAM|CMU|MICROPILE).*$/i,'')
          .trim();
        // De-duplicate repeated titles: "GENERAL LIGHTING PLAN GENERAL LIGHTING PLAN" → "GENERAL LIGHTING PLAN"
        const _w = title.split(' ');
        const _h = Math.ceil(_w.length / 2);
        if(_w.length >= 4 && _w.slice(0,_h).join(' ') === _w.slice(_h,_h*2).join(' ')) title = _w.slice(0,_h).join(' ');
        if(title.length > 2 && title.length < 80){
          if(!bestMatch || hasKeyword) bestMatch = { num, title, hasKeyword };
          if(hasKeyword) break;
        }
      } else if(!bestMatch){
        bestMatch = { num, title: null, hasKeyword: false };
      }
    }

    if(bestMatch){
      const { num, title } = bestMatch;
      if(title) return `${num} - ${title}`;
      return num;
    }
    return null;
  };

  const aiNameSheet = async (canvasOrUrl, fallbackName) => {
    try {
      let url;
      if (typeof canvasOrUrl === 'string') {
        url = canvasOrUrl;
      } else {
        // Canvas passed at upload time — convert to small JPEG and use a data URL trick:
        // store on supabase first then we have a real URL... actually just inline base64 via /api/claude
        const MAX = 1200;
        const ratio = Math.min(1, MAX / Math.max(canvasOrUrl.width, canvasOrUrl.height));
        const out = document.createElement('canvas');
        out.width = Math.floor(canvasOrUrl.width * ratio);
        out.height = Math.floor(canvasOrUrl.height * ratio);
        out.getContext('2d').drawImage(canvasOrUrl, 0, 0, out.width, out.height);
        const b64 = out.toDataURL('image/jpeg', 0.88).split(',')[1];
        const resp = await fetch('/api/claude', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ model:AI_MODEL_FAST, max_tokens:60,
            messages:[{role:'user',content:[
              {type:'image',source:{type:'base64',media_type:'image/jpeg',data:b64}},
              {type:'text',text:'Find the title block on this construction drawing (usually bottom-right corner) and extract the sheet number and title.\nReply with ONLY this format: SHEET_NUMBER - SHEET_TITLE\nExamples: C3.01 - SITE PLAN  /  A-101 - FLOOR PLAN  /  M-201 - MECHANICAL PLAN\nIf unreadable reply: UNKNOWN'}
            ]}]})
        });
        const json = await resp.json();
        const raw = (json?.content?.find?.(b=>b.type==='text')?.text||'').trim();
        console.log('[aiNameSheet canvas] raw:', raw);
        if(!raw||raw.toUpperCase().includes('UNKNOWN')||raw.length<3) return fallbackName;
        return raw.replace(/^["'`*\s]+|["'`*\s]+$/g,'').trim();
      }

      // URL path: let the server fetch it
      const resp = await fetch('/api/name-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!resp.ok) { console.error('[aiNameSheet] name-sheet error', resp.status, await resp.text()); return fallbackName; }
      const json = await resp.json();
      console.log('[aiNameSheet] result:', json);
      return json.name || fallbackName;
    } catch (e) {
      console.error('[aiNameSheet] exception:', e);
      return fallbackName;
    }
  };

  const handleUpload=async(file)=>{
    if(!file) return;
    const pid = project.id;
    setUploading('Reading file…');
    const isPdf = file.type?.includes('pdf');
    // Generate a batch ID for this upload — all pages become one folder
    const batchId = `batch_${Date.now()}`;
    const batchName = file.name.replace(/\.[^.]+$/,'').replace(/[-_]/g,' ').trim() || 'Plan Set';

    if(isPdf){
      const arrayBuf = await file.arrayBuffer();
      const lib = await ensurePdfLib();
      if(!lib){ setUploading(false); alert('PDF library not loaded'); return; }
      lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      let doc;
      try { doc = await lib.getDocument({data: arrayBuf.slice(0)}).promise; }
      catch(e){ setUploading(false); alert('Could not read PDF: '+e.message); return; }

      const numPages = doc.numPages;
      const fallbackBase = autoNameSheet(file.name, plans);

      // ── PHASE 1: Render all pages + fire all uploads simultaneously ──
      // Also capture title block crops for AI naming later
      const uploadPromises = [];
      const titleCrops = []; // store b64 crops for naming phase

      for(let pageN=1; pageN<=numPages; pageN++){
        setUploading(`Rendering ${pageN} / ${numPages}…`);
        const page = await doc.getPage(pageN);
        // Extract embedded text + positions (free — no AI needed)
        let pageText = '';
        let ocrItems = []; // [{str, x, y, w, h}] for on-plan highlighting
        try {
          const textContent = await page.getTextContent();
          const vp = page.getViewport({scale:2.0}); // MUST match the render scale used for JPEG
          for(const item of textContent.items){
            if(!item.str || !item.transform) continue;
            if(!item.str.replace(/\s/g,'')) continue; // skip pure whitespace but keep items with spaces
            // Use PDF.js built-in coordinate conversion (handles rotation, skew, etc.)
            const [px, py] = vp.convertToViewportPoint(item.transform[4], item.transform[5]);
            const fontSize = Math.sqrt(item.transform[0]**2 + item.transform[1]**2);
            const heightPx = fontSize * vp.scale;
            const widthPx = item.width ? item.width * vp.scale : heightPx * item.str.length * 0.6;
            ocrItems.push({
              str: item.str.trim(),
              x: Math.round(px),
              y: Math.round(py - heightPx), // PDF y = baseline, move up by height
              w: Math.round(widthPx),
              h: Math.round(heightPx),
            });
          }
          // Also merge adjacent items into combined entries for multi-word search matching
          // Items within ~20px vertically and ~200px horizontally are likely on the same line
          const merged = [];
          const sorted = [...ocrItems].sort((a,b)=>a.y===b.y?a.x-b.x:a.y-b.y);
          let current = null;
          for(const item of sorted){
            if(current && Math.abs(item.y-current.y)<20 && item.x<current.x+current.w+200){
              current.str += ' '+item.str;
              current.w = (item.x+item.w)-current.x;
            } else {
              if(current) merged.push(current);
              current = {...item};
            }
          }
          if(current) merged.push(current);
          ocrItems.push(...merged.filter(m=>m.str.includes(' '))); // add merged multi-word items
          pageText = ocrItems.map(i=>i.str).join(' ').replace(/\s+/g,' ').trim().slice(0,50000);
        } catch(e) { console.error('[OCR] text extraction FAILED p'+pageN, e); }
        const viewport = page.getViewport({scale:2.0});
        const offscreen = document.createElement('canvas');
        offscreen.width = viewport.width; offscreen.height = viewport.height;
        await page.render({canvasContext: offscreen.getContext('2d'), viewport}).promise;
        const blob = await new Promise(r=>offscreen.toBlob(r,'image/jpeg',0.82));

        // Crop bottom-right 50% × 38% for title block
        const cropW = Math.floor(offscreen.width * 0.50);
        const cropH = Math.floor(offscreen.height * 0.38);
        const cropCanvas = document.createElement('canvas');
        const MAX_CROP = 1200;
        const cropScale = Math.min(1, MAX_CROP / cropW);
        cropCanvas.width  = Math.floor(cropW * cropScale);
        cropCanvas.height = Math.floor(cropH * cropScale);
        cropCanvas.getContext('2d').drawImage(
          offscreen,
          offscreen.width - cropW, offscreen.height - cropH, cropW, cropH,
          0, 0, cropCanvas.width, cropCanvas.height
        );
        titleCrops.push(cropCanvas.toDataURL('image/jpeg', 0.90).split(',')[1]);

        const sheetName = numPages>1 ? `${fallbackBase} — Pg ${pageN}` : fallbackBase;
        const path = `precon/${pid}/${Date.now()}_p${pageN}.jpg`;
        const idx = pageN - 1;
        // Capture for closure
        const _pageText = pageText;
        const _ocrItems = ocrItems;
        uploadPromises.push(
          supabase.storage.from('attachments').upload(path, blob, {upsert:true, contentType:'image/jpeg'})
            .then(async ({error}) => {
              if(error){ console.error('upload fail p'+pageN, error); return null; }
              const {data:ud} = supabase.storage.from('attachments').getPublicUrl(path);
              const publicUrl = ud?.publicUrl || '';
              // Insert plan row (without ocr_text to avoid column-missing errors)
              const {data:plan, error:insErr} = await supabase.from('precon_plans')
                .insert([{project_id:pid, name:sheetName, file_url:publicUrl, file_type:'image/jpeg'}])
                .select().single();
              if(insErr){ console.error('[upload] plan insert error:', insErr); return null; }
              if(!plan) return null;
              // Save extracted text separately (best-effort — won't break if column missing)
              // Save text + positions (best-effort)
              const updatePayload = {};
              if(_pageText) updatePayload.ocr_text = _pageText;
              if(_ocrItems.length) updatePayload.text_positions = _ocrItems;
              if(Object.keys(updatePayload).length){
                const {error:txtErr} = await supabase.from('precon_plans').update(updatePayload).eq('id',plan.id);
                if(txtErr) console.warn('[upload] text save skipped:', txtErr.message);
                else console.log('[upload] text saved for', plan.name, '—', _pageText.length, 'chars,', _ocrItems.length, 'positioned items');
              }
              return {...plan, ocr_text:_pageText||null, text_positions:_ocrItems.length?_ocrItems:null, _idx:idx};
            })
        );
      }

      // Wait for all uploads
      setUploading(`Uploading ${numPages} page${numPages!==1?'s':''}…`);
      const settled = await Promise.all(uploadPromises);
      const newPlans = settled.filter(Boolean).sort((a,b)=>a._idx-b._idx).map(({_idx,...p})=>p);

      if(newPlans.length===0){ setUploading(false); return; }

      // ── Show plans immediately with fallback names so user sees them ──
      setPlans(prev=>[...prev, ...newPlans]);
      setSelPlan(newPlans[0]);
      setPlanB64(null); setPlanMime('image/png');
      if(uploadTargetFolder && planSets[uploadTargetFolder]){
        savePlanSets({...planSets, [uploadTargetFolder]:{...planSets[uploadTargetFolder], planIds:[...(planSets[uploadTargetFolder].planIds||[]), ...newPlans.map(p=>p.id)]}});
      } else {
        savePlanSets({...planSets, [batchId]:{name:batchName, planIds:newPlans.map(p=>p.id), collapsed:false}});
      }
      setUploadTargetFolder(null);

      // ── PHASE 2: Name sheets — try FREE text parsing first, AI fallback ──
      let namedFromText = 0, namedFromAI = 0;
      const needsAI = []; // plans that couldn't be named from text

      // First pass: try text parsing (instant, free)
      for(let i=0; i<newPlans.length; i++){
        const p = newPlans[i];
        const textName = parseSheetNameFromText(p.ocr_text||'', p.text_positions);
        if(textName && textName.length > 2){
          await supabase.from('precon_plans').update({name:textName}).eq('id',p.id);
          setPlans(prev=>prev.map(x=>x.id===p.id?{...x,name:textName}:x));
          namedFromText++;
          console.log(`[name pg${i+1}] TEXT: "${textName}"`);
        } else {
          needsAI.push({plan:p, cropIdx:i});
        }
      }

      // Second pass: AI naming only for sheets that failed text parsing
      if(needsAI.length > 0){
        const BATCH = 5;
        for(let i=0; i<needsAI.length; i+=BATCH){
          const slice = needsAI.slice(i, i+BATCH);
          setUploading(`AI naming ${i+1}–${Math.min(i+BATCH, needsAI.length)} of ${needsAI.length} remaining…`);
          await Promise.all(slice.map(async({plan:p, cropIdx})=>{
            const b64 = titleCrops[cropIdx];
            if(!b64) return;
            try {
              const resp = await fetch('/api/claude', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({
                  model:AI_MODEL_FAST, max_tokens:60,
                  messages:[{role:'user', content:[
                    {type:'image', source:{type:'base64', media_type:'image/jpeg', data:b64}},
                    {type:'text', text:'This is the bottom-right corner of a construction drawing showing the title block. Extract the sheet number and sheet title.\nReply with ONLY this format: SHEET_NUMBER - SHEET_TITLE\nExamples:\n  C3.01 - SITE PLAN\n  A-101 - FLOOR PLAN\n  S2.0 - FOUNDATION PLAN\nIf you cannot clearly read a sheet number and title, reply: UNKNOWN'}
                  ]}]
                })
              });
              const j = await resp.json();
              if(!resp.ok) return;
              const raw = (j?.content?.find(b=>b.type==='text')?.text||'').trim();
              if(!raw || raw.toUpperCase().includes('UNKNOWN') || raw.length < 3) return;
              const aiName = raw.replace(/^["'`*\s]+|["'`*\s]+$/g,'').trim();
              if(aiName === p.name) return;
              await supabase.from('precon_plans').update({name:aiName}).eq('id',p.id);
              setPlans(prev=>prev.map(x=>x.id===p.id?{...x,name:aiName}:x));
              namedFromAI++;
              console.log(`[name AI] "${aiName}"`);
            } catch(e){ console.warn('[name AI] error:', e); }
          }));
        }
      }

      setUploading(`✓ Done — ${newPlans.length} sheets, ${namedFromText} named from text, ${namedFromAI} via AI`);
      setTimeout(()=>setUploading(false), 3000);
      return;
    }

    // Image upload (non-PDF)
    const fallbackName = autoNameSheet(file.name, plans);
    const reader=new FileReader();
    reader.onload=async ev=>{
      const dataUrl = ev.target.result;
      setPlanB64(dataUrl.split(',')[1]);
      setPlanMime(file.type);
      const sheetName = fallbackName;
      setSelPlan({id:'preview',name:sheetName,file_url:dataUrl,file_type:file.type});
      const ext=file.name.split('.').pop();
      const path=`precon/${pid}/${Date.now()}.${ext}`;
      const {error}=await supabase.storage.from('attachments').upload(path,file,{upsert:true});
      if(error){setUploading(false);alert('Upload failed: '+error.message);return;}
      const {data:ud}=supabase.storage.from('attachments').getPublicUrl(path);
      const publicUrl = ud?.publicUrl || ud?.data?.publicUrl || '';
      const {data:plan}=await supabase.from('precon_plans').insert([{project_id:pid,name:sheetName,file_url:publicUrl,file_type:file.type}]).select().single();
      if(plan){
        setPlans(prev=>[...prev.filter(p=>p.id!=='preview'),plan]);
        setSelPlan(plan);
        if(uploadTargetFolder && planSets[uploadTargetFolder]){
          const updated = {...planSets, [uploadTargetFolder]:{...planSets[uploadTargetFolder], planIds:[...(planSets[uploadTargetFolder].planIds||[]), plan.id]}};
          savePlanSets(updated);
        } else {
          const updated = {...planSets, [batchId]:{name:sheetName, planIds:[plan.id], collapsed:false}};
          savePlanSets(updated);
        }
        setUploadTargetFolder(null);
        setUploading('✓ Done');
        setTimeout(()=>setUploading(false), 2500);
      } else {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Single-sheet AI analysis (called per sheet)
  const runAISingleSheet = async (plan) => {
    // Try to use credit (skip silently if org tables don't exist yet)
    try {
      const {data:creditResult, error:creditErr} = await supabase.rpc('use_ai_credit', {p_plan_id:plan.id, p_project_id:project.id});
      if(!creditErr && creditResult && !creditResult.error){
        setAiCredits(prev=>({...prev, available:creditResult.available, used:creditResult.used}));
      } else if(creditResult?.error === 'No credits remaining'){
        alert('No AI credits remaining.');
        return null;
      }
    } catch(e){ /* credit system not set up yet — skip */ }

    // Get plan image as base64
    let b64, mime='image/jpeg';
    const usePdf = plan.id===selPlan?.id && isPdfPlan && canvasRef.current;
    if(usePdf){
      const c = canvasRef.current;
      const maxW = 1500, ratio = Math.min(1, maxW / c.width);
      const out = document.createElement('canvas');
      out.width = Math.round(c.width * ratio); out.height = Math.round(c.height * ratio);
      out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
      b64 = out.toDataURL('image/jpeg', 0.7).split(',')[1];
    } else {
      const res = await fetch(plan.file_url);
      const blob = await res.blob();
      const img = new Image();
      const bUrl = URL.createObjectURL(blob);
      await new Promise((r,j)=>{img.onload=r;img.onerror=j;img.src=bUrl;});
      URL.revokeObjectURL(bUrl);
      const maxW = 1500, ratio = Math.min(1, maxW / img.naturalWidth);
      const out = document.createElement('canvas');
      out.width = Math.round(img.naturalWidth * ratio); out.height = Math.round(img.naturalHeight * ratio);
      out.getContext('2d').drawImage(img, 0, 0, out.width, out.height);
      b64 = out.toDataURL('image/jpeg', 0.7).split(',')[1];
    }

    const catIds = TAKEOFF_CATS.map(c=>c.id).join('|');
    const apiRes = await fetch('/api/claude',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:AI_MODEL, max_tokens:2000,
        messages:[{role:'user',content:[
          {type:'image',source:{type:'base64',media_type:'image/jpeg',data:b64}},
          {type:'text',text:`You are a construction estimator analyzing a plan sheet. Identify all concrete, masonry, curb & gutter, sidewalk, asphalt, grading, and countable items. For each item: description (specific, reference plan labels), category (one of: ${catIds}), unit (SF/LF/CY/EA), measurement_type (area/linear/count), estimated_count (countable items only). Return ONLY a JSON array, no markdown.`}
        ]}]
      })
    });
    if(!apiRes.ok) return null;
    const json = await apiRes.json();
    const text = json?.content?.find(b=>b.type==='text')?.text||'';
    try {
      return JSON.parse(text.replace(/```json|```/g,'').trim());
    } catch { return null; }
  };

  const runAITakeoff=async()=>{
    if(!selPlan) return;
    if(!window.confirm(`Analyze this sheet with AI?${aiCredits?.available!=null&&aiCredits.available<999?`\n\nAvailable: ${aiCredits.available} credits`:''}`)) return;

    // Check if items already exist for this plan
    const existingPlanItems = items.filter(i=>i.plan_id===selPlan.id);
    if(existingPlanItems.length > 0){
      if(!window.confirm(`This plan already has ${existingPlanItems.length} items. Add AI items alongside them?`)) return;
    }

    setAnalyzing(true);
    try {
      const aiItems = await runAISingleSheet(selPlan);
      if(!aiItems || !aiItems.length){
        alert('AI did not find any takeoff items on this plan.');
        setAnalyzing(false); return;
      }
      const costs = getUnitCosts();
      const pid = project.id;
      const toInsert = aiItems.map((it, i) => {
        const catDef = TAKEOFF_CATS.find(c=>c.id===it.category) || TAKEOFF_CATS[TAKEOFF_CATS.length-1];
        const uc = (costs[it.category]?.mat||0) + (costs[it.category]?.lab||0) || catDef.defaultCost;
        return {
          project_id:pid, plan_id:selPlan?.id, category:catDef.id, description:it.description,
          quantity:it.measurement_type==='count'?(it.estimated_count||0):0,
          unit:it.unit||catDef.unit, unit_cost:uc,
          total_cost:it.measurement_type==='count'?(it.estimated_count||0)*uc:0,
          measurement_type:it.measurement_type||'manual', points:null,
          color:TO_COLORS[i%TO_COLORS.length], ai_generated:true, sort_order:items.length+i,
        };
      });
      const {data,error} = await supabase.from('takeoff_items').insert(toInsert).select();
      if(error){ alert('Failed to save: '+error.message); }
      else if(data){ setItems(prev=>[...prev,...data]); setLeftTab('takeoffs'); alert(`AI found ${data.length} items — draw measurements to complete.`); }
    } catch(e){ alert('AI failed: '+e.message); }
    setAnalyzing(false);
  };

  const applyAssembly = async (assemblyItems) => {
    const pid = project.id;
    const toInsert = assemblyItems.map((it,i)=>({...it,project_id:pid,plan_id:selPlan?.id,measurement_type:'manual',points:null,color:TAKEOFF_CATS.find(c=>c.id===it.category)?.color||'#555',ai_generated:false,sort_order:items.length+i}));
    const {data}=await supabase.from('takeoff_items').insert(toInsert).select();
    if(data) setItems(prev=>[...prev,...data]);
    setShowAssembly(false);
  };

  const deleteItem = async (id) => {
    const {error}=await supabase.from('takeoff_items').delete().eq('id',id).select();
    if(error){console.error('deleteItem error:',error);alert('Delete failed: '+error.message);return;}
    setItems(prev=>prev.filter(i=>i.id!==id));
  };

  const pushToSOV = async () => {
    const apmId=project.apm_project_id;
    if(!apmId){alert('Link to an APM project first to push SOV.');return;}
    if(!items.length) return;
    const grouped={};
    items.forEach(it=>{ const cat=TAKEOFF_CATS.find(c=>c.id===it.category); const key=cat?.label||it.category; if(!grouped[key])grouped[key]={desc:key,total:0}; grouped[key].total+=(it.total_cost||0); });
    const sovRows=Object.values(grouped).map((g,i)=>({project_id:apmId,item_no:String(i+1),description:g.desc,scheduled_value:Math.round(g.total),sort_order:i}));
    await supabase.from('sov_items').delete().eq('project_id',apmId);
    await supabase.from('sov_items').insert(sovRows);
    alert('✓ SOV updated in APM! Go to the linked project → Pay Apps to review.');
  };

  // Normalize points to array-of-shapes format for rendering.
  // Legacy: [{x,y},...] → wrap in outer array
  // New: [[{x,y},...], ...] — multiple shapes per condition
  const normalizeShapes = (pts) => {
    if(!pts||pts.length===0) return [];
    if(Array.isArray(pts[0])) return pts; // already multi-shape
    if(pts[0] && typeof pts[0].x === 'number') return [pts]; // legacy single
    return pts;
  };

  // Split a single shape's points into outer boundary + embedded holes
  // Holes are separated by {_holeStart:true} marker points
  // Returns {outer: [{x,y},...], holes: [[{x,y},...], ...]}
  const splitShapeHoles = (pts) => {
    if(!pts||!pts.length) return {outer:[], holes:[]};
    const segments = [];
    let cur = [];
    for(const p of pts){
      if(p._holeStart){
        if(cur.length) segments.push(cur);
        cur = [];
      } else {
        cur.push(p);
      }
    }
    if(cur.length) segments.push(cur);
    return { outer: segments[0]||[], holes: segments.slice(1) };
  };

  // Point-in-polygon test (ray casting)
  const pointInPoly = (pt, poly) => {
    let inside = false;
    for(let i=0, j=poly.length-1; i<poly.length; j=i++){
      const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
      if(((yi>pt.y)!==(yj>pt.y)) && (pt.x<(xj-xi)*(pt.y-yi)/(yj-yi)+xi)) inside=!inside;
    }
    return inside;
  };

  // Sutherland-Hodgman polygon clipping — clips subject polygon to clip polygon boundary
  // Returns the intersection polygon (portion of subject inside clip)
  const clipPolygonToOuter = (subject, clip) => {
    if(!subject.length || !clip.length) return [];
    // Detect winding direction of clip polygon using signed area
    // In SVG Y-down: positive = clockwise, negative = counter-clockwise
    let signedArea = 0;
    for(let i=0; i<clip.length; i++){
      const j=(i+1)%clip.length;
      signedArea += clip[i].x*clip[j].y - clip[j].x*clip[i].y;
    }
    // If clockwise (positive in Y-down), inside is RIGHT of edge → cross product is already correct
    // If counter-clockwise (negative), inside is LEFT → flip the test
    const flip = signedArea > 0 ? 1 : -1;

    let output = subject.map(p=>({x:p.x, y:p.y}));
    for(let i=0; i<clip.length; i++){
      if(!output.length) return [];
      const input = [...output];
      output = [];
      const a = clip[i], b = clip[(i+1)%clip.length];
      const inside = (p) => flip * ((b.x-a.x)*(p.y-a.y) - (b.y-a.y)*(p.x-a.x)) >= 0;
      const intersect = (p1, p2) => {
        const x1=p1.x,y1=p1.y,x2=p2.x,y2=p2.y,x3=a.x,y3=a.y,x4=b.x,y4=b.y;
        const d=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);
        if(Math.abs(d)<1e-10) return p1;
        const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/d;
        return {x:x1+t*(x2-x1), y:y1+t*(y2-y1)};
      };
      for(let j=0; j<input.length; j++){
        const cur = input[j];
        const prev = input[(j+input.length-1)%input.length];
        const curIn = inside(cur), prevIn = inside(prev);
        if(curIn){
          if(!prevIn) output.push(intersect(prev, cur));
          output.push(cur);
        } else if(prevIn){
          output.push(intersect(prev, cur));
        }
      }
    }
    return output;
  };

  // Compute net area for a shape that may have embedded holes
  // Clips each hole to the outer boundary so overflow doesn't over-subtract
  const calcShapeNetArea = (pts) => {
    const {outer, holes} = splitShapeHoles(pts);
    if(outer.length<3) return 0;
    const outerClean = outer.filter(p=>!p._ctrl);
    const outerArea = Math.abs(outer.some(p=>p._ctrl) ? calcShapeArea(outer) : calcArea(outer));
    // Clip each hole to the outer polygon, then compute its area
    const holesArea = holes.reduce((s,h)=> {
      const hClean = h.filter(p=>!p._ctrl);
      if(hClean.length<3) return s;
      // Clip the hole to the outer boundary so only the intersection counts
      const clipped = clipPolygonToOuter(hClean, outerClean);
      if(clipped.length<3) return s;
      return s + Math.abs(calcArea(clipped));
    }, 0);
    return Math.max(0, outerArea - holesArea);
  };

  // ── snapToAngle: snap a point to nearest allowed angle from 'from' ──────
  const snapToAngle = (from, to) => {
    if(!from||!snapEnabled) return to;
    const dx=to.x-from.x, dy=to.y-from.y, len=Math.hypot(dx,dy);
    if(len<2) return to;
    const deg=Math.atan2(dy,dx)*180/Math.PI;
    const snaps=[0,45,60,90,135,150,180,225,240,270,315,300,360,-45,-60,-90,-135,-150,-180,-225,-240,-270,-300,-315];
    const best=snaps.reduce((b,a)=>{const d=Math.abs(((deg-a)+540)%360-180);return d<b.diff?{a,diff:d}:b;},{a:0,diff:Infinity}).a;
    const rad=best*Math.PI/180;
    return {x:Math.round(from.x+len*Math.cos(rad)), y:Math.round(from.y+len*Math.sin(rad))};
  };

  // SVG — condition-first model. Each item may have multiple shapes.
  // Active condition gets a highlight ring.

  // ── Single source of truth for shape-level delete ────────────────────────
  const deleteSelectedShapes = () => {
    const keys = [...selectedShapesRef.current];
    console.log('[deleteSelectedShapes] keys:', keys);
    if(!keys.length) return;
    pushUndo();
    const byItem = {};
    keys.forEach(k => {
      const parts = k.split('::');
      const id = parts[0];
      const si = Number(parts[1]);
      if(!byItem[id]) byItem[id] = [];
      byItem[id].push(si);
    });
    console.log('[deleteSelectedShapes] byItem:', byItem);
    Object.entries(byItem).forEach(([id, idxs]) => {
      const item = itemsRef.current.find(i => String(i.id) === String(id));
      if(!item){ console.warn('[deleteSelectedShapes] item not found:', id, 'items count:', itemsRef.current.length, 'ids:', itemsRef.current.map(i=>i.id)); return; }
      const rawPts = item.points;
      let shapes;
      if(!rawPts || rawPts.length === 0){ shapes = []; }
      else if(Array.isArray(rawPts[0])){ shapes = rawPts; }
      else if(rawPts[0] && typeof rawPts[0].x === 'number'){ shapes = [rawPts]; }
      else { shapes = rawPts; }
      console.log('[deleteSelectedShapes] item', id, 'shapes count:', shapes.length, 'removing idxs:', idxs);
      const kept = shapes.filter((_, i) => !idxs.includes(i));
      if(kept.length === 0){
        console.log('[deleteSelectedShapes] deleting entire item', id);
        setItems(prev => prev.filter(i => String(i.id) !== String(id)));
        supabase.from('takeoff_items').delete().eq('id', id).select().then(({ data:del, error }) => {
          if(error) console.error('[deleteSelectedShapes] supabase delete error:', error);
          else if(!del||del.length===0) console.warn('[deleteSelectedShapes] RLS blocked delete for', id);
          else console.log('[deleteSelectedShapes] supabase delete OK for', id);
        });
      } else {
        console.log('[deleteSelectedShapes] trimming item', id, 'kept shapes:', kept.length);
        setItems(prev => prev.map(i => String(i.id) === String(id) ? {...i, points: kept} : i));
        supabase.from('takeoff_items').update({ points: kept }).eq('id', id).select().then(({ data:upd, error }) => {
          if(error) console.error('[deleteSelectedShapes] supabase update error:', error);
          else if(!upd||upd.length===0) console.warn('[deleteSelectedShapes] RLS blocked update for', id);
          else console.log('[deleteSelectedShapes] supabase update OK for', id);
        });
      }
    });
    setSelectedShapes(new Set());
  };
  deleteShapesRef.current = deleteSelectedShapes;

  // ── Commit shape drag: apply offset to selected shapes ─────────────────
  const commitShapeDrag = (offset) => {
    if(!offset) return;
    pushUndo();
    const {dx, dy} = offset;
    const keys = [...selectedShapesRef.current];
    const byItem = {};
    keys.forEach(k=>{
      const colonIdx = k.lastIndexOf('::');
      const id = k.slice(0, colonIdx);
      const si = Number(k.slice(colonIdx+2));
      if(!byItem[id]) byItem[id] = new Set();
      byItem[id].add(si);
    });
    setItems(prev=>prev.map(item=>{
      const idStr = String(item.id);
      if(!byItem[idStr]) return item;
      const selectedIdxs = byItem[idStr];
      const shapes = normalizeShapes(item.points);
      const newShapes = shapes.map((sh, si)=>{
        if(!selectedIdxs.has(si)) return sh;
        return sh.map(p=>({...p, x:p.x+dx, y:p.y+dy}));
      });
      // Save to Supabase (area/length unchanged by translation, just coords)
      supabase.from('takeoff_items').update({points:newShapes}).eq('id',item.id);
      return {...item, points:newShapes};
    }));
  };

  // ── Commit vertex drag: apply single point change + recompute qty ──────
  const commitVertexDrag = (vd) => {
    if(!vd) return;
    pushUndo();
    const {itemId, shapeIdx, vertexIdx, point} = vd;
    setItems(prev=>prev.map(item=>{
      if(String(item.id)!==String(itemId)) return item;
      const shapes = normalizeShapes(item.points);
      const newShapes = shapes.map((sh, si)=>{
        if(si!==shapeIdx) return sh;
        return sh.map((p, vi)=> vi===vertexIdx ? {...p, x:point.x, y:point.y} : p);
      });
      const mt = item.measurement_type;
      let qty = 0;
      if(mt==='area') qty = newShapes.reduce((s,sh)=>s+calcShapeNetArea(sh),0);
      else if(mt==='linear'){ qty = newShapes.reduce((s,sh)=>{let t=0;for(let i=1;i<sh.length;i++){const a=sh[i-1],b=sh[i];if(!a._ctrl&&!b._ctrl) t+=calcLinear(a,b);}return s+t;},0); }
      else if(mt==='count') qty = newShapes.length;
      qty = Math.round(Math.abs(qty)*10)/10;
      const total_cost = computeTotalCost(item, qty);
      supabase.from('takeoff_items').update({points:newShapes, quantity:qty, total_cost}).eq('id',item.id);
      return {...item, points:newShapes, quantity:qty, total_cost};
    }));
  };

  // ── Single source of truth for shape-level copy ───────────────────────────
  const copySelectedShapes = () => {
    const keys = [...selectedShapesRef.current];
    if(!keys.length) return;
    const byItem = {};
    keys.forEach(k => {
      const parts = k.split('::');
      const id = parts[0]; const si = Number(parts[1]);
      if(!byItem[id]) byItem[id] = [];
      byItem[id].push(si);
    });
    const entries = Object.entries(byItem).map(([id, idxs]) => {
      const item = itemsRef.current.find(i => String(i.id) === String(id)); if(!item) return null;
      const rawPts = item.points;
      let shapes;
      if(!rawPts || rawPts.length===0){ shapes=[]; }
      else if(Array.isArray(rawPts[0])){ shapes=rawPts; }
      else if(rawPts[0] && typeof rawPts[0].x==='number'){ shapes=[rawPts]; }
      else { shapes=rawPts; }
      return { item, shapes: idxs.map(i => shapes[i]).filter(Boolean) };
    }).filter(Boolean);
    clipboardRef.current = entries;
    setClipboard(entries);
    pasteOffsetRef.current = 0;
    setCopyFlash(keys.length);
    setTimeout(() => setCopyFlash(0), 1800);
  };
  copyShapesRef.current = copySelectedShapes;

  const renderMeasurements=()=>{
    if(!selPlan?.id) return [];
    const sw=2/zoom, fs=10/zoom, r=5/zoom, rSm=3/zoom, padH=9/zoom;
    return items
      .filter(it=> it.points?.length && (it.plan_id===selPlan.id || normalizeShapes(it.points).some(sh=>sh[0]?._planId===selPlan.id)))
      .flatMap(it=>{
        const allShapes = normalizeShapes(it.points);
        // Filter to shapes belonging to this plan (by _planId tag, or if item's plan_id matches)
        const shapes = allShapes.filter(sh => {
          const shapePlanId = sh[0]?._planId;
          return shapePlanId ? shapePlanId === selPlan.id : it.plan_id === selPlan.id;
        });
        if(!shapes.length) return [];
        const isActive = it.id===activeCondId;
        const isSelected = false; // resolved per-shape below using selectedShapes
        const c = isActive ? '#E8A317' : isSelected ? '#5B9BD5' : (it.color||'#4CAF50');
        const mt = it.measurement_type;

        return shapes.map((pts, shapeIdx)=>{
          const key = `${it.id}-${shapeIdx}`;
          // Skip legacy separate hole shapes (old data format)
          if(pts[0]?._hole) return null;
          const isSelected = selectedShapes.has(`${it.id}::${shapeIdx}`);
          const isEraserTarget = eraserHover?.itemId===it.id && eraserHover?.shapeIdx===shapeIdx;
          const shapeKey = `${it.id}::${shapeIdx}`;
          const onClick = (e)=>{
            if(tool==='eraser') return;
            // If actively drawing a takeoff, let clicks pass through to SVG handler
            if(activeCondId && tool!=='select' && tool!=='cutout') return;
            // ── Cutout: click on an area shape to arm it for cutting ──
            if(tool==='cutout'){
              if(mt==='area'){
                e.stopPropagation();
                setActiveCondId(it.id);
              }
              return;
            }
            if(tool==='select'||(e.ctrlKey||e.metaKey)){
              e.stopPropagation();
              if(e.ctrlKey||e.metaKey){
                setSelectedShapes(prev=>{ const n=new Set(prev); n.has(shapeKey)?n.delete(shapeKey):n.add(shapeKey); return n; });
              } else if(selectedShapes.has(shapeKey)){
                // Already part of multi-selection — keep the group selected
              } else {
                setSelectedShapes(new Set([shapeKey]));
              }
              return;
            }
            setActiveCondId(it.id);
            setTool(mt==='area'?'area':mt==='perimeter'?'perimeter':mt==='linear'?'linear':mt==='count'?'count':'select');
          };

          // ── Apply vertex drag to display points ──
          let dp = pts;
          if(vertexDrag && String(vertexDrag.itemId)===String(it.id) && vertexDrag.shapeIdx===shapeIdx){
            dp = pts.map((p,vi)=> vi===vertexDrag.vertexIdx ? {...p, x:vertexDrag.point.x, y:vertexDrag.point.y} : p);
          }

          // ── Shape drag ──
          const isDragging = dragOffset && isSelected;
          const dragTransform = isDragging ? `translate(${dragOffset.dx}, ${dragOffset.dy})` : undefined;
          const shapeCursor = isDragging ? 'grabbing' : (isSelected && tool==='select') ? 'grab' : tool==='eraser' ? 'cell' : 'pointer';

          // ── Vertex handles (skip _holeStart markers) ──
          const showVertices = isSelected && tool==='select' && !isDragging;
          const vertexHandles = showVertices ? dp.map((p,vi)=>{
            if(p._ctrl || p._holeStart) return null;
            const isActiveVtx = vertexDrag && String(vertexDrag.itemId)===String(it.id) && vertexDrag.shapeIdx===shapeIdx && vertexDrag.vertexIdx===vi;
            return <circle key={`vtx-${vi}`} data-vertex="1" data-item-id={it.id} data-shape-idx={shapeIdx} data-vertex-idx={vi}
              cx={p.x} cy={p.y} r={r*1.1}
              fill={isActiveVtx?'#5B9BD5':'#fff'} stroke="#5B9BD5" strokeWidth={sw*0.8}
              style={{cursor:'move',pointerEvents:'all'}}/>;
          }).filter(Boolean) : null;

          // ── Midpoint "+" handles for adding vertices ──
          const midpointHandles = showVertices ? (()=>{
            const realPts = dp.filter(p=>!p._ctrl&&!p._holeStart);
            const handles = [];
            const loopEnd = mt==='area' ? realPts.length : realPts.length-1;
            for(let ei=0; ei<loopEnd; ei++){
              const a = realPts[ei], b = realPts[(ei+1)%realPts.length];
              const mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
              // Find actual indices in dp for edge insertion
              const aIdx = dp.indexOf(a), bIdx = dp.indexOf(b);
              handles.push(<circle key={`mid-${ei}`} data-midpoint="true" data-item-id={it.id} data-shape-idx={shapeIdx} data-edge-idx={Math.max(aIdx,0)}
                cx={mx} cy={my} r={rSm}
                fill="rgba(59,130,246,0.3)" stroke="#5B9BD5" strokeWidth={sw*0.5}
                style={{cursor:'copy',pointerEvents:'all'}}/>);
            }
            return handles;
          })() : null;

          if((mt==='area')&&dp.length>=3){
            const {outer: outerPts, holes: embeddedHoles} = splitShapeHoles(dp);
            if(outerPts.length<3) return null;
            const hasArcs = outerPts.some(p=>p._ctrl);
            const realPts = outerPts.filter(p=>!p._ctrl);
            const validHoles = embeddedHoles.filter(h=>h.length>=3);
            const hasHoles = validHoles.length>0;

            // Build SVG paths
            const outerD = hasArcs ? buildShapePath(outerPts, true) : (outerPts.map((p,i)=>`${i===0?'M':'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')+' Z');
            let combinedD = outerD;
            validHoles.forEach(hPts=>{
              const hD = hPts.some(p=>p._ctrl) ? buildShapePath(hPts, true) : (hPts.map((p,i)=>`${i===0?'M':'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')+' Z');
              combinedD += ' ' + hD;
            });

            const cx=realPts.reduce((s,p)=>s+p.x,0)/(realPts.length||1);
            const cy=realPts.reduce((s,p)=>s+p.y,0)/(realPts.length||1);
            const netArea = Math.round(calcShapeNetArea(dp)*10)/10;
            const lw=38/zoom, lh=padH*1.6;
            const strokeColor = isEraserTarget ? '#C0504D' : c;
            const fillColor = c+'22';
            const strokeW = isEraserTarget ? sw*2 : (isActive?sw*1.5:sw);
            const clipId = `clip-${it.id}-${shapeIdx}`;

            return(<g key={key} data-shape="1" data-item-id={it.id} data-shape-idx={shapeIdx} onClick={onClick} style={{cursor:shapeCursor}} transform={dragTransform}>
              {/* ClipPath: outer boundary constrains everything — no phantom fill, no stroke overflow */}
              {hasHoles&&<defs><clipPath id={clipId}><path d={outerD}/></clipPath></defs>}
              {/* ONE path: compound (outer+holes), evenodd fill, stroke traces outer AND hole boundaries.
                  ClipPath clips stroke at outer boundary so hole lines don't extend outside. */}
              <path d={combinedD}
                fill={fillColor} fillRule="evenodd"
                stroke={strokeColor} strokeWidth={strokeW}
                clipPath={hasHoles?`url(#${clipId})`:undefined}/>
              {isSelected&&<path d={outerD} fill="none" stroke="#5B9BD5" strokeWidth={sw*2} strokeDasharray={`${6/zoom},${3/zoom}`} opacity={0.6} style={{pointerEvents:'none'}}/>}
              <rect x={cx-lw/2} y={cy-lh/2} width={lw} height={lh} rx={2/zoom} fill="rgba(0,0,0,0.65)"/>
              <text x={cx} y={cy+fs*0.38} fontSize={fs*0.9} fill={isActive?'#E8A317':'#ddd'} textAnchor="middle" fontFamily="monospace" fontWeight={600} style={{pointerEvents:'none'}}>{netArea} SF</text>
              {vertexHandles}
              {midpointHandles}
            </g>);
          }
          if(mt==='linear'&&dp.length>=2){
            const hasArcs = dp.some(p=>p._ctrl);
            const d = hasArcs ? buildShapePath(dp) : ('M'+dp.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L'));
            const realPts = dp.filter(p=>!p._ctrl);
            const mx=realPts.reduce((s,p)=>s+p.x,0)/realPts.length;
            const my=realPts.reduce((s,p)=>s+p.y,0)/realPts.length;
            const linDist = hasArcs
              ? Math.round((calcShapeLength(dp)/scale)*10)/10
              : (()=>{ let t=0; for(let i=1;i<dp.length;i++) t+=calcLinear(dp[i-1],dp[i]); return Math.round(t*10)/10; })();
            const itemH = it.height || 0;
            const dist = (itemH > 0 && scale) ? Math.round(linDist*itemH*10)/10 : linDist;
            const distUnit = (itemH > 0 && scale) ? 'SF' : (scale ? 'LF' : 'px');
            const lw=36/zoom, lh=padH*1.5;
            const strokeColor = isEraserTarget ? '#C0504D' : c;
            const strokeW = isEraserTarget ? sw*2.5 : sw*1.2;
            return(<g key={key} data-shape="1" data-item-id={it.id} data-shape-idx={shapeIdx} onClick={onClick} style={{cursor:shapeCursor}} transform={dragTransform}>
              <path d={d} fill="none" stroke={strokeColor} strokeWidth={strokeW} strokeDasharray={`${6/zoom},${3/zoom}`}/>
              {isSelected&&<path d={d} fill="none" stroke="#5B9BD5" strokeWidth={sw*2.5} opacity={0.4} style={{pointerEvents:'none'}}/>}
              {realPts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={r*0.8} fill={strokeColor} stroke="#fff" strokeWidth={sw*0.4}/>)}
              {hasArcs&&dp.filter(p=>p._ctrl).map((p,i)=><circle key={'ctrl'+i} cx={p.x} cy={p.y} r={r*0.5} fill={c} opacity={0.4}/>)}
              <rect x={mx-lw/2} y={my-lh*1.6} width={lw} height={lh} rx={2/zoom} fill="rgba(0,0,0,0.65)"/>
              <text x={mx} y={my-lh*0.7} fontSize={fs*0.9} fill={isActive?'#E8A317':'#ddd'} textAnchor="middle" fontFamily="monospace" fontWeight={600} style={{pointerEvents:'none'}}>{dist} {distUnit}</text>
              {vertexHandles}
              {midpointHandles}
            </g>);
          }
          if(mt==='count'&&dp[0]){
            const p=dp[0];
            const isEr=isEraserTarget;
            return(<g key={key} data-shape="1" data-item-id={it.id} data-shape-idx={shapeIdx} onClick={onClick} style={{cursor:shapeCursor}} transform={dragTransform}>
              <circle cx={p.x} cy={p.y} r={r*1.8} fill={isEr?'#C0504D':c} stroke={isSelected?'#5B9BD5':'#fff'} strokeWidth={isSelected?sw*2:sw*0.5}/>
              <text x={p.x} y={p.y+fs*0.38} fontSize={fs*0.9} fill="#fff" textAnchor="middle" fontFamily="monospace" fontWeight={700} style={{pointerEvents:'none'}}>✕</text>
            </g>);
          }

          return null;
        }).filter(Boolean);
      });
  };

  const renderActive=()=>{
    const pts=(tool==='scale'&&scaleStep==='picking')?scalePts:activePts;
    if(!pts.length&&!archMode) return null;
    const c=tool==='scale'?'#4CAF50':tool==='cutout'?'#C0504D':archMode?'#7B6BA4':tool==='area'?'#F59E0B':tool==='perimeter'?'#E8A317':'#4A90A4';
    const sw=2.5/zoom, r0=10/zoom, r1=5/zoom, r2=4/zoom, fs=10/zoom;
    const all=hoverPt?[...pts,hoverPt]:pts;
    const activeCond = itemsRef.current.find(i=>String(i.id)===String(activeCondId));
    const mt = activeCond?.measurement_type;

    // Build preview path
    let previewPath = null;
    const lastPt = pts.length ? pts[pts.length-1] : null;
    const hasThroughPending = lastPt?._through; // through-point placed, awaiting arc endpoint

    if(arcPending && hasThroughPending && hoverPt && pts.length>=2){
      // Arc mode: through-point placed, show live bezier preview to mouse
      // Compute preview control point so curve passes THROUGH the clicked point
      const startPt = pts[pts.length-2]; // point before through
      const throughPt = lastPt;
      const tentativeEnd = hoverPt;
      const previewCtrl = {
        x: 2 * throughPt.x - 0.5 * startPt.x - 0.5 * tentativeEnd.x,
        y: 2 * throughPt.y - 0.5 * startPt.y - 0.5 * tentativeEnd.y,
      };
      const d=`M${startPt.x},${startPt.y} Q${previewCtrl.x},${previewCtrl.y} ${tentativeEnd.x},${tentativeEnd.y}`;
      const pxLen = bezierLength(startPt, previewCtrl, tentativeEnd);
      const ft = scale ? Math.round(pxLen/scale*10)/10 : null;
      const mx=(startPt.x+tentativeEnd.x)/2, my=(startPt.y+tentativeEnd.y)/2;
      // Draw the straight segments leading up to the arc
      const straightPts = pts.slice(0,-1).filter(p=>!p._ctrl&&!p._through);
      previewPath = (<>
        {straightPts.length>=2&&<polyline points={straightPts.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={c} strokeWidth={sw} strokeDasharray={(tool==='area')?'none':`${6/zoom},${3/zoom}`} opacity={0.9}/>}
        <path d={d} fill="none" stroke={c} strokeWidth={sw} strokeDasharray={`${6/zoom},${3/zoom}`} opacity={0.9}/>
        {/* Show the through-point as a visible marker */}
        <circle cx={throughPt.x} cy={throughPt.y} r={r2*1.2} fill={c} opacity={0.7}/>
        <circle cx={tentativeEnd.x} cy={tentativeEnd.y} r={r2} fill={c} opacity={0.5}/>
        {ft&&<text x={mx} y={my-8/zoom} fontSize={fs} fill={c} textAnchor="middle" fontFamily="monospace" fontWeight={700} style={{pointerEvents:'none'}}>{ft} LF ⌒</text>}
      </>);
    } else {
      // Normal preview: polyline of all non-ctrl/non-through points + hover
      const realPts = pts.filter(p=>!p._ctrl&&!p._through);
      const allPts = hoverPt ? [...realPts, hoverPt] : realPts;
      if(allPts.length>=2) previewPath = (<>
        <polyline points={allPts.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={c} strokeWidth={sw} strokeDasharray={(tool==='area'||tool==='cutout')?'none':`${6/zoom},${3/zoom}`} opacity={0.9}/>
        {tool==='cutout'&&allPts.length>=3&&<polygon points={allPts.map(p=>`${p.x},${p.y}`).join(' ')} fill="rgba(239,68,68,0.15)" stroke="none"/>}
        {/* Draw committed bezier arcs in activePts */}
        {(()=>{
          const arcs=[];
          for(let i=1;i<pts.length;i++){
            if(pts[i]._ctrl && i>0 && i<pts.length-1){
              const d=`M${pts[i-1].x},${pts[i-1].y} Q${pts[i].x},${pts[i].y} ${pts[i+1].x},${pts[i+1].y}`;
              arcs.push(<path key={i} d={d} fill="none" stroke={c} strokeWidth={sw} opacity={0.9}/>);
            }
          }
          return arcs;
        })()}
      </>);
    }

    return(<>
      {previewPath}
      {/* Draw placed points (skip _ctrl and _through) */}
      {pts.filter(p=>!p._ctrl&&!p._through).map((p,i)=>(
        <circle key={i} cx={p.x} cy={p.y} r={i===0&&pts.filter(pp=>!pp._ctrl&&!pp._through).length>=3?r0:r1} fill={c} stroke={i===0&&pts.filter(pp=>!pp._ctrl&&!pp._through).length>=3?'#fff':'none'} strokeWidth={sw*0.8} opacity={0.95}/>
      ))}
      {/* Show ctrl points as small circles */}
      {pts.filter(p=>p._ctrl).map((p,i)=>(
        <circle key={'c'+i} cx={p.x} cy={p.y} r={r2*0.8} fill={c} opacity={0.5}/>
      ))}
      {hoverPt&&!hasThroughPending&&<circle cx={hoverPt.x} cy={hoverPt.y} r={r2} fill={c} opacity={0.5}/>}
      {/* Close hint for area */}
      {(tool==='area'||tool==='cutout')&&activePts.filter(p=>!p._ctrl&&!p._through).length>=3&&!arcPending&&<text x={pts[0].x+14/zoom} y={pts[0].y-10/zoom} fontSize={fs} fill={c} fontFamily="monospace" fontWeight={700} style={{pointerEvents:'none'}}>dbl-click to close</text>}
      {/* Snap indicator — small crosshair on cursor when snap is active */}
      {snapEnabled&&hoverPt&&(()=>{
        const sz=9/zoom;
        return(<>
          <line x1={hoverPt.x-sz} y1={hoverPt.y} x2={hoverPt.x+sz} y2={hoverPt.y} stroke="#facc15" strokeWidth={1.2/zoom} opacity={0.9}/>
          <line x1={hoverPt.x} y1={hoverPt.y-sz} x2={hoverPt.x} y2={hoverPt.y+sz} stroke="#facc15" strokeWidth={1.2/zoom} opacity={0.9}/>
          <circle cx={hoverPt.x} cy={hoverPt.y} r={sz*0.55} fill="none" stroke="#facc15" strokeWidth={1/zoom} opacity={0.8}/>
        </>);
      })()}
      {/* dbl-click to finish hint for linear */}
      {tool==='linear'&&!archMode&&activePts.length>=2&&hoverPt&&<text x={hoverPt.x+8/zoom} y={hoverPt.y-8/zoom} fontSize={fs*0.9} fill={c} fontFamily="monospace" fontWeight={600} style={{pointerEvents:'none'}}>dbl-click to finish</text>}
      {/* Live LF readout — segment from last point to cursor */}
      {tool==='linear'&&!archMode&&activePts.length>=1&&scale&&hoverPt&&(()=>{
        const lastPt=activePts[activePts.length-1];
        const dist=Math.round(calcLinear(lastPt,hoverPt)*10)/10;
        return <text x={(lastPt.x+hoverPt.x)/2} y={(lastPt.y+hoverPt.y)/2-6/zoom} fontSize={fs} fill={c} textAnchor="middle" fontFamily="monospace" fontWeight={700} style={{pointerEvents:'none'}}>{dist} LF</text>;
      })()}
      {/* Arc mode hint */}
      {arcPending&&hoverPt&&(
        <text x={hoverPt.x} y={hoverPt.y-16/zoom} fontSize={fs*0.9} fill={c} textAnchor="middle" fontFamily="monospace" fontWeight={700} style={{pointerEvents:'none'}}>
          {hasThroughPending ? '⌒ Click arc endpoint' : '⌒ Click where curve passes through'}
        </text>
      )}
    </>);
  };

  const totalEst=items.reduce((s,i)=>s+(i.total_cost||0),0); // all sheets
  const catGroups=TAKEOFF_CATS.map(cat=>{
    const allCatItems = sidebarItems.filter(i=>i.category===cat.id);
    if(!allCatItems.length) return null;
    const byDesc = new Map();
    allCatItems.forEach(i=>{
      const key = i.description;
      if(!byDesc.has(key)){
        byDesc.set(key, {...i, _planCount:1, _totalQty:i.quantity||0, _totalCost:i.total_cost||0, _siblings:[i]});
      } else {
        const g = byDesc.get(key);
        const newCount = g._planCount+1;
        const newQty = Math.round((g._totalQty+(i.quantity||0))*10)/10;
        const newCost = g._totalCost+(i.total_cost||0);
        const newSibs = [...g._siblings,i];
        const base = i.plan_id===selPlan?.id ? i : g;
        byDesc.set(key, {...base, _planCount:newCount, _totalQty:newQty, _totalCost:newCost, _siblings:newSibs});
      }
    });
    const its = [...byDesc.values()];
    const subtotal = its.reduce((s,i)=>s+(i._totalCost||0),0);
    return {cat, items:its, subtotal};
  }).filter(Boolean);
  const toolCursor=(markupMode==='dimension'||markupMode==='legend')?'crosshair':(spaceHeld||tool==='select')?'grab':(tool==='cutout'&&!activeCondId)?'pointer':{area:'crosshair',linear:'crosshair',count:'cell',scale:'crosshair',cutout:'crosshair',eraser:'cell'}[tool]||'default';

  const co = COMPANIES.find(c=>c.id===project.company)||COMPANIES[1];
  const STATUS_COLORS_BID = {estimating:'#F59E0B',bid_submitted:'#5B9BD5',awarded:'#4CAF50',lost:'#C0504D',hold:'#555'};

  // ── right tool icon helper
  const RightBtn = ({icon, label, active, onClick, color}) => {
    const activeColor = color || '#4CAF50';
    return(
    <button onClick={onClick} title={label}
      style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2,
        padding:'11px 0',border:'none',
        background:active?activeColor+'18':'none',
        color:active?activeColor:t.text3,
        cursor:'pointer',width:'100%',
        borderRight:active?`2px solid ${activeColor}`:'2px solid transparent',
        transition:'all 0.12s'}}>
      <span style={{fontSize:17,lineHeight:1}}>{icon}</span>
      <span style={{fontSize:8,fontVariantNumeric:'tabular-nums',fontWeight:600,letterSpacing:0.2,color:active?activeColor:t.text4,marginTop:1}}>{label}</span>
    </button>
    );
  };

  // ── Export plan with markup + optional legend ──────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const roundRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath(); ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
  };

  const exportPlanCanvas = async (plan, withLegend) => {
    const marker = '/object/public/attachments/';

    const loadPlanImg = async (url) => {
      const idx = url?.indexOf(marker) ?? -1;
      const storagePath = idx !== -1 ? url.slice(idx + marker.length) : null;
      if(!storagePath) throw new Error('Could not extract storage path from: ' + url);
      const { data, error } = await supabase.storage.from('attachments').download(storagePath);
      if(error || !data) throw new Error('Supabase download failed: ' + (error?.message || 'unknown') + ' | ' + storagePath);
      const bUrl = URL.createObjectURL(data);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = bUrl; });
      URL.revokeObjectURL(bUrl);
      return img;
    };

    // For the currently-open PDF plan reuse the already-rendered canvas
    const usePdfCanvas = plan.id === selPlan?.id && isPdfPlan && canvasRef.current;

    let img = null;
    if(!usePdfCanvas){
      img = await loadPlanImg(plan.file_url);
    }

    const W = usePdfCanvas ? canvasRef.current.width  : (img?.naturalWidth  || 800);
    const H = usePdfCanvas ? canvasRef.current.height : (img?.naturalHeight || 1100);

    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');

    if(usePdfCanvas){
      ctx.drawImage(canvasRef.current, 0, 0, W, H);
    } else {
      ctx.drawImage(img, 0, 0, W, H);
    }

    // Draw takeoff shapes — use plan's own scale, not the live UI state
    const planScale = plan.scale_px_per_ft || scale || null;
    // Get all items that have shapes belonging to this plan (by plan_id or _planId tag)
    const planItemsEx = items.filter(it => it.points?.length && (
      it.plan_id === plan.id || normalizeShapes(it.points).some(sh => sh[0]?._planId === plan.id)
    ));
    for(const it of planItemsEx){
      const allShapes = normalizeShapes(it.points);
      // Filter to only shapes belonging to this plan
      const shapes = allShapes.filter(sh => {
        const shapePlanId = sh[0]?._planId;
        return shapePlanId ? shapePlanId === plan.id : it.plan_id === plan.id;
      });
      const c = it.color || '#4CAF50';
      const mt = it.measurement_type;
      for(const pts of shapes){
        if(!pts.length) continue;
        const realPts = pts.filter(p => !p._ctrl);
        ctx.save();
        ctx.lineWidth = Math.max(2, W/800);
        ctx.strokeStyle = c;

        if(mt === 'area' && realPts.length >= 3){
          ctx.fillStyle = c + '33';
          ctx.beginPath(); ctx.moveTo(realPts[0].x, realPts[0].y);
          for(let i=1;i<realPts.length;i++) ctx.lineTo(realPts[i].x, realPts[i].y);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          const cx = realPts.reduce((s,p)=>s+p.x,0)/realPts.length;
          const cy = realPts.reduce((s,p)=>s+p.y,0)/realPts.length;
          // Per-shape area from geometry
          const pxArea = Math.abs(realPts.reduce((s,p,i)=>{ const n=realPts[(i+1)%realPts.length]; return s+(p.x*n.y-n.x*p.y); },0)/2);
          const shapeQty = planScale ? Math.round((pxArea/(planScale*planScale))*10)/10 : Math.round(pxArea*10)/10;
          const shapeUnit = it.unit || 'SF';
          const labelStr = `${shapeQty.toLocaleString()} ${shapeUnit}`;
          const fs = Math.max(10, W/80);
          ctx.fillStyle='rgba(0,0,0,0.72)'; ctx.fillRect(cx-fs*3,cy-fs*0.9,fs*6,fs*1.8);
          ctx.fillStyle='#eee'; ctx.font=`bold ${fs}px monospace`;
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(labelStr, cx, cy);
        } else if(mt === 'linear' && realPts.length >= 2){
          ctx.setLineDash([6,3]); ctx.beginPath(); ctx.moveTo(realPts[0].x, realPts[0].y);
          for(let i=1;i<realPts.length;i++) ctx.lineTo(realPts[i].x, realPts[i].y);
          ctx.stroke(); ctx.setLineDash([]);
          realPts.forEach(p=>{ ctx.fillStyle=c; ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill(); });
          const mx = realPts.reduce((s,p)=>s+p.x,0)/realPts.length;
          const my = realPts.reduce((s,p)=>s+p.y,0)/realPts.length;
          // Per-shape length from geometry
          let pxLen=0; for(let i=1;i<realPts.length;i++) pxLen+=Math.sqrt((realPts[i].x-realPts[i-1].x)**2+(realPts[i].y-realPts[i-1].y)**2);
          const h = it.height || 0;
          let shapeQty = planScale ? Math.round((pxLen/planScale)*10)/10 : Math.round(pxLen*10)/10;
          let shapeUnit = planScale ? (it.unit||'LF') : 'px';
          if(h > 0 && planScale){ shapeQty = Math.round(shapeQty*h*10)/10; shapeUnit = 'SF'; }
          const labelStr = `${shapeQty} ${shapeUnit}`;
          const fs = Math.max(10, W/80);
          ctx.fillStyle='rgba(0,0,0,0.72)'; ctx.fillRect(mx-fs*3,my-fs*2.4,fs*6,fs*1.6);
          ctx.fillStyle='#eee'; ctx.font=`bold ${fs}px monospace`;
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(labelStr, mx, my-fs*1.6);
        } else if(mt === 'count' && pts[0]){
          const p=pts[0];
          ctx.fillStyle=c; ctx.beginPath(); ctx.arc(p.x,p.y,8,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#fff'; ctx.font='bold 10px monospace';
          ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('✕',p.x,p.y);        }
        ctx.restore();
      }
    }

    // Legend — clean white panel with qty per item
    if(withLegend && planItemsEx.length > 0){
      // Group by description → sum qty, keep color + unit
      const legendMap = new Map();
      planItemsEx.forEach(it => {
        const key = it.description;
        if(legendMap.has(key)){
          legendMap.get(key).qty += (it.quantity || 0);
        } else {
          legendMap.set(key, { color: it.color||'#4CAF50', qty: it.quantity||0, unit: it.unit||'' });
        }
      });
      const legendItems = [...legendMap.entries()]; // [desc, {color,qty,unit}]

      const sc     = Math.max(1, W / 1200);
      const fs     = Math.round(13 * sc);
      const fsSub  = Math.round(9  * sc);
      const fsTitle= Math.round(11 * sc);
      const fsQty  = Math.round(11 * sc);
      const padX   = Math.round(14 * sc);
      const padY   = Math.round(12 * sc);
      const swSize = Math.round(10 * sc);
      const rowH   = Math.round(24 * sc);
      const gap    = Math.round(4  * sc);
      const headerH= Math.round(40 * sc);

      // Measure longest row to set width
      const tmpCanvas = document.createElement('canvas');
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.font = `${fs}px Arial,sans-serif`;
      let maxRowW = 0;
      legendItems.forEach(([desc, {qty, unit}]) => {
        const label = (desc.length > 22 ? desc.slice(0,22)+'…' : desc);
        const qtyStr = qty > 0 ? `  ${Math.round(qty * 10)/10} ${unit}` : '';
        const w = tmpCtx.measureText(label + qtyStr).width;
        if(w > maxRowW) maxRowW = w;
      });
      const legendW = Math.round(padX*2 + swSize + Math.round(8*sc) + maxRowW + Math.round(16*sc));
      const legendH = padY + headerH + legendItems.length * (rowH + gap) + padY;
      const lx = Math.round(20 * sc);
      const ly = Math.round(20 * sc);
      const r  = Math.round(5  * sc);

      // Drop shadow
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.18)';
      ctx.shadowBlur  = Math.round(12 * sc);
      ctx.shadowOffsetY = Math.round(3 * sc);
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, lx, ly, legendW, legendH, r); ctx.fill();
      ctx.restore();

      // Border
      ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = Math.max(1, sc);
      roundRect(ctx, lx, ly, legendW, legendH, r); ctx.stroke();

      // Header bg
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(lx+r, ly); ctx.lineTo(lx+legendW-r, ly);
      ctx.quadraticCurveTo(lx+legendW, ly, lx+legendW, ly+r);
      ctx.lineTo(lx+legendW, ly+headerH); ctx.lineTo(lx, ly+headerH);
      ctx.lineTo(lx, ly+r); ctx.quadraticCurveTo(lx, ly, lx+r, ly);
      ctx.closePath(); ctx.fillStyle='#f3f4f6'; ctx.fill();
      ctx.restore();

      // Header divider
      ctx.fillStyle='#e5e7eb'; ctx.fillRect(lx, ly+headerH, legendW, Math.max(1,sc));

      // "TAKEOFFS" label
      ctx.fillStyle='#6b7280'; ctx.font=`700 ${fsSub}px Arial,sans-serif`;
      ctx.textAlign='left'; ctx.textBaseline='top';
      ctx.fillText('TAKEOFFS', lx+padX, ly+Math.round(padY*0.7));

      // Sheet name
      ctx.fillStyle='#111827'; ctx.font=`600 ${fsTitle}px Arial,sans-serif`;
      ctx.fillText(plan.name.slice(0,32), lx+padX, ly+Math.round(padY*0.7)+fsSub+Math.round(4*sc));

      // Rows
      legendItems.forEach(([desc, {color, qty, unit}], i) => {
        const ry = ly + headerH + Math.round(sc) + gap + i*(rowH+gap);
        const midY = ry + rowH/2;

        // Swatch
        ctx.fillStyle = color;
        roundRect(ctx, lx+padX, midY - swSize/2, swSize, swSize, Math.round(2*sc));
        ctx.fill();
        ctx.strokeStyle='rgba(0,0,0,0.12)'; ctx.lineWidth=Math.max(1,sc*0.5);
        roundRect(ctx, lx+padX, midY - swSize/2, swSize, swSize, Math.round(2*sc));
        ctx.stroke();

        const textX = lx + padX + swSize + Math.round(8*sc);

        // Description
        const label = desc.length > 22 ? desc.slice(0,22)+'…' : desc;
        ctx.fillStyle='#1f2937'; ctx.font=`${fs}px Arial,sans-serif`;
        ctx.textAlign='left'; ctx.textBaseline='middle';
        ctx.fillText(label, textX, midY);

        // Qty + unit — right-aligned, bold, colored
        if(qty > 0){
          const qtyStr = `${Math.round(qty*10)/10} ${unit}`;
          ctx.font=`700 ${fsQty}px Arial,sans-serif`;
          ctx.fillStyle = color;
          ctx.textAlign='right';
          ctx.fillText(qtyStr, lx+legendW-padX, midY);
        }
      });
    }

    return new Promise(res => out.toBlob(res, 'image/png', 0.95));
  };

  const exportPlan = async (plan, withLegend=true) => {
    if(!plan) return;
    console.log('[export] starting for plan:', plan.name, 'withLegend:', withLegend);
    setExporting(true); setShowExportMenu(false);
    try {
      const blob = await exportPlanCanvas(plan, withLegend);
      console.log('[export] blob:', blob);
      if(!blob){ alert('Export failed — canvas could not be converted to image.'); setExporting(false); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(project.name||'plan').replace(/\s+/g,'-')}_${plan.name.replace(/\s+/g,'-')}_takeoff.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(a.href),8000);
    } catch(e){ console.error('[export] error', e); alert('Export failed: '+e.message); }
    setExporting(false);
  };

  const exportAllMarked = async (withLegend=true) => {
    const markedPlans = plans.filter(p=>items.some(i=>i.plan_id===p.id && i.points?.length));
    if(!markedPlans.length){ alert('No plans with markup found.'); return; }
    setExporting(true); setShowExportMenu(false);
    try {
      // Load JSZip
      if(!window.JSZip){
        await new Promise((res,rej)=>{
          const s=document.createElement('script');
          s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
          s.onload=res; s.onerror=rej; document.head.appendChild(s);
        });
      }
      const zip = new window.JSZip();
      for(let i=0;i<markedPlans.length;i++){
        const plan=markedPlans[i];
        setUploading(`Exporting ${i+1} / ${markedPlans.length}: ${plan.name}…`);
        try {
          const blob = await exportPlanCanvas(plan, withLegend);
          const fname = `${String(i+1).padStart(2,'0')}_${plan.name.replace(/[^a-zA-Z0-9._-]/g,'_')}_takeoff.png`;
          zip.file(fname, blob);
        } catch(e){ console.warn('skip plan export',plan.name,e); }
      }
      setUploading('Building ZIP…');
      const zipBlob = await zip.generateAsync({type:'blob', compression:'STORE'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(zipBlob);
      a.download=`${(project.name||'project').replace(/\s+/g,'-')}_marked_plans.zip`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),8000);
    } catch(e){ console.error('exportAll error',e); alert('Export failed: '+e.message); }
    setUploading(false);
    setExporting(false);
  };
  // ── Cross-references: parse sheet references from OCR text ──
  const [showRefsDD, setShowRefsDD] = useState(false);
  const planRefs = useMemo(() => {
    if (!selPlan?.ocr_text || !plans.length) return [];
    const text = selPlan.ocr_text;
    // Build a map of sheet numbers to plans (from plan names)
    const sheetNumMap = new Map();
    for (const p of plans) {
      if (p.id === selPlan.id) continue;
      const name = p.name || '';
      // Extract sheet number from name: "A1.0 - FLOOR PLAN" → "A1.0"
      const m = name.match(/^([A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,3})?)/);
      if (m) sheetNumMap.set(m[1].toUpperCase(), p);
      // Also map the full name
      sheetNumMap.set(name.toUpperCase(), p);
    }
    // Find references in OCR text
    const refs = new Map(); // planId → {plan, contexts:[]}
    const refPatterns = /(?:SEE|REFER TO|DETAIL|SECTION|SHEET|ON SHEET|PER)\s+([A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,3})?)/gi;
    // Also find bare sheet numbers that match known plans
    const bareNumPattern = /\b([A-Z]{1,3}\d{1,2}(?:\.\d{1,2})?)\b/g;
    let match;
    // First pass: explicit references
    while ((match = refPatterns.exec(text)) !== null) {
      const num = match[1].toUpperCase();
      const plan = sheetNumMap.get(num);
      if (plan && !refs.has(plan.id)) {
        refs.set(plan.id, { plan, context: match[0].trim() });
      }
    }
    // Second pass: bare sheet numbers (only if they match a known plan)
    while ((match = bareNumPattern.exec(text)) !== null) {
      const num = match[1].toUpperCase();
      const plan = sheetNumMap.get(num);
      if (plan && !refs.has(plan.id)) {
        // Get surrounding context
        const start = Math.max(0, match.index - 20);
        const end = Math.min(text.length, match.index + num.length + 20);
        refs.set(plan.id, { plan, context: text.slice(start, end).trim() });
      }
    }
    return [...refs.values()];
  }, [selPlan?.id, selPlan?.ocr_text, plans]);

  // ── Stable handlers ref for PlanRow (avoids re-render on every parent render) ──
  const planHandlersRef = useRef({});
  planHandlersRef.current = {
    setOpenTabs, setSelPlan, setScale, setPresetScale, setLeftTab, setShowOverview,
    planDragRef, setPlanDragOver, setPlans, setItems, savePlanSets,
    aiNameSheet, parseSheetNameFromText, openTabs, selPlan, planSets, items, t, planDragOver,
  };

  // ── Memoized visible plans (replaces O(n²) IIFE computation) ──
  const visiblePlans = useMemo(() => {
    let filtered = plansFilter === 'marked' ? plans.filter(p => planMarkedSet.has(p.id)) : plans;
    if (planSearch.trim()) {
      const q = planSearch.trim().toLowerCase();
      filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(q) || (p.ocr_text || '').toLowerCase().includes(q));
    }
    return filtered;
  }, [plans, plansFilter, planMarkedSet, planSearch]);

  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden',position:'relative'}}>

      {/* ── Top Bar — STACK style ── */}
      <div style={{display:'flex',alignItems:'center',height:44,borderBottom:`1px solid ${t.border}`,background:t.bg2,flexShrink:0,gap:0,padding:'0 0 0 0'}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:t.text3,cursor:'pointer',fontSize:12,padding:'0 16px',height:'100%',display:'flex',alignItems:'center',gap:4,flexShrink:0,fontWeight:500}}>
          ‹ Projects
        </button>
        {onExitToOps&&<button onClick={onExitToOps} style={{background:'none',border:'none',color:t.text3,cursor:'pointer',fontSize:11,padding:'0 12px',height:'100%',display:'flex',alignItems:'center',fontWeight:600,flexShrink:0,borderLeft:`1px solid ${t.border}`}}>
          OPS
        </button>}
        <div style={{padding:'0 20px',height:'100%',display:'flex',alignItems:'center',minWidth:0,maxWidth:300,flexShrink:0,borderLeft:`1px solid ${t.border}`}}>
          <div style={{fontSize:13,fontWeight:600,color:t.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{project.name}</div>
        </div>
        <div style={{flex:1}}/>
        <div style={{display:'flex',alignItems:'center',gap:4,padding:'0 12px',height:'100%',flexShrink:0}}>
          <button onClick={()=>setZoom(z=>Math.max(Math.round((z-0.1)*10)/10,0.1))} style={{background:'none',border:`1px solid ${t.border}`,color:t.text3,width:24,height:24,borderRadius:4,cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:300}}>−</button>
          <span style={{fontSize:11,color:t.text3,minWidth:40,textAlign:'center',fontWeight:500}}>{Math.round(zoom*100)}%</span>
          <button onClick={()=>setZoom(z=>Math.min(Math.round((z+0.1)*10)/10,4))} style={{background:'none',border:`1px solid ${t.border}`,color:t.text3,width:24,height:24,borderRadius:4,cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:300}}>+</button>
        </div>
        <button onClick={()=>setShowBidSummary(true)} disabled={!items.length}
          style={{height:'100%',padding:'0 20px',border:'none',borderLeft:`1px solid ${t.border}`,
            background:items.length?'#4CAF50':'transparent',color:items.length?'#fff':t.text4,
            cursor:items.length?'pointer':'default',fontSize:12,fontWeight:600,flexShrink:0}}>
          Bid Summary
        </button>
      </div>

      {/* ── Navigation Bar — STACK style ── */}
      <div style={{display:'flex',alignItems:'stretch',height:34,borderBottom:`1px solid ${t.border}`,background:t.bg,flexShrink:0,paddingLeft:16,gap:0}}>
        {[
          {id:'workspace',label:'Plans',leftTab:'plans'},
          {id:'workspace',label:'Takeoffs',leftTab:'takeoffs'},
          {id:'reports',label:'Reports'},
          {id:'estimate',label:'Estimates'},
        ].map((tab,i)=>{
          const isActive = tab.id==='estimate'
            ? (mainView==='workspace'&&rightTab==='estimate')
            : tab.label==='Plans' ? (mainView==='workspace'&&rightTab!=='estimate'&&leftTab==='plans')
            : tab.label==='Takeoffs' ? (mainView==='workspace'&&rightTab!=='estimate'&&leftTab==='takeoffs')
            : mainView===tab.id;
          return(
            <button key={i} onClick={()=>{
              if(tab.id==='estimate'){
                setMainView('workspace');
                setRightTab('estimate');
              } else if(tab.id==='workspace'){
                setMainView('workspace');
                setRightTab('items');
                if(tab.leftTab) setLeftTab(tab.leftTab);
              } else {
                setMainView(tab.id);
              }
            }}
              style={{padding:'0 18px',border:'none',background:'none',cursor:'pointer',
                fontSize:13,fontWeight:isActive?600:400,
                color:isActive?'#4CAF50':t.text3,
                borderBottom:isActive?'2px solid #4CAF50':'2px solid transparent',
                boxSizing:'border-box',transition:'color 0.15s',letterSpacing:0.2}}>
              {tab.label}
            </button>
          );
        })}
        <div style={{flex:1}}/>
        <div style={{display:'flex',alignItems:'center',paddingRight:16,gap:8}}>
          <span style={{fontSize:11,color:t.text4}}>{items.length} conditions · {plans.length} sheets</span>
          {/* AI Credits */}
          <div style={{position:'relative'}}>
            <button onClick={()=>setShowCreditsDD(p=>!p)}
              style={{background:'none',border:`1px solid ${t.border}`,borderRadius:4,padding:'3px 8px',cursor:'pointer',
                display:'flex',alignItems:'center',gap:4,fontSize:11,color:'#7B6BA4'}}>
              <span>✦</span> {aiCredits?.available ?? '—'} credits
            </button>
            {showCreditsDD&&<>
              <div style={{position:'fixed',inset:0,zIndex:99}} onClick={()=>setShowCreditsDD(false)}/>
              <div style={{position:'absolute',top:'100%',right:0,zIndex:100,marginTop:4,background:'#fff',border:'1px solid #E0E0E0',borderRadius:4,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:16,minWidth:200}}>
                <div style={{fontSize:13,fontWeight:600,color:'#333',marginBottom:12}}>AI Credits</div>
                {[
                  ['Monthly allowance', aiCredits?.monthly],
                  ['Used this month', aiCredits?.used],
                  ['Purchased', aiCredits?.purchased],
                  ['Available', aiCredits?.available],
                ].map(([lbl,val])=>(
                  <div key={lbl} style={{display:'flex',justifyContent:'space-between',marginBottom:6,fontSize:12}}>
                    <span style={{color:'#666'}}>{lbl}</span>
                    <span style={{fontWeight:600,color:'#333'}}>{val ?? '—'}</span>
                  </div>
                ))}
                {aiCredits?.reset_at&&<div style={{fontSize:11,color:'#999',marginTop:8}}>Resets: {new Date(aiCredits.reset_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>}
                <button onClick={()=>{setShowCreditsDD(false);setShowSheetSelector(true);}}
                  style={{marginTop:12,width:'100%',background:'#7B6BA4',border:'none',color:'#fff',padding:'8px 0',borderRadius:4,cursor:'pointer',fontSize:12,fontWeight:500}}>
                  Batch AI Assist
                </button>
              </div>
            </>}
          </div>
        </div>
      </div>

      {/* ── Sheet Selector Modal for Batch AI ── */}
      {showSheetSelector&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>{if(!analyzing)setShowSheetSelector(false);}}>
          <div style={{background:'#fff',borderRadius:8,width:520,maxHeight:'80vh',display:'flex',flexDirection:'column',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid #E0E0E0'}}>
              <div style={{fontSize:16,fontWeight:600,color:'#333'}}>AI Assist — Select Sheets</div>
              <div style={{fontSize:12,color:'#999',marginTop:4}}>Select sheets to analyze. Each sheet costs 1 credit.</div>
            </div>
            {/* Quick filters */}
            <div style={{display:'flex',gap:6,padding:'10px 20px',borderBottom:'1px solid #f0f0f0',flexWrap:'wrap'}}>
              <button onClick={()=>setSelectedSheets(new Set(plans.map(p=>p.id)))} style={{fontSize:11,padding:'3px 10px',border:'1px solid #E0E0E0',borderRadius:4,background:'#fff',color:'#333',cursor:'pointer'}}>Select All</button>
              <button onClick={()=>setSelectedSheets(new Set())} style={{fontSize:11,padding:'3px 10px',border:'1px solid #E0E0E0',borderRadius:4,background:'#fff',color:'#333',cursor:'pointer'}}>None</button>
              {['C-','S-','A-','L-','M-'].map(prefix=>(
                <button key={prefix} onClick={()=>setSelectedSheets(new Set(plans.filter(p=>(p.name||'').toUpperCase().startsWith(prefix)).map(p=>p.id)))}
                  style={{fontSize:11,padding:'3px 10px',border:'1px solid #E0E0E0',borderRadius:4,background:'#fff',color:'#666',cursor:'pointer'}}>{prefix}*</button>
              ))}
            </div>
            {/* Sheet list */}
            <div style={{flex:1,overflowY:'auto',padding:'8px 20px'}}>
              {plans.map((p,idx)=>(
                <label key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 0',cursor:'pointer',borderBottom:'1px solid #f8f8f8'}}>
                  <input type="checkbox" checked={selectedSheets.has(p.id)}
                    onChange={()=>setSelectedSheets(prev=>{const n=new Set(prev);n.has(p.id)?n.delete(p.id):n.add(p.id);return n;})}
                    style={{accentColor:'#4CAF50'}}/>
                  <span style={{flex:1,fontSize:13,color:'#333'}}>{p.name||`Sheet ${idx+1}`}</span>
                </label>
              ))}
            </div>
            {/* Footer */}
            <div style={{padding:'12px 20px',borderTop:'1px solid #E0E0E0',display:'flex',alignItems:'center',gap:12}}>
              <div style={{flex:1,fontSize:12}}>
                <span style={{color:'#333',fontWeight:500}}>Selected: {selectedSheets.size} sheets</span>
                <span style={{color:'#999'}}> · Cost: {selectedSheets.size} credits · Remaining: {(aiCredits?.available||0)-selectedSheets.size}</span>
                {selectedSheets.size > (aiCredits?.available||0) && <span style={{color:'#C0504D',fontWeight:500}}> — Not enough credits!</span>}
              </div>
              {aiProgress&&<span style={{fontSize:12,color:'#7B6BA4'}}>Analyzing {aiProgress.current} of {aiProgress.total}...</span>}
              <button onClick={()=>{if(!analyzing)setShowSheetSelector(false);}} disabled={analyzing}
                style={{padding:'8px 14px',border:'1px solid #E0E0E0',borderRadius:4,background:'#fff',color:'#666',cursor:'pointer',fontSize:12}}>Cancel</button>
              <button disabled={!selectedSheets.size || selectedSheets.size>(aiCredits?.available||0) || analyzing}
                onClick={async()=>{
                  const sheetsToAnalyze = plans.filter(p=>selectedSheets.has(p.id));
                  setAnalyzing(true);
                  let totalFound = 0;
                  const costs = getUnitCosts();
                  for(let i=0;i<sheetsToAnalyze.length;i++){
                    setAiProgress({current:i+1,total:sheetsToAnalyze.length});
                    const plan = sheetsToAnalyze[i];
                    const aiItems = await runAISingleSheet(plan);
                    if(aiItems?.length){
                      const toInsert = aiItems.map((it,j)=>{
                        const catDef=TAKEOFF_CATS.find(c=>c.id===it.category)||TAKEOFF_CATS[TAKEOFF_CATS.length-1];
                        const uc=(costs[it.category]?.mat||0)+(costs[it.category]?.lab||0)||catDef.defaultCost;
                        return {project_id:project.id,plan_id:plan.id,category:catDef.id,description:it.description,
                          quantity:it.measurement_type==='count'?(it.estimated_count||0):0,
                          unit:it.unit||catDef.unit,unit_cost:uc,
                          total_cost:it.measurement_type==='count'?(it.estimated_count||0)*uc:0,
                          measurement_type:it.measurement_type||'manual',points:null,
                          color:TO_COLORS[(totalFound+j)%TO_COLORS.length],ai_generated:true,sort_order:items.length+totalFound+j};
                      });
                      const {data}=await supabase.from('takeoff_items').insert(toInsert).select();
                      if(data){setItems(prev=>[...prev,...data]);totalFound+=data.length;}
                    }
                  }
                  setAnalyzing(false);setAiProgress(null);setShowSheetSelector(false);setLeftTab('takeoffs');
                  alert(`Done — found ${totalFound} items across ${sheetsToAnalyze.length} sheets.`);
                }}
                style={{padding:'8px 16px',borderRadius:4,border:'none',background:'#4CAF50',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:500,opacity:(!selectedSheets.size||selectedSheets.size>(aiCredits?.available||0)||analyzing)?0.4:1}}>
                {analyzing?'Analyzing...':'Analyze Selected'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reports View — STACK style ── */}
      {mainView==='reports'&&(()=>{
        const searchL = reportSearch.toLowerCase();
        const reportItems = items.filter(it=>it.plan_id!=null&&(!reportSearch || it.description?.toLowerCase().includes(searchL) || TAKEOFF_CATS.find(c=>c.id===it.category)?.label.toLowerCase().includes(searchL)));
        const sorted = [...reportItems].sort((a,b)=>{
          const col = reportSort.col;
          let av, bv;
          if(col==='description'){ av=a.description||''; bv=b.description||''; }
          else if(col==='category'){ av=TAKEOFF_CATS.find(c=>c.id===a.category)?.label||''; bv=TAKEOFF_CATS.find(c=>c.id===b.category)?.label||''; }
          else if(col==='sheet'){ av=planMap.get(a.plan_id)?.name||''; bv=planMap.get(b.plan_id)?.name||''; }
          else if(col==='quantity'){ av=a.quantity||0; bv=b.quantity||0; }
          else if(col==='unit_cost'){ av=a.unit_cost||0; bv=b.unit_cost||0; }
          else if(col==='total_cost'){ av=a.total_cost||0; bv=b.total_cost||0; }
          else { av=a[col]||''; bv=b[col]||''; }
          if(typeof av==='string') return reportSort.asc ? av.localeCompare(bv) : bv.localeCompare(av);
          return reportSort.asc ? av-bv : bv-av;
        });

        // Grouping
        let grouped = null;
        if(reportGroupBy==='category'){
          grouped = {};
          sorted.forEach(it=>{const k=TAKEOFF_CATS.find(c=>c.id===it.category)?.label||'Other';if(!grouped[k])grouped[k]=[];grouped[k].push(it);});
        } else if(reportGroupBy==='sheet'){
          grouped = {};
          sorted.forEach(it=>{const k=planMap.get(it.plan_id)?.name||'Unassigned';if(!grouped[k])grouped[k]=[];grouped[k].push(it);});
        } else if(reportGroupBy==='type'){
          grouped = {};
          sorted.forEach(it=>{const k=(it.measurement_type||'other').replace(/^\w/,c=>c.toUpperCase());if(!grouped[k])grouped[k]=[];grouped[k].push(it);});
        }

        const fmtQty = (it) => {
          const {qty:q, unit:u} = getDisplayQtyUnit(it);
          if(q<=0) return '—';
          const uLabel = {SF:'Sq Ft',LF:'Ln Ft',EA:'EA',CY:'Cu Yd'}[u]||u;
          return `${q.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${uLabel}`;
        };

        const sortCol = (col) => setReportSort(prev=>({col,asc:prev.col===col?!prev.asc:true}));
        const sortArrow = (col) => reportSort.col===col ? (reportSort.asc?' ▲':' ▼') : '';

        const reportTitles = {
          takeoff_quantity:'Takeoff Quantity', takeoff_summary:'Takeoff Summary',
          measurements_by_takeoff:'Measurements By Takeoff', item_list:'Item List',
          item_cost:'Item Cost', item_cost_by_type:'Item Cost By Type',
          item_cost_by_takeoff:'Item Cost By Takeoff',
        };

        const visibleCols = Object.entries(reportCols).filter(([,v])=>v).length;

        const hdrStyle = {fontSize:12,fontWeight:700,color:'#fff',cursor:'pointer',userSelect:'none',padding:'10px 12px',textAlign:'left',whiteSpace:'nowrap',background:'#4CAF50',borderBottom:'none'};
        const cellStyle = {fontSize:13,color:'#333',padding:'10px 12px',borderBottom:'1px solid #E0E0E0',whiteSpace:'nowrap',verticalAlign:'middle'};

        const doExport = (type) => {
          const header = ['Takeoff Name','Description','Quantity','Unit','Scale','Location','Revision','Trade','Unit Cost','Total Cost'].join(',');
          const rows = sorted.map(it=>[
            `"${(it.description||'').replace(/"/g,'""')}"`,
            `"${(it.notes||'').replace(/"/g,'""')}"`,
            it.quantity||0, it.unit||'',
            `"${scaleLabel(planMap.get(it.plan_id)?.scale_px_per_ft, '')}"`,
            '','','',
            it.unit_cost||0, it.total_cost||0
          ].join(','));
          const csv = [header,...rows].join('\n');
          const blob = new Blob([csv],{type:'text/csv'});
          const a = document.createElement('a');
          a.href=URL.createObjectURL(blob);
          a.download=`${project.name}_${reportType}.${type==='excel'?'csv':'csv'}`;
          a.click();
        };

        // Render a table of rows (used for both flat and grouped)
        const renderRows = (rowItems, startIdx=0) => rowItems.map((it,idx)=>{
          const cat = TAKEOFF_CATS.find(c=>c.id===it.category);
          const sheetName = planMap.get(it.plan_id)?.name||'—';
          const planScale = planMap.get(it.plan_id)?.scale_px_per_ft;
          return(
            <tr key={it.id}
              onMouseEnter={e=>e.currentTarget.style.background='#fafafa'}
              onMouseLeave={e=>e.currentTarget.style.background='#fff'}
              style={{background:'#fff'}}>
              {reportCols.name&&<td style={cellStyle}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:10,height:10,borderRadius:2,background:it.color||cat?.color||'#888',flexShrink:0}}/>
                  <span>{it.description||'Unnamed'}</span>
                </div>
              </td>}
              {reportCols.description&&<td style={{...cellStyle,color:'#666',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis'}}>{it.notes||'—'}</td>}
              {reportCols.quantity&&<td style={{...cellStyle,textAlign:'right',fontWeight:500}}>{fmtQty(it)}</td>}
              {reportCols.unit&&<td style={{...cellStyle,textAlign:'center',color:'#666'}}>{getDisplayQtyUnit(it).unit||'—'}</td>}
              {reportCols.scale&&<td style={{...cellStyle,color:'#666',fontSize:12}}>{planScale?scaleLabel(planScale,''):'—'}</td>}
              {reportCols.location&&<td style={{...cellStyle,color:'#999'}}>—</td>}
              {reportCols.revision&&<td style={{...cellStyle,color:'#999'}}>—</td>}
              {reportCols.trade&&<td style={{...cellStyle,color:'#999'}}>—</td>}
              {(reportType==='item_cost'||reportType==='item_cost_by_type'||reportType==='item_cost_by_takeoff')&&reportCols.unit_cost&&
                <td style={{...cellStyle,textAlign:'right',color:'#666'}}>{(it.unit_cost||0)>0?`$${Number(it.unit_cost).toFixed(2)}`:'—'}</td>}
              {(reportType==='item_cost'||reportType==='item_cost_by_type'||reportType==='item_cost_by_takeoff')&&reportCols.total_cost&&
                <td style={{...cellStyle,textAlign:'right',fontWeight:600,color:'#4CAF50'}}>{(it.total_cost||0)>0?`$${Math.round(it.total_cost).toLocaleString()}`:'—'}</td>}
              <td style={{...cellStyle,textAlign:'center',width:36}}>
                <button onClick={()=>{setEditItem(it);setMainView('workspace');}} style={{background:'none',border:'none',color:'#999',cursor:'pointer',fontSize:12}} title="Edit">&#9998;</button>
              </td>
            </tr>
          );
        });

        const isCostReport = reportType==='item_cost'||reportType==='item_cost_by_type'||reportType==='item_cost_by_takeoff';

        return(
        <div style={{flex:1,display:'flex',overflow:'hidden',background:'#fff'}}>

          {/* ── Left Sidebar — Report Navigation ── */}
          <div style={{width:220,flexShrink:0,borderRight:'1px solid #E0E0E0',display:'flex',flexDirection:'column',background:'#fff',overflowY:'auto'}}>
            <div style={{padding:'16px 16px 8px',fontSize:11,fontWeight:700,color:'#999',letterSpacing:0.5}}>Takeoff Reports</div>
            {[
              {id:'takeoff_quantity',label:'Takeoff Quantity'},
              {id:'takeoff_summary',label:'Takeoff Summary'},
              {id:'measurements_by_takeoff',label:'Measurements By Takeoff'},
              {id:'item_list',label:'Item List'},
              {id:'item_cost',label:'Item Cost'},
              {id:'item_cost_by_type',label:'Item Cost By Type'},
              {id:'item_cost_by_takeoff',label:'Item Cost By Takeoff'},
            ].map(r=>(
              <button key={r.id} onClick={()=>setReportType(r.id)}
                style={{display:'block',width:'100%',textAlign:'left',padding:'8px 16px',border:'none',background:reportType===r.id?'#f5f5f5':'transparent',
                  color:reportType===r.id?'#4CAF50':'#666',fontWeight:reportType===r.id?600:400,fontSize:13,cursor:'pointer'}}>
                {r.label}
              </button>
            ))}
            <div style={{height:1,background:'#E0E0E0',margin:'12px 16px'}}/>
            <div style={{padding:'4px 16px 8px',fontSize:11,fontWeight:700,color:'#999',letterSpacing:0.5}}>Estimate Reports</div>
            <button style={{display:'block',width:'100%',textAlign:'left',padding:'8px 16px',border:'none',background:'transparent',color:'#ccc',fontSize:13,cursor:'default'}}>Coming soon</button>
            <div style={{height:1,background:'#E0E0E0',margin:'12px 16px'}}/>
            <div style={{padding:'4px 16px 8px',fontSize:11,fontWeight:700,color:'#999',letterSpacing:0.5}}>Snapshots</div>
            <div style={{padding:'4px 16px',fontSize:12,color:'#ccc',fontStyle:'italic'}}>No snapshots yet</div>
          </div>

          {/* ── Main Content ── */}
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

            {/* Report Header */}
            <div style={{display:'flex',alignItems:'center',gap:12,padding:'16px 24px',borderBottom:'1px solid #E0E0E0',flexShrink:0}}>
              <div style={{flex:1}}>
                <div style={{fontSize:18,fontWeight:600,color:'#333'}}>{reportTitles[reportType]||'Report'}</div>
                <div style={{fontSize:12,color:'#999',marginTop:2}}>Generated on: {new Date().toLocaleString()}</div>
              </div>
              <button onClick={()=>window.print()}
                style={{background:'#fff',border:'1px solid #E0E0E0',color:'#666',padding:'7px 14px',borderRadius:4,cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:4}}>
                Print &#9662;
              </button>
              <div style={{position:'relative'}}>
                <button onClick={()=>{
                  const dd=document.getElementById('exportDD');
                  if(dd) dd.style.display=dd.style.display==='none'?'block':'none';
                }}
                  style={{background:'#fff',border:'1px solid #E0E0E0',color:'#666',padding:'7px 14px',borderRadius:4,cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:4}}>
                  Export &#9662;
                </button>
                <div id="exportDD" style={{display:'none',position:'absolute',top:'100%',right:0,zIndex:50,marginTop:4,background:'#fff',border:'1px solid #E0E0E0',borderRadius:4,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',minWidth:180,overflow:'hidden'}}>
                  <button onClick={()=>{doExport('excel');document.getElementById('exportDD').style.display='none';}}
                    style={{display:'block',width:'100%',textAlign:'left',padding:'10px 14px',border:'none',background:'#fff',color:'#333',fontSize:12,cursor:'pointer',borderBottom:'1px solid #f0f0f0'}}>
                    Excel (Visible Data)
                  </button>
                  <button onClick={()=>{doExport('csv');document.getElementById('exportDD').style.display='none';}}
                    style={{display:'block',width:'100%',textAlign:'left',padding:'10px 14px',border:'none',background:'#fff',color:'#333',fontSize:12,cursor:'pointer'}}>
                    CSV (All Data)
                  </button>
                </div>
              </div>
            </div>

            {/* Toolbar Row */}
            <div style={{display:'flex',gap:8,padding:'10px 24px',borderBottom:'1px solid #E0E0E0',flexShrink:0,flexWrap:'wrap',alignItems:'center'}}>
              {/* Columns toggle */}
              <div style={{position:'relative'}}>
                <button onClick={()=>setShowColDropdown(p=>!p)}
                  style={{background:'#fff',border:'1px solid #E0E0E0',color:'#666',padding:'5px 12px',borderRadius:4,cursor:'pointer',fontSize:12}}>
                  Columns ({visibleCols}) &#9662;
                </button>
                {showColDropdown&&<>
                  <div style={{position:'fixed',inset:0,zIndex:49}} onClick={()=>setShowColDropdown(false)}/>
                  <div style={{position:'absolute',top:'100%',left:0,zIndex:50,marginTop:4,background:'#fff',border:'1px solid #E0E0E0',borderRadius:4,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:'8px 0',minWidth:180}}>
                    {Object.entries(reportCols).map(([key,val])=>(
                      <label key={key} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 14px',cursor:'pointer',fontSize:12,color:'#333'}}>
                        <input type="checkbox" checked={val} onChange={()=>setReportCols(prev=>({...prev,[key]:!prev[key]}))} style={{accentColor:'#4CAF50'}}/>
                        {key.replace(/_/g,' ').replace(/^\w/,c=>c.toUpperCase())}
                      </label>
                    ))}
                  </div>
                </>}
              </div>
              {/* Groupings */}
              <select value={reportGroupBy} onChange={e=>setReportGroupBy(e.target.value)}
                style={{background:'#fff',border:'1px solid #E0E0E0',color:'#666',padding:'5px 12px',borderRadius:4,cursor:'pointer',fontSize:12,outline:'none'}}>
                <option value="none">No grouping</option>
                <option value="category">Group by Category</option>
                <option value="sheet">Group by Sheet</option>
                <option value="type">Group by Type</option>
              </select>
              {/* Search */}
              <input value={reportSearch} onChange={e=>setReportSearch(e.target.value)}
                placeholder="Filter..."
                style={{padding:'5px 12px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:12,color:'#333',background:'#fff',outline:'none',width:180}}/>
              <button onClick={()=>{setReportSearch('');setReportGroupBy('none');setReportSort({col:'description',asc:true});setReportCols({name:true,description:true,quantity:true,unit:true,scale:true,location:true,revision:true,trade:true,unit_cost:true,total_cost:true});}}
                style={{background:'#fff',border:'1px solid #E0E0E0',color:'#999',padding:'5px 12px',borderRadius:4,cursor:'pointer',fontSize:12}}>
                Reset
              </button>
              <div style={{flex:1}}/>
              <span style={{fontSize:12,color:'#999'}}>{sorted.length} items</span>
            </div>

            {/* Data Table */}
            <div style={{flex:1,overflowY:'auto',overflowX:'auto',background:'#fff'}}>
              {(reportType==='takeoff_quantity'||reportType==='takeoff_summary'||reportType==='item_list'||reportType==='item_cost'||reportType==='item_cost_by_type'||reportType==='item_cost_by_takeoff'||reportType==='measurements_by_takeoff')?(
              <table style={{width:'100%',borderCollapse:'collapse',minWidth:800}}>
                <thead style={{position:'sticky',top:0,zIndex:2}}>
                  <tr>
                    {reportCols.name&&<th onClick={()=>sortCol('description')} style={hdrStyle}>Takeoff Name{sortArrow('description')}</th>}
                    {reportCols.description&&<th style={hdrStyle}>Description</th>}
                    {reportCols.quantity&&<th onClick={()=>sortCol('quantity')} style={{...hdrStyle,textAlign:'right'}}>Quantity{sortArrow('quantity')}</th>}
                    {reportCols.unit&&<th style={{...hdrStyle,textAlign:'center'}}>Unit</th>}
                    {reportCols.scale&&<th style={hdrStyle}>Scale</th>}
                    {reportCols.location&&<th style={hdrStyle}>Location</th>}
                    {reportCols.revision&&<th style={hdrStyle}>Revision</th>}
                    {reportCols.trade&&<th style={hdrStyle}>Trade</th>}
                    {isCostReport&&reportCols.unit_cost&&<th onClick={()=>sortCol('unit_cost')} style={{...hdrStyle,textAlign:'right'}}>Unit Cost{sortArrow('unit_cost')}</th>}
                    {isCostReport&&reportCols.total_cost&&<th onClick={()=>sortCol('total_cost')} style={{...hdrStyle,textAlign:'right'}}>Total{sortArrow('total_cost')}</th>}
                    <th style={{...hdrStyle,width:36}}/>
                  </tr>
                </thead>
                <tbody>
                  {grouped ? Object.entries(grouped).map(([groupName,groupItems])=>(
                    <React.Fragment key={groupName}>
                      <tr><td colSpan={20} style={{background:'#f5f5f5',padding:'8px 12px',fontSize:13,fontWeight:600,color:'#333',borderBottom:'1px solid #E0E0E0'}}>{groupName} ({groupItems.length})</td></tr>
                      {renderRows(groupItems)}
                    </React.Fragment>
                  )) : renderRows(sorted)}
                </tbody>
                {sorted.length>0&&!grouped&&(
                  <tfoot>
                    <tr style={{background:'#f5f5f5'}}>
                      {reportCols.name&&<td style={{...cellStyle,fontWeight:700,borderBottom:'none'}}>Totals ({sorted.length})</td>}
                      {reportCols.description&&<td style={{...cellStyle,borderBottom:'none'}}/>}
                      {reportCols.quantity&&<td style={{...cellStyle,textAlign:'right',fontWeight:700,borderBottom:'none'}}>{sorted.reduce((s,i)=>s+(i.quantity||0),0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>}
                      {reportCols.unit&&<td style={{...cellStyle,borderBottom:'none'}}/>}
                      {reportCols.scale&&<td style={{...cellStyle,borderBottom:'none'}}/>}
                      {reportCols.location&&<td style={{...cellStyle,borderBottom:'none'}}/>}
                      {reportCols.revision&&<td style={{...cellStyle,borderBottom:'none'}}/>}
                      {reportCols.trade&&<td style={{...cellStyle,borderBottom:'none'}}/>}
                      {isCostReport&&reportCols.unit_cost&&<td style={{...cellStyle,borderBottom:'none'}}/>}
                      {isCostReport&&reportCols.total_cost&&<td style={{...cellStyle,textAlign:'right',fontWeight:700,color:'#4CAF50',fontSize:14,borderBottom:'none'}}>${Math.round(sorted.reduce((s,i)=>s+(i.total_cost||0),0)).toLocaleString()}</td>}
                      <td style={{...cellStyle,borderBottom:'none'}}/>
                    </tr>
                  </tfoot>
                )}
              </table>
              ):(
                <div style={{textAlign:'center',padding:80,color:'#999',fontSize:14}}>Coming soon</div>
              )}
              {sorted.length===0&&(
                <div style={{textAlign:'center',padding:'60px 20px',color:'#999',fontSize:13}}>
                  {reportSearch?'No takeoffs match your filter.':'No takeoff items yet. Draw measurements on plans to populate this report.'}
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Main Body (Workspace) ── */}
      {mainView==='workspace'&&<div style={{display:'flex',flex:1,overflow:'hidden'}}>

        {/* ── Left Panel ── */}
        <div style={{width:280,flexShrink:0,display:'flex',flexDirection:'column',borderRight:`1px solid ${t.border}`,background:t.bg2,overflow:'hidden'}}>

          {/* Left panel tab strip */}
          <div style={{display:'flex',alignItems:'stretch',borderBottom:`1px solid ${t.border}`,flexShrink:0,height:36}}>
            {[['plans','Plans'],['takeoffs','Takeoffs'],['library','Library']].map(([id,lbl])=>(
              <button key={id} onClick={()=>setLeftTab(id)}
                style={{flex:1,height:'100%',border:'none',background:'none',cursor:'pointer',
                  fontSize:13,fontWeight:leftTab===id?600:400,
                  color:leftTab===id?'#4CAF50':t.text4,
                  borderBottom:leftTab===id?'2px solid #4CAF50':'2px solid transparent',
                  boxSizing:'border-box',transition:'color 0.15s'}}>
                {lbl}
              </button>
            ))}
            <button onClick={()=>setLeftTab('settings')}
              title="Settings"
              style={{width:38,height:'100%',border:'none',background:'none',cursor:'pointer',
                color:leftTab==='settings'?'#4CAF50':t.text4,fontSize:14,flexShrink:0,
                borderBottom:leftTab==='settings'?'2px solid #4CAF50':'2px solid transparent',
                boxSizing:'border-box'}}>⚙</button>
          </div>

          {/* ── PLANS tab ── STACK-style folder tree */}
          {leftTab==='plans'&&(
            <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

              {/* Toolbar: New Folder | Upload | Name All | Filter */}
              <div style={{padding:'8px',borderBottom:`1px solid ${t.border}`,flexShrink:0,display:'flex',gap:5}}>
                <button onClick={()=>{
                  const n=window.prompt('Folder name:','');
                  if(!n?.trim()) return;
                  const fid='folder_'+Date.now();
                  savePlanSets({...planSets,[fid]:{name:n.trim(),planIds:[],collapsed:false}});
                }} style={{padding:'6px 8px',borderRadius:6,border:`1px solid ${t.border}`,background:'none',color:t.text3,cursor:'pointer',fontSize:11,fontWeight:600,display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
                  📁 New
                </button>
                <button onClick={()=>{ setUploadTargetFolder(null); fileRef.current?.click(); }} disabled={!!uploading}
                  style={{flex:1,background:uploading&&uploading.startsWith('✓')?'#4CAF50':uploading?'#6B7280':'#4CAF50',border:'none',color:'#fff',padding:'6px 0',borderRadius:6,cursor:'pointer',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',gap:5,transition:'background 0.2s'}}>
                  {uploading
                    ? uploading.startsWith('✓')
                      ? <>{uploading}</>
                      : <><span style={{animation:'spin 0.8s linear infinite',display:'inline-block'}}>◌</span> {uploading}</>
                    : <>＋ Upload</>}
                </button>
                <button disabled={namingAll||plans.length===0} onClick={async()=>{
                  setNamingAll(true);
                  const realPlans=plans.filter(p=>p.id!=='preview');
                  let fromText=0, fromAI=0;
                  for(const p of realPlans){
                    try{
                      // Try free text parsing first
                      const textName = parseSheetNameFromText(p.ocr_text||'', p.text_positions);
                      if(textName && textName.length > 2 && textName !== p.name){
                        await supabase.from('precon_plans').update({name:textName}).eq('id',p.id);
                        setPlans(prev=>prev.map(x=>x.id===p.id?{...x,name:textName}:x));
                        if(selPlan?.id===p.id) setSelPlan(prev=>({...prev,name:textName}));
                        fromText++;
                        continue;
                      }
                      // AI fallback
                      const aiName=await aiNameSheet(p.file_url,p.name||'Sheet');
                      if(aiName&&aiName!==p.name){
                        await supabase.from('precon_plans').update({name:aiName}).eq('id',p.id);
                        setPlans(prev=>prev.map(x=>x.id===p.id?{...x,name:aiName}:x));
                        if(selPlan?.id===p.id) setSelPlan(prev=>({...prev,name:aiName}));
                        fromAI++;
                      }
                    }catch(e){ console.error('naming failed',p.id,e); }
                  }
                  console.log(`[Name All] ${fromText} from text, ${fromAI} from AI`);
                  setNamingAll(false);
                }} style={{padding:'6px 8px',borderRadius:6,border:'1px solid rgba(168,85,247,0.4)',background:'rgba(168,85,247,0.08)',color:'#7B6BA4',cursor:'pointer',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:3,flexShrink:0}}>
                  {namingAll?<span style={{animation:'spin 0.8s linear infinite',display:'inline-block'}}>◌</span>:'✦'}
                </button>
                <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{display:'none'}} onChange={e=>handleUpload(e.target.files[0])}/>
              </div>

              {/* Filter strip */}
              <div style={{display:'flex',borderBottom:`1px solid ${t.border}`,flexShrink:0}}>
                {[['all','All'],['marked','Marked']].map(([val,lbl])=>{
                  const markedCount = val==='marked' ? planMarkedSet.size : plans.length;
                  const active = plansFilter===val;
                  return(
                    <button key={val} onClick={()=>setPlansFilter(val)}
                      style={{flex:1,padding:'5px 0',border:'none',borderBottom:active?`2px solid #4CAF50`:'2px solid transparent',
                        background:'none',color:active?'#4CAF50':t.text4,cursor:'pointer',fontSize:10,fontWeight:active?700:400,
                        display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
                      {lbl}
                      <span style={{fontSize:9,background:active?'rgba(16,185,129,0.15)':t.bg3,color:active?'#4CAF50':t.text4,
                        borderRadius:8,padding:'1px 5px',fontVariantNumeric:'tabular-nums'}}>
                        {markedCount}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Plan search */}
              <div style={{padding:'4px 6px',borderBottom:`1px solid ${t.border}`,flexShrink:0}}>
                <input
                  type="text"
                  value={planSearch}
                  onChange={e=>setPlanSearch(e.target.value)}
                  placeholder="Search sheet names and content..."
                  style={{width:'100%',padding:'4px 8px',fontSize:10,border:`1px solid ${t.border}`,borderRadius:4,background:t.bg,color:t.text,outline:'none',boxSizing:'border-box'}}
                />
                {planSearch.trim()&&<div style={{fontSize:9,color:t.text4,marginTop:3}}>{visiblePlans.length} of {plans.length} sheets match</div>}
              </div>

              {/* Folder tree */}
              <div style={{flex:1,overflowY:'auto',padding:'6px 4px'}}>
                {plans.length===0&&Object.keys(planSets).length===0&&(
                  <div style={{textAlign:'center',padding:'40px 12px',color:t.text4,fontSize:11,lineHeight:2}}>
                    Create a folder and upload plans<br/>or upload directly
                  </div>
                )}
                {plansFilter==='marked'&&plans.length>0&&planMarkedSet.size===0&&(
                  <div style={{textAlign:'center',padding:'32px 12px',color:t.text4,fontSize:11,lineHeight:1.8}}>
                    No plans with takeoffs yet.<br/>
                    <span style={{fontSize:10,color:t.text4}}>Draw measurements on a plan to mark it.</span>
                  </div>
                )}
                {(()=>{
                  const visibleSet = new Set(visiblePlans.map(p=>p.id));
                  const assignedIds=new Set(Object.values(planSets).flatMap(s=>s.planIds||[]));
                  const ungrouped=visiblePlans.filter(p=>!assignedIds.has(p.id));
                  const folderEntries=Object.entries(planSets);

                  const renderPlanRow = (p, folderId) => (
                    <PlanRow key={p.id} p={p} folderId={folderId}
                      cnt={planItemCountMap.get(p.id)||0}
                      isMarked={planMarkedSet.has(p.id)}
                      isActive={selPlan?.id===p.id}
                      isOpen={openTabs.includes(p.id)}
                      dragOverId={planDragOver}
                      handlersRef={planHandlersRef}
                      searchQuery={planSearch.trim()||null}/>
                  );

                  const FolderRow=([folderId,folder])=>{
                    const folderPlans=(folder.planIds||[]).map(id=>visibleSet.has(id)?visiblePlans.find(p=>p.id===id):null).filter(Boolean);
                    if(plansFilter==='marked' && folderPlans.length===0) return null;
                    const collapsed=folder.collapsed;
                    return(
                      <div key={folderId} style={{marginBottom:4}}>
                        <div style={{display:'flex',alignItems:'center',gap:5,padding:'5px 6px',borderRadius:5,
                          background:t.bg3,border:`1px solid ${t.border}`,cursor:'pointer',userSelect:'none'}}
                          onClick={()=>savePlanSets({...planSets,[folderId]:{...folder,collapsed:!collapsed}})}>
                          <span style={{fontSize:9,color:t.text4,width:10,flexShrink:0}}>{collapsed?'▶':'▼'}</span>
                          <span style={{fontSize:13,flexShrink:0}}>📁</span>
                          <span style={{fontSize:11,fontWeight:600,color:t.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{folder.name||'Folder'}</span>
                          <span style={{fontSize:9,color:t.text4,flexShrink:0}}>{folderPlans.length}</span>
                          <div style={{display:'flex',gap:3,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                            <button onClick={()=>{
                              setUploadTargetFolder(folderId);
                              setTimeout(()=>fileRef.current?.click(),50);
                            }} style={{fontSize:9,padding:'2px 5px',borderRadius:3,border:`1px solid ${t.border}`,background:'none',color:'#4CAF50',cursor:'pointer',fontWeight:700}} title="Upload into this folder">＋</button>
                            <button onClick={async()=>{
                              for(const p of folderPlans){
                                if(p.id==='preview') continue;
                                const aiName=await aiNameSheet(p.file_url,p.name||'Sheet');
                                if(aiName&&aiName!==p.name){
                                  await supabase.from('precon_plans').update({name:aiName}).eq('id',p.id);
                                  setPlans(prev=>prev.map(x=>x.id===p.id?{...x,name:aiName}:x));
                                  if(selPlan?.id===p.id) setSelPlan(prev=>({...prev,name:aiName}));
                                }
                              }
                            }} style={{fontSize:9,padding:'2px 4px',borderRadius:3,border:'1px solid rgba(168,85,247,0.3)',background:'none',color:'#7B6BA4',cursor:'pointer'}} title="AI name all in folder">✦</button>
                            <button onClick={()=>{
                              const n=window.prompt('Rename folder:',folder.name||'');
                              if(n?.trim()) savePlanSets({...planSets,[folderId]:{...folder,name:n.trim()}});
                            }} style={{fontSize:9,padding:'2px 4px',borderRadius:3,border:`1px solid ${t.border}`,background:'none',color:t.text4,cursor:'pointer'}}>✎</button>
                            <button onClick={()=>{
                              if(folderPlans.length&&!window.confirm('Delete folder and all its sheets?')) return;
                              const updated={...planSets};
                              delete updated[folderId];
                              savePlanSets(updated);
                            }} style={{fontSize:9,padding:'2px 4px',borderRadius:3,border:'1px solid rgba(239,68,68,0.25)',background:'none',color:'#C0504D',cursor:'pointer'}}>✕</button>
                          </div>
                        </div>
                        {!collapsed&&(
                          <div style={{marginTop:1}}>
                            {folderPlans.map(p=>renderPlanRow(p, folderId))}
                            {folderPlans.length===0&&(
                              <div style={{padding:'8px 20px',fontSize:10,color:t.text4,fontStyle:'italic'}}>Empty — click ＋ to upload here</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  };

                  return(<>
                    {folderEntries.map(FolderRow)}
                    {ungrouped.length>0&&(
                      <div style={{marginTop:folderEntries.length?8:0}}>
                        {folderEntries.length>0&&<div style={{fontSize:9,color:t.text4,padding:'2px 4px 4px',letterSpacing:0.5}}>UNSORTED</div>}
                        {ungrouped.map(p=>renderPlanRow(p, null))}
                      </div>
                    )}
                  </>);
                })()}
              </div>
            </div>
          )}
          {/* ── TAKEOFFS tab ── Stack-style */}
          {leftTab==='takeoffs'&&(()=>{
            const activeCond = itemsRef.current.find(i=>String(i.id)===String(activeCondId));
            const armItem = (item) => {
              if(!scale){
                alert('Set the scale before drawing takeoffs. Use the green "Set Scale" button on the plan.');
                setShowScalePanel(true);
                return;
              }
              // If this item has siblings, prefer the one matching the current plan
              const target = (item._siblings && selPlan)
                ? (item._siblings.find(s=>s.id!==undefined && s.plan_id===selPlan.id) || item)
                : item;
              setActiveCondId(target.id);
              setTool(target.measurement_type==='area'?'area':target.measurement_type==='linear'?'linear':target.measurement_type==='count'?'count':'select');
              setActivePts([]); setEditItem(null); setTakeoffStep(null);
            };
            const disarm = () => { setActiveCondId(null); setTool('select'); setActivePts([]); };
            const resetFlow = () => { setTakeoffStep(null); setNewTOType(null); setNewTOName(''); setNewTODesc(''); setNewTOColor('#4CAF50'); setNewTOCat('other'); setNewTOSize('medium'); };

            // ── STEP: TYPE SELECTOR ──────────────────────────────────────
            if(takeoffStep==='type') return(
              <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                <div style={{padding:'12px 14px 8px',borderBottom:`1px solid ${t.border}`,flexShrink:0,display:'flex',alignItems:'center',gap:8}}>
                  <button onClick={resetFlow} style={{background:'none',border:'none',color:t.text4,cursor:'pointer',fontSize:13,padding:'2px 4px'}}>←</button>
                  <span style={{fontSize:13,fontWeight:700,color:t.text}}>New Takeoff</span>
                </div>
                <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
                  {TAKEOFF_TYPES.map(tt=>(
                    <div key={tt.id} onClick={()=>{setNewTOType(tt);setNewTOColor(tt.color);setNewTOCat(tt.id==='vol2d'||tt.id==='vol3d'?'foundations':tt.mt==='area'?'flatwork':tt.mt==='linear'?'curb_gutter':'other');setTakeoffStep('create');}}
                      style={{display:'flex',alignItems:'flex-start',gap:12,padding:'10px 14px',cursor:'pointer',
                        borderBottom:`1px solid ${t.border}`}}
                      onMouseEnter={e=>e.currentTarget.style.background=t.bg3}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div style={{width:28,height:28,borderRadius:5,background:tt.color,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>
                        <span style={{fontSize:tt.icon.length>1?9:14,fontWeight:800,color:'#fff'}}>{tt.icon}</span>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:t.text,marginBottom:2}}>{tt.label}</div>
                        <div style={{fontSize:11,color:t.text4,lineHeight:1.4}}>{tt.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );

            // ── STEP: CREATE (name + desc) ────────────────────────────────
            if(takeoffStep==='create') return(
              <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                <div style={{padding:'10px 14px',borderBottom:`1px solid ${t.border}`,flexShrink:0,display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:22,height:22,borderRadius:4,background:newTOType?.color||'#4CAF50',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <span style={{fontSize:newTOType?.icon?.length>1?8:12,fontWeight:800,color:'#fff'}}>{newTOType?.icon}</span>
                  </div>
                  <span style={{fontSize:13,fontWeight:700,color:t.text,flex:1}}>Create New {newTOType?.label} Takeoff</span>
                </div>
                <div style={{flex:1,overflowY:'auto',padding:'16px 14px'}}>
                  <div style={{marginBottom:14}}>
                    <label style={{fontSize:11,fontWeight:600,color:t.text3,display:'block',marginBottom:5}}>Takeoff Name</label>
                    <input autoFocus value={newTOName} onChange={e=>setNewTOName(e.target.value)}
                      onKeyDown={e=>e.key==='Enter'&&newTOName.trim()&&setTakeoffStep('settings')}
                      style={{width:'100%',padding:'8px 10px',border:`1px solid ${t.border2}`,borderRadius:6,
                        fontSize:13,color:t.text,background:t.bg,outline:'none',boxSizing:'border-box',
                        transition:'border-color 0.15s'}}
                      onFocus={e=>e.target.style.borderColor='#4CAF50'}
                      onBlur={e=>e.target.style.borderColor=t.border2}
                    />
                  </div>
                  <div style={{marginBottom:20}}>
                    <label style={{fontSize:11,fontWeight:600,color:t.text3,display:'block',marginBottom:5}}>Description <span style={{fontWeight:400,color:t.text4}}>(optional)</span></label>
                    <textarea value={newTODesc} onChange={e=>setNewTODesc(e.target.value)}
                      rows={3}
                      style={{width:'100%',padding:'8px 10px',border:`1px solid ${t.border2}`,borderRadius:6,
                        fontSize:12,color:t.text,background:t.bg,outline:'none',resize:'vertical',boxSizing:'border-box',fontFamily:'inherit'}}
                      onFocus={e=>e.target.style.borderColor='#4CAF50'}
                      onBlur={e=>e.target.style.borderColor=t.border2}
                    />
                  </div>
                  {/* Yellow info card like Stack */}
                  <div style={{marginBottom:14}}>
                    <label style={{fontSize:11,fontWeight:600,color:t.text3,display:'block',marginBottom:5}}>Category</label>
                    <select value={newTOCat} onChange={e=>{setNewTOCat(e.target.value);const c=TAKEOFF_CATS.find(x=>x.id===e.target.value);if(c)setNewTOColor(c.color);}}
                      style={{width:'100%',padding:'8px 10px',border:`1px solid ${t.border2}`,borderRadius:6,
                        fontSize:12,color:t.text,background:t.bg,outline:'none',boxSizing:'border-box',cursor:'pointer'}}>
                      {TAKEOFF_CATS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div style={{background:'#FEF9C3',border:'1px solid #FDE047',borderRadius:6,padding:'10px 12px',marginBottom:20}}>
                    <div style={{fontSize:12,fontWeight:700,color:'#713F12',marginBottom:4}}>{newTOType?.label}</div>
                    <div style={{fontSize:11,color:'#854D0E',lineHeight:1.5}}>{newTOType?.desc}</div>
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button onClick={()=>{if(!scale){alert('Set the scale before creating takeoffs.');setShowScalePanel(true);return;}setTakeoffStep('type');}}
                      style={{flex:1,padding:'8px 0',border:`1px solid ${t.border2}`,background:t.bg,color:t.text3,
                        borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>
                      ← Takeoffs
                    </button>
                    <button onClick={()=>newTOName.trim()&&setTakeoffStep('settings')}
                      style={{flex:2,padding:'8px 0',border:'none',
                        background:newTOName.trim()?'#4CAF50':'#ccc',color:'#fff',
                        borderRadius:6,cursor:newTOName.trim()?'pointer':'not-allowed',fontSize:12,fontWeight:700}}>
                      Create Takeoff
                    </button>
                  </div>
                </div>
              </div>
            );

            // ── STEP: SETTINGS (appearance + start measuring) ─────────────
            if(takeoffStep==='settings') return(
              <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                <div style={{padding:'10px 14px',borderBottom:`1px solid ${t.border}`,flexShrink:0,display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:22,height:22,borderRadius:4,background:newTOColor,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <span style={{fontSize:newTOType?.icon?.length>1?8:12,fontWeight:800,color:'#fff'}}>{newTOType?.icon}</span>
                  </div>
                  <span style={{fontSize:13,fontWeight:700,color:t.text,flex:1}}>{newTOType?.label} Settings</span>
                </div>
                <div style={{flex:1,overflowY:'auto',padding:'14px 14px'}}>
                  <div style={{marginBottom:14}}>
                    <label style={{fontSize:11,fontWeight:600,color:t.text3,display:'block',marginBottom:5}}>Takeoff Name</label>
                    <input value={newTOName} onChange={e=>setNewTOName(e.target.value)}
                      style={{width:'100%',padding:'7px 10px',border:`1px solid ${t.border2}`,borderRadius:6,
                        fontSize:13,color:t.text,background:t.bg,outline:'none',boxSizing:'border-box'}}/>
                  </div>

                  <div style={{height:1,background:t.border,margin:'12px 0'}}/>
                  <div style={{fontSize:12,fontWeight:700,color:t.text,marginBottom:10,display:'flex',alignItems:'center',gap:6}}>
                    <span>Appearance</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                    <div>
                      <div style={{fontSize:10,color:t.text4,marginBottom:5}}>Line Color</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                        {TO_COLORS.map(c=>(
                          <button key={c} onClick={()=>setNewTOColor(c)}
                            style={{width:20,height:20,borderRadius:4,background:c,border:newTOColor===c?`2px solid ${t.text}`:'2px solid transparent',cursor:'pointer',padding:0,flexShrink:0}}/>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:t.text4,marginBottom:5}}>Line Size</div>
                      <div style={{display:'flex',gap:4}}>
                        {[['sm','Thin'],['medium','Medium'],['lg','Thick']].map(([id,lbl])=>(
                          <button key={id} onClick={()=>setNewTOSize(id)}
                            style={{flex:1,padding:'4px 0',fontSize:9,fontWeight:600,border:`1px solid ${newTOSize===id?newTOColor:t.border}`,
                              background:newTOSize===id?newTOColor+'20':'transparent',color:newTOSize===id?newTOColor:t.text4,
                              borderRadius:4,cursor:'pointer'}}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{height:1,background:t.border,margin:'12px 0'}}/>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:700,color:t.text}}>Items & Assemblies</div>
                    <span style={{fontSize:10,color:t.text4,background:t.bg3,borderRadius:10,padding:'1px 7px',border:`1px solid ${t.border}`}}>0</span>
                  </div>
                  <div style={{fontSize:10,color:t.text4,lineHeight:1.5,marginBottom:10}}>
                    Items and assemblies are optional. Adding them will produce a detailed Bill of Materials Report.
                  </div>
                  <button onClick={()=>setShowAssembly(true)}
                    style={{width:'100%',padding:'7px 0',border:`1px solid ${t.border2}`,background:t.bg,color:t.text3,
                      borderRadius:5,cursor:'pointer',fontSize:11,marginBottom:16,display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>
                    + Add items and assemblies
                  </button>

                  <div style={{height:1,background:t.border,margin:'4px 0 12px'}}/>
                  <div style={{fontSize:12,fontWeight:700,color:t.text,marginBottom:6}}>Sheet</div>
                  {plans.length===0
                    ? <div style={{fontSize:10,color:'#F59E0B',padding:'6px 10px',background:'#FEF3C7',borderRadius:5,border:'1px solid #FDE68A',marginBottom:12}}>⚠ Upload plans in the Plans tab first</div>
                    : <select value={selPlan?.id||''} onChange={e=>{
                        const p=planMap.get(Number(e.target.value));
                        if(p){
                          if(!openTabs.includes(p.id)) setOpenTabs(prev=>[...prev,p.id]);
                          setSelPlan(p);
                          if(p.scale_px_per_ft) setScale(p.scale_px_per_ft);
                          else{setScale(null);setPresetScale('');}
                        }
                      }}
                      style={{width:'100%',padding:'7px 10px',border:`1px solid ${selPlan?'#4CAF50':t.border2}`,borderRadius:5,
                        fontSize:12,color:t.text,background:t.bg,marginBottom:12,cursor:'pointer',outline:'none'}}>
                        <option value="">— Select a sheet —</option>
                        {plans.map(p=><option key={p.id} value={p.id}>{p.name||'Unnamed'}</option>)}
                      </select>
                  }

                  <div style={{display:'flex',gap:8}}>
                    <button onClick={()=>setTakeoffStep('create')}
                      style={{flex:1,padding:'8px 0',border:`1px solid ${t.border2}`,background:t.bg,color:t.text3,
                        borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>
                      ← Takeoffs
                    </button>
                    <button disabled={creatingTO||!newTOName.trim()} onClick={async()=>{
                      if(!newTOName.trim()) return;
                      setCreatingTO(true);
                      // Auto-select a plan if none is open
                      let activePlan = selPlan;
                      if(!activePlan && plans.length>0){
                        const firstPlan = openTabs.length>0 ? planMap.get(openTabs[0]) : plans[0];
                        activePlan = firstPlan || plans[0];
                        if(!openTabs.includes(activePlan.id)) setOpenTabs(prev=>[...prev, activePlan.id]);
                        setSelPlan(activePlan);
                        if(activePlan.scale_px_per_ft) setScale(activePlan.scale_px_per_ft);
                        else { setScale(null); setPresetScale(''); }
                      }
                      if(!activePlan){ alert('Please upload a plan first'); setCreatingTO(false); return; }
                      const catId = newTOCat;
                      const mt = newTOType?.mt||'area';
                      const payload = {
                        project_id: project.id,
                        plan_id: activePlan.id,
                        category: catId,
                        description: newTOName.trim(),
                        quantity: 0,
                        unit: newTOType?.unit||'SF',
                        unit_cost: 0,
                        total_cost: 0,
                        measurement_type: mt,
                        points: [],
                        color: newTOColor,
                        ai_generated: false,
                        sort_order: items.length,
                      };
                      console.log('inserting takeoff:', payload);
                      const {data, error} = await supabase.from('takeoff_items').insert([payload]).select().single();
                      console.log('result:', data, error);
                      if(error){ alert('Error creating takeoff: '+error.message); setCreatingTO(false); return; }
                      if(data){
                        setItems(prev=>[...prev,data]);
                        // Switch left tab to takeoffs list and arm the new item
                        setLeftTab('takeoffs');
                        setTakeoffStep(null);
                        setActiveCondId(data.id);
                        setTool(mt==='area'?'area':mt==='linear'?'linear':mt==='count'?'count':'area');
                        setActivePts([]);
                        // Reset flow state
                        setNewTOType(null); setNewTOName(''); setNewTODesc(''); setNewTOColor('#4CAF50'); setNewTOCat('other'); setNewTOSize('medium');
                      }
                      setCreatingTO(false);
                    }}
                      style={{flex:2,padding:'8px 0',border:'none',
                        background:newTOName.trim()&&!creatingTO?'#4CAF50':'#ccc',color:'#fff',
                        borderRadius:6,cursor:newTOName.trim()&&!creatingTO?'pointer':'not-allowed',fontSize:12,fontWeight:700,
                        display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>
                      {creatingTO?'Creating…':'Start Measuring →'}
                    </button>
                  </div>
                  {plans.length===0&&<div style={{fontSize:10,color:'#F59E0B',textAlign:'center',marginTop:6}}>⚠ Upload a plan in the Plans tab first</div>}
                  {!selPlan&&plans.length>0&&<div style={{fontSize:10,color:'#4CAF50',textAlign:'center',marginTop:6}}>✓ Will open {(openTabs.length>0?plans.find(p=>p.id===openTabs[0]):plans[0])?.name||'first plan'}</div>}
                </div>
              </div>
            );

            // ── DEFAULT: Category > Items (flat, no plan folder) ──────────
            const searchLower = toSearch.toLowerCase();
            const filteredItems = items.filter(i=>
              !toSearch || i.description?.toLowerCase().includes(searchLower)
            );
            // All items for the current project, grouped by category
            const catGroups = TAKEOFF_CATS.map(cat=>{
              const catItems = filteredItems.filter(i=>i.category===cat.id);
              return {cat, items:catItems};
            });
            const hasAny = catGroups.some(g=>g.items.length>0);

            return(
            <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
              {/* Active measuring banner */}
              {tool==='cutout'&&!activeCond?(
                <div style={{padding:'6px 12px',background:'rgba(239,68,68,0.08)',borderBottom:'2px solid #C0504D',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                  <div style={{width:6,height:6,borderRadius:'50%',background:'#C0504D',flexShrink:0}}/>
                  <span style={{fontSize:11,fontWeight:600,color:'#C0504D',flex:1}}>⊘ Click an area shape on the plan to cut from</span>
                  <button onClick={()=>{setTool('select');setActiveCondId(null);}} style={{background:'none',border:'1px solid rgba(239,68,68,0.4)',color:'#C0504D',padding:'2px 8px',borderRadius:3,cursor:'pointer',fontSize:9,fontWeight:700,flexShrink:0}}>Cancel</button>
                </div>
              ):activeCond&&tool==='cutout'?(
                <div style={{padding:'6px 12px',background:'rgba(239,68,68,0.08)',borderBottom:'2px solid #C0504D',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                  <div style={{width:6,height:6,borderRadius:'50%',background:'#C0504D',flexShrink:0,animation:'pulse 1.2s ease-in-out infinite'}}/>
                  <span style={{fontSize:11,fontWeight:600,color:'#C0504D',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>⊘ Drawing cutout on: {activeCond.description}</span>
                  <button onClick={()=>{setTool('select');setActiveCondId(null);setActivePts([]);}} style={{background:'none',border:'1px solid rgba(239,68,68,0.4)',color:'#C0504D',padding:'2px 8px',borderRadius:3,cursor:'pointer',fontSize:9,fontWeight:700,flexShrink:0}}>Done</button>
                </div>
              ):activeCond&&(
                <div style={{padding:'6px 12px',background:'rgba(249,115,22,0.08)',borderBottom:'2px solid #E8A317',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                  <div style={{width:6,height:6,borderRadius:'50%',background:'#E8A317',flexShrink:0,animation:'pulse 1.2s ease-in-out infinite'}}/>
                  <span style={{fontSize:11,fontWeight:600,color:'#E8A317',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{activeCond.description}</span>
                  <button onClick={disarm} style={{background:'none',border:'1px solid rgba(249,115,22,0.4)',color:'#E8A317',padding:'2px 8px',borderRadius:3,cursor:'pointer',fontSize:9,fontWeight:700,flexShrink:0}}>Done</button>
                </div>
              )}

              {/* Search + New Takeoff */}
              <div style={{padding:'8px 12px',borderBottom:`1px solid ${t.border}`,flexShrink:0,display:'flex',gap:8,alignItems:'center'}}>
                <div style={{flex:1,position:'relative'}}>
                  <span style={{position:'absolute',left:8,top:'50%',transform:'translateY(-50%)',color:t.text4,fontSize:12}}>⌕</span>
                  <input value={toSearch} onChange={e=>setToSearch(e.target.value)}
                    placeholder="Search"
                    style={{width:'100%',padding:'6px 8px 6px 24px',border:`1px solid ${t.border}`,borderRadius:4,
                      fontSize:12,color:t.text,background:t.bg,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <button onClick={()=>{if(!scale){alert('Set the scale before creating takeoffs.');setShowScalePanel(true);return;}setTakeoffStep('type');}}
                  style={{background:'#4CAF50',border:'none',color:'#fff',padding:'6px 12px',borderRadius:4,
                    cursor:'pointer',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:3,flexShrink:0,whiteSpace:'nowrap'}}>
                  + New Takeoff
                </button>
                <button onClick={()=>setShowCatManager(true)} title="Manage Categories"
                  style={{background:'none',border:`1px solid ${t.border}`,color:t.text3,padding:'6px 8px',borderRadius:4,cursor:'pointer',fontSize:12,flexShrink:0}}>
                  &#9881;
                </button>
              </div>

              {/* Column headers */}
              <div style={{display:'flex',alignItems:'center',padding:'5px 12px',borderBottom:`1px solid ${t.border}`,flexShrink:0,background:t.bg}}>
                <span style={{fontSize:10,fontWeight:600,color:t.text4,flex:1}}>Name</span>
                <span style={{fontSize:10,fontWeight:600,color:t.text4,width:70,textAlign:'right'}}>Qty</span>
                <span style={{width:50}}/>
              </div>

              {/* Category > Items tree */}
              <div style={{flex:1,overflowY:'auto'}}>
                {!hasAny&&(
                  <div style={{textAlign:'center',padding:'40px 16px',color:t.text4,fontSize:11,lineHeight:1.8}}>
                    No takeoffs yet.<br/>Click <strong style={{color:t.text}}>New Takeoff</strong> to get started.
                  </div>
                )}

                {catGroups.map(({cat, items:catItems})=>{
                  // Always show all categories (collapsed if empty), but hide empties when searching
                  if(toSearch && catItems.length===0) return null;
                  const catKey = 'cat_'+cat.id;
                  const catCollapsed = collapsedPlans?.[catKey] ?? (catItems.length===0);
                  const catCost = catItems.reduce((s,i)=>s+(i.total_cost||0),0);

                  return(
                    <div key={cat.id} style={{borderBottom:`1px solid ${t.border}`}}>
                      {/* ── Category header ── */}
                      <div onClick={()=>setCollapsedPlans(p=>({...p,[catKey]:!catCollapsed}))}
                        style={{display:'flex',alignItems:'center',gap:7,padding:'7px 10px',
                          cursor:'pointer',userSelect:'none',
                          borderLeft:`3px solid ${catItems.length>0?cat.color:t.border}`,
                          background:catItems.length>0?`${cat.color}08`:'transparent'}}>
                        <span style={{fontSize:8,color:catItems.length>0?cat.color:t.text4,width:10,flexShrink:0}}>
                          {catCollapsed?'▶':'▼'}
                        </span>
                        <div style={{width:12,height:12,borderRadius:3,background:catItems.length>0?cat.color:t.border2,flexShrink:0}}/>
                        <span style={{fontSize:12,fontWeight:600,color:catItems.length>0?t.text:t.text4,flex:1}}>
                          {cat.label}
                        </span>
                        {catItems.length>0&&(
                          <span style={{fontSize:10,color:t.text4,fontVariantNumeric:'tabular-nums'}}>
                            {catItems.length} item{catItems.length!==1?'s':''}
                          </span>
                        )}
                        {catCost>0&&(
                          <span style={{fontSize:10,fontWeight:700,color:'#4CAF50',fontVariantNumeric:'tabular-nums',marginLeft:6}}>
                            ${Math.round(catCost).toLocaleString()}
                          </span>
                        )}
                      </div>

                      {/* ── Items ── */}
                      {!catCollapsed&&(
                        <div>
                          {catItems.map(item=>{
                            const isActive = item._siblings
                              ? item._siblings.some(s=>s.id===activeCondId)
                              : item.id===activeCondId;
                            const shapes=(()=>{
                              if(!item.points||!item.points.length) return [];
                              if(Array.isArray(item.points[0])) return item.points;
                              if(item.points[0]?.x!=null) return [item.points];
                              return item.points;
                            })();
                            const {qty, unit:displayUnit} = getDisplayQtyUnit(item);
                            const itemColor = item.color||cat.color;
                            const typeIcon = {area:'⬟',linear:'╱',count:'✓'}[item.measurement_type]||'✎';
                            const planName = planMap.get(item.plan_id)?.name||'';
                            return(
                              <div key={item.id}
                                onClick={()=>isActive?disarm():armItem(item)}
                                style={{display:'flex',alignItems:'center',gap:7,
                                  padding:'5px 8px 5px 24px',cursor:'pointer',
                                  borderBottom:`1px solid ${t.border}`,
                                  borderLeft:isActive?`3px solid #E8A317`:`3px solid ${cat.color}`,
                                  background:isActive?'rgba(249,115,22,0.05)':'transparent'}}
                                onMouseEnter={e=>{if(!isActive)e.currentTarget.style.background=t.bg3;}}
                                onMouseLeave={e=>{if(!isActive)e.currentTarget.style.background='transparent';}}>
                                {/* Type chip */}
                                <div style={{width:18,height:18,borderRadius:3,
                                  background:isActive?'#E8A317':itemColor,
                                  display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                                  <span style={{fontSize:8,fontWeight:800,color:'#fff'}}>{typeIcon}</span>
                                </div>
                                {/* Name + plan badge */}
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:11,fontWeight:isActive?600:400,
                                    color:isActive?'#E8A317':t.text,
                                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                    {item.ai_generated&&<span style={{color:'#7B6BA4',fontSize:9,marginRight:3}} title="AI-generated">✦</span>}
                                    {item.description||'Unnamed'}
                                  </div>
                                  <div style={{display:'flex',alignItems:'center',gap:4,marginTop:1}}>
                                    {item._planCount>1
                                      ? <span style={{fontSize:8,color:'#5B9BD5',fontWeight:700,background:'rgba(59,130,246,0.1)',borderRadius:3,padding:'1px 4px'}}>{item._planCount} sheets</span>
                                      : <span style={{fontSize:8,color:t.text4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{planMap.get(item.plan_id)?.name||''}</span>
                                    }
                                  </div>
                                </div>
                                {/* Qty */}
                                <div style={{width:68,textAlign:'right',flexShrink:0}}>
                                  <span style={{fontSize:10,fontVariantNumeric:'tabular-nums',
                                    color:qty>0?t.text:t.text4,fontWeight:qty>0?600:400}}>
                                    {qty>0?`${Math.round(qty*10)/10} ${displayUnit}`:'—'}
                                  </span>
                                </div>
                                {/* ✎ edit item */}
                                <button onClick={e=>{
                                  e.stopPropagation();
                                  setEditItem(item);
                                }} title="Edit takeoff"
                                  style={{background:'none',border:'none',color:t.text4,cursor:'pointer',
                                    fontSize:10,padding:'2px 3px',flexShrink:0,lineHeight:1,opacity:0.4,borderRadius:3}}
                                  onMouseEnter={e=>e.currentTarget.style.opacity='1'}
                                  onMouseLeave={e=>e.currentTarget.style.opacity='0.4'}>✎</button>
                                {/* → jump to plan */}
                                <button onClick={e=>{
                                  e.stopPropagation();
                                  const p=planMap.get(item.plan_id);
                                  if(p){
                                    if(!openTabs.includes(p.id)) setOpenTabs(prev=>[...prev,p.id]);
                                    setSelPlan(p);
                                    if(p.scale_px_per_ft) setScale(p.scale_px_per_ft);
                                    else{setScale(null);setPresetScale('');}
                                  }
                                }} title="Go to plan"
                                  style={{background:'none',border:'none',color:t.text4,cursor:'pointer',
                                    fontSize:12,padding:'0 2px',flexShrink:0,lineHeight:1,opacity:0.5}}>→</button>
                              </div>
                            );
                          })}
                          {/* Add item (only if a plan is open) */}
                          {selPlan&&(
                            <AddItemInline cat={cat} selPlan={selPlan} project={project} items={items}
                              onCreated={(newItem)=>{setItems(prev=>[...prev,newItem]);armItem(newItem);}}/>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })()}

          {/* ── SETTINGS tab ── */}
          {leftTab==='settings'&&(
            <div style={{flex:1,overflowY:'auto',padding:14}}>
              <div style={{fontSize:10,fontWeight:700,color:t.text4,letterSpacing:0.8,marginBottom:8}}>SCALE</div>
              <div style={{fontSize:10,color:scale?'#4CAF50':t.text4,marginBottom:8,padding:'6px 10px',background:t.bg3,borderRadius:5,border:`1px solid ${t.border}`}}>
                {scale?`✓ ${scaleLabel(scale, presetScale)}`:'Not set for this page'}
              </div>
              <div style={{fontSize:10,color:t.text4,marginBottom:8}}>Use the <strong style={{color:'#4CAF50'}}>+ Set Scale</strong> button in the lower-right of the canvas to set scale per page.</div>
              {!isPdfPlan&&(
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:10,color:t.text4,marginBottom:4}}>Scan DPI</div>
                  <select value={planDpi} onChange={e=>setPlanDpi(Number(e.target.value))} style={{...inputStyle,width:'100%',fontSize:11}}>
                    {[72,96,100,150,200,300,400,600].map(d=><option key={d} value={d}>{d} dpi</option>)}
                  </select>
                </div>
              )}
              <div style={{height:1,background:t.border,marginBottom:12}}/>
              <div style={{fontSize:10,fontWeight:700,color:t.text4,letterSpacing:0.8,marginBottom:8}}>UNIT COSTS</div>
              <button onClick={()=>setShowUnitCosts(true)} style={{width:'100%',background:'none',border:`1px solid ${t.border2}`,color:t.text3,padding:'7px 0',borderRadius:5,cursor:'pointer',fontSize:11,marginBottom:12}}>Edit Rates</button>
              <div style={{fontSize:10,fontWeight:700,color:t.text4,letterSpacing:0.8,marginBottom:8}}>ASSEMBLIES</div>
              <button onClick={()=>setShowAssembly(true)} style={{width:'100%',background:'none',border:`1px solid rgba(139,92,246,0.4)`,color:'#7B6BA4',padding:'7px 0',borderRadius:5,cursor:'pointer',fontSize:11,fontWeight:700}}>⬡ Assembly Library</button>
            </div>
          )}

          {/* ── ESTIMATE tab (full screen overlay, triggered from bottom bar) ── */}
          {leftTab==='estimate_stub'&&null}

          {/* Bottom bar */}
          <div style={{borderTop:`1px solid ${t.border}`,padding:'6px 12px',background:t.bg2,flexShrink:0,display:'flex',alignItems:'center',gap:10}}>
            <div style={{flex:1,minWidth:0}}>
              <span style={{fontSize:12,fontWeight:600,color:'#4CAF50'}}>${totalEst.toLocaleString()}</span>
              <span style={{fontSize:10,color:t.text4,marginLeft:6}}>all sheets</span>
            </div>
            <button onClick={()=>{setRightTab('estimate');setEstSubTab('worksheet');}}
              style={{background:'#4CAF50',border:'none',color:'#fff',padding:'5px 14px',borderRadius:4,cursor:'pointer',fontSize:11,fontWeight:600,flexShrink:0}}>
              Estimate →
            </button>
          </div>
        </div>

          {/* ── LIBRARY tab ── */}
          {leftTab==='library'&&(
            <LibraryPanel
              onClose={()=>setLeftTab('takeoffs')}
              projectRegion={projectRegion}
              onApplyItem={async(libItem)=>{
                const catDef = TAKEOFF_CATS.find(c=>c.id===libItem.category)||TAKEOFF_CATS[TAKEOFF_CATS.length-1];
                const uc = libItem.unit_cost || catDef.defaultCost;
                const mt = {SF:'area',LF:'linear',CY:'area',EA:'count'}[libItem.unit]||'manual';
                const payload = {
                  project_id:project.id, plan_id:selPlan?.id, category:catDef.id,
                  description:libItem.name, quantity:0, unit:libItem.unit||catDef.unit,
                  unit_cost:uc, total_cost:0, measurement_type:mt, points:null,
                  color:catDef.color, ai_generated:false, sort_order:items.length,
                };
                const {data} = await supabase.from('takeoff_items').insert([payload]).select().single();
                if(data){ setItems(prev=>[...prev,data]); setLeftTab('takeoffs'); }
              }}
              onApplyAssembly={async(assembly, aItems)=>{
                const toInsert = (aItems||[]).map((ai,i)=>{
                  const li = ai.library_items || {};
                  const catDef = TAKEOFF_CATS.find(c=>c.id===li.category)||TAKEOFF_CATS[TAKEOFF_CATS.length-1];
                  return {
                    project_id:project.id, plan_id:selPlan?.id, category:catDef.id,
                    description:ai.custom_name||li.name||assembly.name, quantity:0,
                    unit:ai.unit||li.unit||'SF', unit_cost:ai.unit_cost||li.unit_cost||0,
                    total_cost:0, measurement_type:{SF:'area',LF:'linear',EA:'count'}[ai.unit||li.unit]||'manual',
                    points:null, color:catDef.color, ai_generated:false, sort_order:items.length+i,
                  };
                });
                if(toInsert.length){
                  const {data}=await supabase.from('takeoff_items').insert(toInsert).select();
                  if(data){ setItems(prev=>[...prev,...data]); setLeftTab('takeoffs'); }
                }
              }}
              projectItems={items}
              onApplyTemplate={async(tmpl)=>{
                const tmplItems=Array.isArray(tmpl.items)?tmpl.items:[];
                if(!tmplItems.length){alert('Template has no items.');return;}
                const toInsert=tmplItems.map((it,i)=>{
                  const catDef=TAKEOFF_CATS.find(c=>c.id===it.category)||TAKEOFF_CATS[TAKEOFF_CATS.length-1];
                  return {
                    project_id:project.id, plan_id:selPlan?.id, category:it.category||catDef.id,
                    description:it.description, quantity:0, unit:it.unit||catDef.unit,
                    unit_cost:it.unit_cost||catDef.defaultCost, total_cost:0,
                    measurement_type:it.measurement_type||'manual', points:null,
                    color:it.color||catDef.color, ai_generated:false, sort_order:items.length+i,
                    waste_percent:it.waste_percent||0,
                  };
                });
                const {data}=await supabase.from('takeoff_items').insert(toInsert).select();
                if(data){setItems(prev=>[...prev,...data]);setLeftTab('takeoffs');alert(`Applied ${data.length} items from "${tmpl.name}"`);}
              }}
            />
          )}

        {/* ── Center: Tabs + Canvas ── */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0,position:'relative'}}>

          {/* ── Sheet tab bar ── */}
          <div style={{display:'flex',alignItems:'stretch',height:32,borderBottom:`1px solid ${t.border}`,background:t.bg2,flexShrink:0,position:'relative'}}>
            <div style={{display:'flex',alignItems:'stretch',flex:1,overflowX:'auto',overflowY:'hidden'}}>
            {/* Overview tab — always first */}
            <div onClick={()=>{setShowOverview(true);setSelPlan(null);}}
              style={{display:'flex',alignItems:'center',gap:5,padding:'0 14px',
                borderRight:`1px solid ${t.border}`,cursor:'pointer',flexShrink:0,
                background:showOverview?t.bg:'transparent',
                borderBottom:showOverview?'2px solid #4CAF50':'2px solid transparent',
                boxSizing:'border-box'}}>
              <span style={{fontSize:12}}>&#8862;</span>
              <span style={{fontSize:11,fontWeight:showOverview?600:400,color:showOverview?t.text:t.text3}}>Overview</span>
            </div>
            {openTabs.map(tabId=>{
              const p = planMap.get(tabId);
              if(!p) return null;
              const isActive = selPlan?.id===tabId;
              const cnt = planItemCountMap.get(tabId)||0;
              return(
                <div key={tabId}
                  onClick={()=>{setShowOverview(false);setSelPlan(p);if(p.scale_px_per_ft)setScale(p.scale_px_per_ft);else{setScale(null);setPresetScale('');}}}
                  style={{display:'flex',alignItems:'center',gap:6,padding:'0 12px',
                    borderRight:`1px solid ${t.border}`,cursor:'pointer',flexShrink:0,minWidth:100,maxWidth:180,
                    background:(!showOverview&&isActive)?t.bg:'transparent',
                    borderBottom:(!showOverview&&isActive)?`2px solid #4CAF50`:'2px solid transparent',
                    boxSizing:'border-box',position:'relative'}}>
                  <span style={{fontSize:11,fontWeight:isActive?600:400,color:isActive?t.text:t.text3,
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,minWidth:0}}>
                    {p.name||`Sheet ${plans.indexOf(p)+1}`}
                  </span>
                  {cnt>0&&<span style={{fontSize:9,color:'#4CAF50',fontVariantNumeric:'tabular-nums',flexShrink:0}}>{cnt}</span>}
                  {/* Close tab */}
                  <button onClick={e=>{
                    e.stopPropagation();
                    const newTabs = openTabs.filter(id=>id!==tabId);
                    setOpenTabs(newTabs);
                    if(isActive){
                      const next = newTabs.length>0 ? planMap.get(newTabs[newTabs.length-1]) : null;
                      setSelPlan(next);
                      if(next?.scale_px_per_ft) setScale(next.scale_px_per_ft);
                      else { setScale(null); setPresetScale(''); }
                    }
                  }} style={{background:'none',border:'none',color:t.text4,cursor:'pointer',
                    fontSize:13,padding:'0',lineHeight:1,flexShrink:0,
                    width:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',
                    borderRadius:'50%',opacity:isActive?0.6:0.3,
                    ':hover':{opacity:1}}}>×</button>
                </div>
              );
            })}
            {/* Placeholder if no tabs */}
            {openTabs.length===0&&(
              <div style={{display:'flex',alignItems:'center',padding:'0 14px',fontSize:10,color:t.text4}}>Open a plan from Plans panel</div>
            )}
            </div>{/* end scrolling tabs */}
            {/* Export — outside overflow div so dropdown is not clipped */}
            {selPlan&&(
              <div style={{position:'relative',flexShrink:0}}>
                <button onClick={()=>setShowExportMenu(v=>!v)} disabled={exporting}
                  style={{height:'100%',padding:'0 14px',border:'none',borderLeft:`1px solid ${t.border}`,
                    background:'none',color:exporting?t.text4:'#5B9BD5',cursor:'pointer',fontSize:11,fontWeight:700,
                    display:'flex',alignItems:'center',gap:5,whiteSpace:'nowrap'}}>
                  {exporting?<><span style={{animation:'spin 0.8s linear infinite',display:'inline-block'}}>◌</span> Exporting…</>:<>↓ Export</>}
                </button>
                {showExportMenu&&!exporting&&(
                  <>
                    <div style={{position:'fixed',inset:0,zIndex:49}} onClick={()=>setShowExportMenu(false)}/>
                    <div style={{position:'absolute',top:'100%',right:0,zIndex:50,marginTop:2,
                      background:'#1a1a1a',border:'1px solid rgba(255,255,255,0.12)',borderRadius:7,
                      boxShadow:'0 8px 24px rgba(0,0,0,0.5)',minWidth:220,overflow:'hidden'}}>
                      <div style={{padding:'7px 12px',fontSize:9,fontWeight:700,color:'rgba(255,255,255,0.3)',letterSpacing:0.8,borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
                        EXPORT PLANS
                      </div>
                      {/* Current plan */}
                      <button onClick={()=>exportPlan(selPlan, true)}
                        style={{width:'100%',background:'none',border:'none',color:'rgba(255,255,255,0.85)',
                          padding:'10px 14px',cursor:'pointer',fontSize:11,textAlign:'left',
                          display:'flex',flexDirection:'column',gap:2,borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
                        <span style={{fontWeight:700,color:'#5B9BD5'}}>↓ This sheet + Legend</span>
                        <span style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>Current plan with markup &amp; legend</span>
                      </button>
                      <button onClick={()=>exportPlan(selPlan, false)}
                        style={{width:'100%',background:'none',border:'none',color:'rgba(255,255,255,0.85)',
                          padding:'10px 14px',cursor:'pointer',fontSize:11,textAlign:'left',
                          display:'flex',flexDirection:'column',gap:2,borderBottom:'1px solid rgba(255,255,255,0.1)'}}>
                        <span style={{fontWeight:700,color:'rgba(255,255,255,0.7)'}}>↓ This sheet only</span>
                        <span style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>Markup, no legend</span>
                      </button>
                      {/* All marked plans */}
                      {(()=>{
                        const markedPlans = plans.filter(p=>items.some(i=>i.plan_id===p.id && i.points?.length));
                        if(!markedPlans.length) return null;
                        return(<>
                          <button onClick={()=>exportAllMarked(true)}
                            style={{width:'100%',background:'none',border:'none',color:'rgba(255,255,255,0.85)',
                              padding:'10px 14px',cursor:'pointer',fontSize:11,textAlign:'left',
                              display:'flex',flexDirection:'column',gap:2,borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
                            <span style={{fontWeight:700,color:'#4CAF50'}}>↓ All {markedPlans.length} marked sheets + Legend</span>
                            <span style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>Downloads as ZIP</span>
                          </button>
                          <button onClick={()=>exportAllMarked(false)}
                            style={{width:'100%',background:'none',border:'none',color:'rgba(255,255,255,0.85)',
                              padding:'10px 14px',cursor:'pointer',fontSize:11,textAlign:'left',
                              display:'flex',flexDirection:'column',gap:2}}>
                            <span style={{fontWeight:700,color:'rgba(16,185,129,0.7)'}}>↓ All {markedPlans.length} marked sheets only</span>
                            <span style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>No legend — ZIP</span>
                          </button>
                        </>);
                      })()}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Referenced Sheets */}
            {selPlan&&planRefs.length>0&&(
              <div style={{position:'relative',flexShrink:0}}>
                <button onClick={()=>setShowRefsDD(p=>!p)}
                  style={{height:'100%',padding:'0 12px',border:'none',borderLeft:`1px solid ${t.border}`,
                    background:'none',color:'#5B9BD5',cursor:'pointer',fontSize:11,fontWeight:600,
                    display:'flex',alignItems:'center',gap:4,whiteSpace:'nowrap'}}>
                  &#8599; Refs ({planRefs.length})
                </button>
                {showRefsDD&&<>
                  <div style={{position:'fixed',inset:0,zIndex:49}} onClick={()=>setShowRefsDD(false)}/>
                  <div style={{position:'absolute',top:'100%',right:0,zIndex:50,marginTop:2,
                    background:'#fff',border:'1px solid #E0E0E0',borderRadius:4,
                    boxShadow:'0 4px 12px rgba(0,0,0,0.12)',minWidth:240,maxHeight:300,overflowY:'auto'}}>
                    <div style={{padding:'8px 12px',fontSize:10,fontWeight:600,color:'#999',borderBottom:'1px solid #f0f0f0'}}>
                      Referenced from this sheet
                    </div>
                    {planRefs.map(({plan:rp, context})=>(
                      <button key={rp.id} onClick={()=>{
                        setShowRefsDD(false);
                        setShowOverview(false);
                        if(!openTabs.includes(rp.id)) setOpenTabs(prev=>[...prev,rp.id]);
                        setSelPlan(rp);
                        if(rp.scale_px_per_ft) setScale(rp.scale_px_per_ft);
                        else{setScale(null);setPresetScale('');}
                      }}
                        style={{display:'block',width:'100%',textAlign:'left',padding:'8px 12px',border:'none',
                          background:'#fff',cursor:'pointer',borderBottom:'1px solid #f8f8f8'}}
                        onMouseEnter={e=>e.currentTarget.style.background='#fafafa'}
                        onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                        <div style={{fontSize:12,fontWeight:500,color:'#333'}}>{rp.name||'Unnamed'}</div>
                        <div style={{fontSize:10,color:'#999',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>...{context}...</div>
                      </button>
                    ))}
                  </div>
                </>}
              </div>
            )}
            {/* AI Takeoff */}
            {selPlan&&<button onClick={runAITakeoff} disabled={analyzing}
              style={{marginLeft:'auto',height:'100%',padding:'0 14px',border:'none',borderLeft:`1px solid ${t.border}`,
                background:'none',color:analyzing?t.text4:'#7B6BA4',cursor:'pointer',fontSize:11,fontWeight:700,
                display:'flex',alignItems:'center',gap:5,flexShrink:0,whiteSpace:'nowrap'}}>
              {analyzing?<><span style={{animation:'spin 0.8s linear infinite',display:'inline-block'}}>◌</span> Analyzing…</>:<>✦ AI Takeoff</>}
            </button>}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{display:'none'}} onChange={e=>handleUpload(e.target.files[0])}/>
          </div>

          {/* Plan canvas + floating overlays */}
          <div style={{flex:1,position:'relative',overflow:'hidden',minHeight:0,minWidth:0}}>
          {/* Find on page bar */}
          {planSearch.trim()&&selPlan&&!showOverview&&(()=>{
            let tp = selPlan.text_positions;
            if(!tp){ try{ const raw=localStorage.getItem(`ocrItems_${selPlan.id}`); if(raw) tp=JSON.parse(raw); }catch(e){} }
            const items = Array.isArray(tp)?tp:(typeof tp==='string'?(()=>{try{return JSON.parse(tp);}catch{return[];}})():[]);
            const q = planSearch.trim().toLowerCase();
            const matches = items.filter(item=>item.str.toLowerCase().includes(q));
            if(!matches.length && !q) return null;
            return(
              <div style={{position:'absolute',top:8,left:'50%',transform:'translateX(-50%)',zIndex:30,
                background:'#fff',border:'1px solid #E0E0E0',borderRadius:6,padding:'6px 14px',
                boxShadow:'0 2px 8px rgba(0,0,0,0.15)',display:'flex',alignItems:'center',gap:10,fontSize:12}}>
                <span style={{color:matches.length?'#4CAF50':'#999',fontWeight:500}}>
                  {matches.length?`${matches.length} match${matches.length!==1?'es':''} on this sheet`:'No matches on this sheet'}
                </span>
                {matches.length>0&&<>
                  <button onClick={()=>{
                    const m=matches[0];
                    const c=containerRef.current;
                    if(c) c.scrollTo({left:m.x*zoom-c.clientWidth/2, top:m.y*zoom-c.clientHeight/2, behavior:'smooth'});
                  }} style={{background:'none',border:'1px solid #E0E0E0',borderRadius:3,padding:'2px 8px',cursor:'pointer',fontSize:11,color:'#333'}}>
                    Go to first
                  </button>
                </>}
                <button onClick={()=>setPlanSearch('')} style={{background:'none',border:'none',color:'#999',cursor:'pointer',fontSize:14,padding:0,lineHeight:1}}>×</button>
              </div>
            );
          })()}
          <div ref={containerCallbackRef} style={{position:'absolute',top:0,left:0,right:0,bottom:0,overflow:'auto',background:'#1e1e1e'}}>
            {showOverview||!selPlan?(()=>{
              const getThumbnailUrl = (plan) => {
                const url = plan.file_url;
                if (!url) return null;
                const objectPath = '/storage/v1/object/public/';
                const renderPath = '/storage/v1/render/image/public/';
                if (url.includes(objectPath)) {
                  return url.replace(objectPath, renderPath) + '?width=300&height=200&resize=contain&quality=60';
                }
                return url;
              };
              return <div style={{position:'absolute',inset:0,overflow:'auto',background:'#f5f5f5',padding:24}}>
                {/* Header */}
                <div style={{display:'flex',alignItems:'center',marginBottom:16,gap:12}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:18,fontWeight:600,color:'#333'}}>All Sheets</div>
                    <div style={{fontSize:12,color:'#999',marginTop:2}}>{plans.length} sheet{plans.length!==1?'s':''}</div>
                  </div>
                  <input value={planSearch} onChange={e=>setPlanSearch(e.target.value)} placeholder="Search sheets by name or content..."
                    style={{width:280,padding:'7px 12px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:13,color:'#333',background:'#fff',outline:'none'}}/>
                  <button onClick={()=>{setUploadTargetFolder(null);fileRef.current?.click();}}
                    style={{background:'#4CAF50',border:'none',color:'#fff',padding:'8px 18px',borderRadius:4,cursor:'pointer',fontSize:13,fontWeight:500}}>
                    Upload Plans
                  </button>
                </div>
                {/* Grid */}
                {(() => {
                  const q = planSearch.trim().toLowerCase();
                  const overviewPlans = q ? plans.filter(p => (p.name||'').toLowerCase().includes(q) || (p.ocr_text||'').toLowerCase().includes(q)) : plans;
                  const matchCount = (p) => {
                    if(!q) return 0;
                    const text = (p.ocr_text||'').toLowerCase();
                    let count=0, pos=0;
                    while((pos=text.indexOf(q,pos))!==-1){count++;pos+=q.length;}
                    return count;
                  };
                  return overviewPlans.length>0?(
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:16}}>
                    {overviewPlans.map((p,idx)=>{
                      const mc = matchCount(p);
                      return(
                      <div key={p.id}
                        onClick={()=>{
                          setShowOverview(false);
                          setSelPlan(p);
                          if(!openTabs.includes(p.id)) setOpenTabs(prev=>[...prev,p.id]);
                          if(p.scale_px_per_ft) setScale(p.scale_px_per_ft);
                          else{setScale(null);setPresetScale('');}
                        }}
                        style={{background:'#fff',border:'1px solid #E0E0E0',borderRadius:4,cursor:'pointer',overflow:'hidden',transition:'box-shadow 0.15s'}}
                        onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'}
                        onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
                        <div style={{width:'100%',height:160,background:'#F0F0F0',overflow:'hidden',position:'relative'}}>
                          {/* Placeholder */}
                          <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',color:'#bbb',fontSize:11,textAlign:'center',padding:8}}>
                            {p.name||'Sheet'}
                          </div>
                          {getThumbnailUrl(p)&&(
                            <img src={getThumbnailUrl(p)} alt="" loading="lazy"
                              style={{width:'100%',height:'100%',objectFit:'cover',display:'block',position:'relative',zIndex:1,opacity:0,transition:'opacity 0.3s'}}
                              onLoad={e=>e.target.style.opacity='1'}
                              onError={e=>e.target.style.display='none'}/>
                          )}
                        </div>
                        <div style={{padding:'10px 12px'}}>
                          <div style={{fontSize:12,color:'#333',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{highlightText(p.name||'Unnamed', q)}</div>
                          <div style={{display:'flex',alignItems:'center',gap:6,marginTop:2}}>
                            <span style={{fontSize:11,color:'#999'}}>Sheet {idx+1} of {plans.length}</span>
                            {mc>0&&<span style={{fontSize:9,background:'#E8F5E9',color:'#4CAF50',padding:'1px 6px',borderRadius:8,fontWeight:600}}>{mc} match{mc!==1?'es':''}</span>}
                          </div>
                          {q && p.ocr_text && (()=>{
                            const lc = p.ocr_text.toLowerCase();
                            const pos = lc.indexOf(q);
                            if(pos<0) return null;
                            const start = Math.max(0, pos-30);
                            const snippet = p.ocr_text.slice(start, pos+q.length+30);
                            return <div style={{fontSize:10,color:'#666',marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                              ...{highlightText(snippet, q)}...
                            </div>;
                          })()}
                        </div>
                      </div>
                    );})}
                  </div>
                ):(
                  <div style={{textAlign:'center',padding:'80px 20px'}}>
                    <div style={{fontSize:48,color:'#ccc',marginBottom:16}}>&#8862;</div>
                    <div style={{fontSize:16,fontWeight:500,color:'#333',marginBottom:8}}>{q?'No matching sheets':'No plans yet'}</div>
                    <div style={{fontSize:13,color:'#999',marginBottom:24}}>{q?'Try a different search term':'Upload your construction plans to get started'}</div>
                    {!q&&<button onClick={()=>{setUploadTargetFolder(null);fileRef.current?.click();}}
                      style={{background:'#4CAF50',border:'none',color:'#fff',padding:'10px 24px',borderRadius:4,cursor:'pointer',fontSize:13,fontWeight:500}}>
                      Upload Plans
                    </button>}
                  </div>
                );
                })()}
              </div>;
            })():(()=>{
              const planW = imgNat.w > 4 ? imgNat.w : (canvasRef.current?.width || 800);
              const planH = imgNat.h > 4 ? imgNat.h : (canvasRef.current?.height || 1100);
              return (
                <div style={{width:planW*zoom, height:planH*zoom, position:'relative', flexShrink:0}}>
                  <div style={{transformOrigin:'top left', transform:`scale(${zoom})`, position:'absolute', top:0, left:0}}>
                    {planErr&&<div style={{position:'absolute',top:10,left:10,zIndex:20,background:'#1a0505',border:'1px solid #C0504D',color:'#C0504D',padding:'10px 14px',borderRadius:8,fontSize:11,maxWidth:500,wordBreak:'break-all'}}>{planErr}</div>}
                    {loadingPlan&&(
                      <div style={{width:800,height:600,display:'flex',alignItems:'center',justifyContent:'center',background:'#1a1a1a',color:'#aaa',fontSize:13,gap:8,fontVariantNumeric:'tabular-nums'}}>
                        <span style={{animation:'spin 0.8s linear infinite',display:'inline-block'}}>◌</span> Loading plan…
                      </div>
                    )}
                    {isPdfPlan?(
                      <>
                        {rendering&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.7)',zIndex:5,color:'#fff',fontSize:13,gap:8}}><span style={{animation:'spin 0.8s linear infinite',display:'inline-block'}}>◌</span>Rendering…</div>}
                        <canvas ref={canvasRef} style={{display:'block',userSelect:'none'}}/>
                      </>
                    ):(blobUrl&&(
                      <img ref={imgRef} src={blobUrl} alt=""
                        style={{display:'block',maxWidth:'none',userSelect:'none'}}
                        onLoad={handleImgLoad}
                        onError={(e)=>{
                          console.error('img load failed');
                          setPlanErr('Load failed. URL: ' + (selPlan?.file_url||'').slice(0,120));
                        }}
                        draggable={false}/>
                    ))}
                    <svg ref={svgRef}
                      viewBox={`0 0 ${planW} ${planH}`}
                      style={{position:'absolute',top:0,left:0,width:planW+'px',height:planH+'px',cursor:toolCursor,pointerEvents:'all',userSelect:'none',overflow:'hidden'}}
                      onMouseDown={(e)=>{ handleSvgMouseDown(e); handleSvgRightPan(e); }}
                      onClick={handleSvgClick}
                      onDoubleClick={handleSvgDoubleClick}
                      onContextMenu={handleSvgContextMenu}
                      onMouseMove={handleSvgMove} onMouseLeave={()=>setHoverPt(null)}>
                      <defs><clipPath id="planClip"><rect x={0} y={0} width={planW} height={planH}/></clipPath></defs>
                      <g clipPath="url(#planClip)">
                        {renderMeasurements()}
                        {renderActive()}
                        {/* ── Dimension line markups ── */}
                        {markups.filter(m=>m.type==='dimension'&&m.planId===selPlan?.id).map(m=>{
                          const {p1,p2,label,color,id}=m;
                          const dx=p2.x-p1.x, dy=p2.y-p1.y;
                          const len=Math.sqrt(dx*dx+dy*dy);
                          if(len<1) return null;
                          const nx=-dy/len, ny=dx/len; // perpendicular
                          const tick=8/zoom;
                          const mx=(p1.x+p2.x)/2, my=(p1.y+p2.y)/2;
                          const fs=12/zoom;
                          const isEraserTarget = eraserHover?.markupId===id;
                          const drawColor = isEraserTarget ? '#C0504D' : color;
                          return(
                            <g key={id} style={{cursor:tool==='select'?'grab':'default',opacity:isEraserTarget?0.5:1}}
                              onMouseDown={tool==='select'?(ev)=>{
                                ev.stopPropagation();
                                const pt=getSvgPos(ev);
                                setMarkupDrag({id,startMouse:pt,startP1:{...p1},startP2:{...p2}});
                                const onUp=()=>{setMarkupDrag(null);window.removeEventListener('mouseup',onUp);};
                                window.addEventListener('mouseup',onUp);
                              }:undefined}>
                              {/* Invisible fat hit area */}
                              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={12/zoom}/>
                              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={drawColor} strokeWidth={1.5/zoom} style={{pointerEvents:'none'}}/>
                              <line x1={p1.x+nx*tick} y1={p1.y+ny*tick} x2={p1.x-nx*tick} y2={p1.y-ny*tick} stroke={drawColor} strokeWidth={1.5/zoom} style={{pointerEvents:'none'}}/>
                              <line x1={p2.x+nx*tick} y1={p2.y+ny*tick} x2={p2.x-nx*tick} y2={p2.y-ny*tick} stroke={drawColor} strokeWidth={1.5/zoom} style={{pointerEvents:'none'}}/>
                              <rect x={mx-label.length*fs*0.3} y={my-fs*0.8-4/zoom} width={label.length*fs*0.6} height={fs*1.4} rx={2/zoom}
                                fill="white" fillOpacity={0.9} stroke={drawColor} strokeWidth={0.5/zoom} style={{pointerEvents:'none'}}/>
                              <text x={mx} y={my+fs*0.15} fontSize={fs} fill={drawColor} textAnchor="middle" fontFamily="monospace" fontWeight={600} style={{pointerEvents:'none'}}>{label}</text>
                            </g>
                          );
                        })}
                        {/* Active dimension line being drawn */}
                        {activeMarkup?.type==='dimension'&&activeMarkup.p1&&hoverPt&&(()=>{
                          const p1=activeMarkup.p1, p2=hoverPt;
                          const dx=p2.x-p1.x, dy=p2.y-p1.y;
                          const len=Math.sqrt(dx*dx+dy*dy);
                          if(len<1) return null;
                          const nx=-dy/len, ny=dx/len;
                          const tick=8/zoom;
                          const dist = scale ? Math.sqrt(dx*dx+dy*dy)/scale : Math.sqrt(dx*dx+dy*dy);
                          const unit = scale ? 'ft' : 'px';
                          const label = scale ? `${Math.round(dist*100)/100} ${unit}` : `${Math.round(dist)} ${unit}`;
                          const mx=(p1.x+p2.x)/2, my=(p1.y+p2.y)/2;
                          const fs=12/zoom;
                          return(
                            <g style={{pointerEvents:'none'}}>
                              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={markupColor} strokeWidth={1.5/zoom} strokeDasharray={`${4/zoom},${3/zoom}`}/>
                              <line x1={p1.x+nx*tick} y1={p1.y+ny*tick} x2={p1.x-nx*tick} y2={p1.y-ny*tick} stroke={markupColor} strokeWidth={1.5/zoom}/>
                              <line x1={p2.x+nx*tick} y1={p2.y+ny*tick} x2={p2.x-nx*tick} y2={p2.y-ny*tick} stroke={markupColor} strokeWidth={1.5/zoom}/>
                              <circle cx={p1.x} cy={p1.y} r={4/zoom} fill={markupColor}/>
                              <rect x={mx-label.length*fs*0.3} y={my-fs*0.8-4/zoom} width={label.length*fs*0.6} height={fs*1.4} rx={2/zoom}
                                fill="white" fillOpacity={0.85} stroke={markupColor} strokeWidth={0.5/zoom}/>
                              <text x={mx} y={my+fs*0.15} fontSize={fs} fill={markupColor} textAnchor="middle" fontFamily="monospace" fontWeight={600}>{label}</text>
                            </g>
                          );
                        })()}
                        {/* ── Legend markups ── */}
                        {markups.filter(m=>m.type==='legend'&&m.planId===selPlan?.id).map(m=>{
                          const {pos,items:legendItems,id}=m;
                          const sc = m.scale || 1;
                          const fs=(11*sc)/zoom;
                          const pad=(8*sc)/zoom;
                          const rowH=fs*1.6;
                          const swatchW=fs*1.2;
                          const swatchH=fs*0.8;
                          const headerH=fs*1.8;
                          const w=(200*sc)/zoom;
                          const h=headerH+pad+(legendItems.length*rowH)+pad;
                          const isEraserTarget = eraserHover?.markupId===id;
                          return(
                            <g key={id} style={{cursor:tool==='select'?'grab':'default',opacity:isEraserTarget?0.5:1}}
                              onMouseDown={tool==='select'?(ev)=>{
                                ev.stopPropagation();
                                const pt=getSvgPos(ev);
                                setMarkupDrag({id,startMouse:pt,startPos:{...pos}});
                                const onUp=()=>{setMarkupDrag(null);window.removeEventListener('mouseup',onUp);};
                                window.addEventListener('mouseup',onUp);
                              }:undefined}>
                              {/* Background */}
                              <rect x={pos.x} y={pos.y} width={w} height={h} rx={3/zoom}
                                fill="white" fillOpacity={0.95} stroke={isEraserTarget?'#C0504D':'#e0e0e0'} strokeWidth={1/zoom}/>
                              {/* Header — drag handle */}
                              <rect x={pos.x} y={pos.y} width={w} height={headerH} rx={3/zoom}
                                fill="#f5f5f5" stroke="none"/>
                              <text x={pos.x+pad} y={pos.y+headerH*0.65} fontSize={fs} fill="#333" fontWeight={700} style={{pointerEvents:'none'}}>Legend</text>
                              <text x={pos.x+w-pad} y={pos.y+headerH*0.65} fontSize={fs*0.75} fill="#999" textAnchor="end" style={{pointerEvents:'none'}}>
                                {scaleLabel(scale, presetScale)}
                              </text>
                              {/* Items */}
                              {legendItems.map((li,idx)=>{
                                const ry=pos.y+headerH+pad+(idx*rowH);
                                return(
                                  <g key={idx} style={{pointerEvents:'none'}}>
                                    <rect x={pos.x+pad} y={ry} width={swatchW} height={swatchH} rx={1/zoom} fill={li.color}/>
                                    <text x={pos.x+pad+swatchW+4/zoom} y={ry+swatchH*0.85} fontSize={fs*0.85} fill="#333">{li.name}</text>
                                    <text x={pos.x+w-pad} y={ry+swatchH*0.85} fontSize={fs*0.8} fill="#666" textAnchor="end" fontFamily="monospace">
                                      {li.qty>0?`${Math.round(li.qty*10)/10} ${li.unit}`:'—'}
                                    </text>
                                  </g>
                                );
                              })}
                              {/* Resize handle — bottom-right corner */}
                              <rect x={pos.x+w-12/zoom} y={pos.y+h-12/zoom} width={12/zoom} height={12/zoom}
                                fill="transparent" style={{cursor:'nwse-resize'}}
                                onMouseDown={tool==='select'?(ev)=>{
                                  ev.stopPropagation();
                                  const pt=getSvgPos(ev);
                                  setMarkupDrag({id,startMouse:pt,startScale:sc,resize:true});
                                  const onUp=()=>{setMarkupDrag(null);window.removeEventListener('mouseup',onUp);};
                                  window.addEventListener('mouseup',onUp);
                                }:undefined}/>
                              {/* Resize grip visual */}
                              <line x1={pos.x+w-2/zoom} y1={pos.y+h-8/zoom} x2={pos.x+w-8/zoom} y2={pos.y+h-2/zoom}
                                stroke="#ccc" strokeWidth={1/zoom} style={{pointerEvents:'none'}}/>
                              <line x1={pos.x+w-2/zoom} y1={pos.y+h-4/zoom} x2={pos.x+w-4/zoom} y2={pos.y+h-2/zoom}
                                stroke="#ccc" strokeWidth={1/zoom} style={{pointerEvents:'none'}}/>
                            </g>
                          );
                        })}
                        {scalePts.length>=2&&(()=>{
                          const p1=scalePts[0];const p2=scalePts[1];
                          const sw=2/zoom;
                          return(<g>
                            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#4CAF50" strokeWidth={sw} strokeDasharray={`${6/zoom},${3/zoom}`}/>
                            <circle cx={p1.x} cy={p1.y} r={6/zoom} fill="#4CAF50"/>
                            <circle cx={p2.x} cy={p2.y} r={6/zoom} fill="#4CAF50"/>
                          </g>);
                        })()}
                        {/* Cross-reference link overlays on plan */}
                        {selPlan&&!planSearch.trim()&&(()=>{
                          let tp = selPlan.text_positions;
                          if(!tp){ try{ const raw=localStorage.getItem(`ocrItems_${selPlan.id}`); if(raw) tp=JSON.parse(raw); }catch(e){} }
                          const items = Array.isArray(tp)?tp:(typeof tp==='string'?(()=>{try{return JSON.parse(tp);}catch{return[];}})():[]);
                          if(!items.length || !plans.length) return null;
                          // Build sheet number → plan lookup
                          const numToPlan = new Map();
                          for(const p of plans){
                            if(p.id===selPlan.id) continue;
                            const m = (p.name||'').match(/^([A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,3})?)/);
                            if(m) numToPlan.set(m[1].toUpperCase(), p);
                          }
                          // Find text items that contain or ARE sheet numbers matching other plans
                          const links = [];
                          for(const item of items){
                            const str = item.str.toUpperCase().trim();
                            for(const [num, plan] of numToPlan){
                              if(str.includes(num)){
                                links.push({...item, target:plan, refNum:num});
                                break;
                              }
                            }
                          }
                          if(!links.length) return null;
                          // Deduplicate overlapping boxes — merge if they overlap
                          const deduped = [];
                          for(const lk of links){
                            const w = (lk.w && lk.w > 0) ? lk.w : lk.str.length * (lk.h||10) * 0.6;
                            const h = (lk.h||10) * 0.9;
                            const box = {x:lk.x, y:lk.y, w, h, target:lk.target};
                            // Check overlap with existing
                            let merged = false;
                            for(const existing of deduped){
                              if(box.x < existing.x+existing.w && box.x+box.w > existing.x &&
                                 box.y < existing.y+existing.h && box.y+box.h > existing.y){
                                // Merge: expand existing to cover both
                                const nx = Math.min(existing.x, box.x);
                                const ny = Math.min(existing.y, box.y);
                                existing.w = Math.max(existing.x+existing.w, box.x+box.w) - nx;
                                existing.h = Math.max(existing.y+existing.h, box.y+box.h) - ny;
                                existing.x = nx; existing.y = ny;
                                merged = true; break;
                              }
                            }
                            if(!merged) deduped.push(box);
                          }
                          return deduped.map((lk,i)=>(
                            <g key={`ref${i}`} style={{cursor:'pointer'}} onClick={(e)=>{
                              e.stopPropagation();
                              setShowOverview(false);
                              if(!openTabs.includes(lk.target.id)) setOpenTabs(prev=>[...prev,lk.target.id]);
                              setSelPlan(lk.target);
                              if(lk.target.scale_px_per_ft) setScale(lk.target.scale_px_per_ft);
                              else{setScale(null);setPresetScale('');}
                            }}>
                              <rect x={lk.x} y={lk.y} width={lk.w} height={lk.h} rx={2}
                                fill="rgba(91,155,213,0.12)" stroke="#5B9BD5" strokeWidth={1/zoom} strokeDasharray={`${3/zoom},${2/zoom}`}/>
                            </g>
                          ));
                        })()}
                        {/* Search text highlights on plan */}
                        {planSearch.trim()&&selPlan&&(()=>{
                          const q = planSearch.trim().toLowerCase();
                          let tp = selPlan.text_positions;
                          // Fallback to localStorage if DB doesn't have positions
                          if(!tp){
                            try{ const raw=localStorage.getItem(`ocrItems_${selPlan.id}`); if(raw) tp=JSON.parse(raw); }catch(e){}
                          }
                          const items = Array.isArray(tp) ? tp : (typeof tp==='string' ? (()=>{try{return JSON.parse(tp);}catch{return[];}})() : []);
                          if(!items.length) return null;
                          const matches = items.filter(item=>item.str.toLowerCase().includes(q));
                          if(!matches.length) return null;
                          return matches.map((m,i)=>(
                            <g key={`hl${i}`} style={{pointerEvents:'none'}}>
                              <rect x={m.x-4} y={m.y-3} width={Math.max(m.w+8,40)} height={Math.max(m.h+6,16)} rx={3}
                                fill="rgba(255,213,0,0.55)" stroke="#FF6F00" strokeWidth={2.5/zoom}/>
                            </g>
                          ));
                        })()}
                        {/* Lasso selection box */}
                        {lassoRect&&(()=>{
                          const {sx,sy,ex,ey}=lassoRect;
                          const lx=Math.min(sx,ex),ly=Math.min(sy,ey),lw=Math.abs(ex-sx),lh=Math.abs(ey-sy);
                          if(lw<2&&lh<2) return null;
                          return(<g style={{pointerEvents:'none'}}>
                            <rect x={lx} y={ly} width={lw} height={lh}
                              fill="rgba(59,130,246,0.08)" stroke="#5B9BD5"
                              strokeWidth={1.5/zoom} strokeDasharray={`${5/zoom},${3/zoom}`}/>
                          </g>);
                        })()}
                      </g>
                    </svg>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ── DEBUG overlay (remove before prod) ── */}
          <div style={{position:'absolute',bottom:8,left:8,zIndex:110,
            background:'rgba(0,0,0,0.75)',color:'#0f0',fontFamily:'monospace',
            fontSize:10,padding:'4px 8px',borderRadius:4,pointerEvents:'auto',lineHeight:1.6}}>
            imgNat:{imgNat.w}x{imgNat.h} | zoom:{zoom} | {selPlan&&<a href={selPlan.file_url} target="_blank" rel="noreferrer" style={{color:'#0ff',textDecoration:'underline'}}>open raw image</a>}
          </div>
          {/* ── Multi-select floating action bar ── */}
          {selectedShapes.size>0&&(
            <div style={{position:'absolute',top:10,left:'50%',transform:'translateX(-50%)',zIndex:110,
              background:'rgba(15,15,15,0.96)',border:'1px solid rgba(59,130,246,0.5)',
              borderRadius:10,padding:'7px 14px',boxShadow:'0 4px 24px rgba(0,0,0,0.6)',
              backdropFilter:'blur(10px)',display:'flex',alignItems:'center',gap:10,pointerEvents:'all'}}>
              <span style={{fontSize:11,color:'#94A3B8',fontWeight:600}}>{selectedShapes.size} selected</span>
              {copyFlash>0&&<span style={{fontSize:11,color:'#6EE7B7',fontWeight:700,animation:'fadeIn 0.2s ease'}}>✓ Copied {copyFlash}</span>}
              <div style={{width:1,height:18,background:'rgba(255,255,255,0.12)'}}/>
              <button onClick={()=>{ if(copyShapesRef.current) copyShapesRef.current(); }}
                title="Copy (Ctrl+C)"
                style={{background:'none',border:'none',color:'#93C5FD',cursor:'pointer',fontSize:11,fontWeight:600,padding:'2px 6px',borderRadius:4,display:'flex',alignItems:'center',gap:4}}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(59,130,246,0.15)'}
                onMouseLeave={e=>e.currentTarget.style.background='none'}>
                ⎘ Copy
              </button>
              <button onClick={()=>{
                const OFF=30;
                const shift=(sh)=>sh.map(p=>({...p,x:p.x+OFF,y:p.y+OFF}));
                const keys=[...selectedShapesRef.current];
                if(!keys.length) return;
                pushUndo();
                const byItem={};
                keys.forEach(k=>{const parts=k.split('::');const id=parts[0];const si=Number(parts[1]);if(!byItem[id])byItem[id]=[];byItem[id].push(si);});
                // Append duplicated shapes to the same item they came from
                Object.entries(byItem).forEach(([id,idxs])=>{
                  const item=itemsRef.current.find(i=>String(i.id)===String(id)); if(!item) return;
                  const existingShapes = normalizeShapes(item.points);
                  const picked=idxs.map(i=>existingShapes[i]).filter(Boolean);
                  if(!picked.length) return;
                  const shiftedShapes = picked.map(shift);
                  const newPoints = [...existingShapes, ...shiftedShapes];
                  const mt = item.measurement_type;
                  let qty = 0;
                  if(mt==='area') qty = newPoints.reduce((s,sh)=>s+calcShapeNetArea(sh),0);
                  else if(mt==='linear'){ qty = newPoints.reduce((s,sh)=>{let t=0;for(let i=1;i<sh.length;i++)t+=calcLinear(sh[i-1],sh[i]);return s+t;},0); }
                  else if(mt==='count') qty = newPoints.length;
                  qty = Math.round(qty*10)/10;
                  const total_cost = computeTotalCost(item, qty);
                  setItems(prev=>prev.map(i=>String(i.id)===String(id)?{...i,points:newPoints,quantity:qty,total_cost}:i));
                  supabase.from('takeoff_items').update({points:newPoints,quantity:qty,total_cost}).eq('id',item.id);
                  // Select the new shapes
                  const newKeys = shiftedShapes.map((_,si)=>`${id}::${existingShapes.length+si}`);
                  setSelectedShapes(new Set(newKeys));
                });
              }} title="Duplicate"
                style={{background:'none',border:'none',color:'#6EE7B7',cursor:'pointer',fontSize:11,fontWeight:600,padding:'2px 6px',borderRadius:4,display:'flex',alignItems:'center',gap:4}}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(16,185,129,0.15)'}
                onMouseLeave={e=>e.currentTarget.style.background='none'}>
                ⧉ Duplicate
              </button>
              <button onClick={(e)=>{ 
                e.stopPropagation();
                console.log('DELETE BTN CLICKED, ref:', deleteShapesRef.current, 'sel:', selectedShapesRef.current.size);
                if(deleteShapesRef.current) deleteShapesRef.current(); 
                else console.error('deleteShapesRef.current is NULL');
              }}
                title="Delete selected (Del)"
                style={{background:'none',border:'none',color:'#FCA5A5',cursor:'pointer',fontSize:11,fontWeight:600,padding:'2px 6px',borderRadius:4,display:'flex',alignItems:'center',gap:4}}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(252,165,165,0.15)'}
                onMouseLeave={e=>e.currentTarget.style.background='none'}>
                ⌫ Delete
              </button>
              <div style={{position:'relative',display:'inline-block'}}>
                <button onClick={(e)=>{e.stopPropagation();setShowMoveMenu(showMoveMenu?null:true);}}
                  title="Move to another item"
                  style={{background:'none',border:'none',color:'#C4B5FD',cursor:'pointer',fontSize:11,fontWeight:600,padding:'2px 6px',borderRadius:4,display:'flex',alignItems:'center',gap:4}}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(139,92,246,0.15)'}
                  onMouseLeave={e=>e.currentTarget.style.background='none'}>
                  ↗ Move to...
                </button>
                {showMoveMenu&&(()=>{
                  // Determine measurement_type of selected shapes
                  const selKeys=[...selectedShapesRef.current];
                  const selItemIds=new Set(selKeys.map(k=>k.split('::')[0]));
                  const selTypes=new Set([...selItemIds].map(id=>{const it=itemsRef.current.find(i=>String(i.id)===String(id));return it?.measurement_type;}).filter(Boolean));
                  const mt=selTypes.size===1?[...selTypes][0]:null;
                  if(!mt) return <div style={{position:'absolute',top:'100%',left:0,background:'#1a1a1a',border:'1px solid #333',borderRadius:6,padding:8,fontSize:10,color:'#f87171',whiteSpace:'nowrap',zIndex:120}}>Mixed types — cannot move</div>;
                  const targets=planItems.filter(i=>i.measurement_type===mt&&!selItemIds.has(String(i.id)));
                  if(!targets.length) return <div style={{position:'absolute',top:'100%',left:0,background:'#1a1a1a',border:'1px solid #333',borderRadius:6,padding:8,fontSize:10,color:'#94A3B8',whiteSpace:'nowrap',zIndex:120}}>No other {mt} items on this plan</div>;
                  return(
                    <div style={{position:'absolute',top:'100%',left:0,background:'#1a1a1a',border:'1px solid #333',borderRadius:6,padding:4,minWidth:160,maxHeight:200,overflowY:'auto',zIndex:120}}>
                      {targets.map(tgt=>(
                        <div key={tgt.id} onClick={(e)=>{
                          e.stopPropagation();
                          pushUndo();
                          const byItem={};
                          selKeys.forEach(k=>{const p=k.split('::');const id=p[0];const si=Number(p[1]);if(!byItem[id])byItem[id]=[];byItem[id].push(si);});
                          const newSelKeys=[];
                          let tgtItem=itemsRef.current.find(i=>String(i.id)===String(tgt.id));
                          let tgtShapes=normalizeShapes(tgtItem.points);
                          Object.entries(byItem).forEach(([srcId,idxs])=>{
                            const srcItem=itemsRef.current.find(i=>String(i.id)===String(srcId));
                            if(!srcItem) return;
                            const srcShapes=normalizeShapes(srcItem.points);
                            const moved=idxs.map(i=>srcShapes[i]).filter(Boolean);
                            const kept=srcShapes.filter((_,i)=>!idxs.includes(i));
                            // Update source
                            let srcQty=0;
                            if(mt==='area') srcQty=kept.reduce((s,sh)=>s+calcShapeNetArea(sh),0);
                            else if(mt==='linear'){ srcQty=kept.reduce((s,sh)=>{let t=0;for(let i=1;i<sh.length;i++)t+=calcLinear(sh[i-1],sh[i]);return s+t;},0); }
                            else if(mt==='count') srcQty=kept.length;
                            srcQty=Math.round(srcQty*10)/10;
                            const srcTC=srcQty*(srcItem.multiplier||1)*(srcItem.unit_cost||0);
                            if(kept.length===0){
                              setItems(prev=>prev.filter(i=>String(i.id)!==String(srcId)));
                              supabase.from('takeoff_items').delete().eq('id',srcId);
                            } else {
                              setItems(prev=>prev.map(i=>String(i.id)===String(srcId)?{...i,points:kept,quantity:srcQty,total_cost:srcTC}:i));
                              supabase.from('takeoff_items').update({points:kept,quantity:srcQty,total_cost:srcTC}).eq('id',srcId);
                            }
                            // Append to target
                            moved.forEach(sh=>{
                              newSelKeys.push(`${tgt.id}::${tgtShapes.length}`);
                              tgtShapes=[...tgtShapes,sh];
                            });
                          });
                          let tgtQty=0;
                          if(mt==='area') tgtQty=tgtShapes.reduce((s,sh)=>s+calcShapeNetArea(sh),0);
                          else if(mt==='linear'){ tgtQty=tgtShapes.reduce((s,sh)=>{let t=0;for(let i=1;i<sh.length;i++)t+=calcLinear(sh[i-1],sh[i]);return s+t;},0); }
                          else if(mt==='count') tgtQty=tgtShapes.length;
                          tgtQty=Math.round(tgtQty*10)/10;
                          const tgtTC=tgtQty*(tgtItem.multiplier||1)*(tgtItem.unit_cost||0);
                          setItems(prev=>prev.map(i=>String(i.id)===String(tgt.id)?{...i,points:tgtShapes,quantity:tgtQty,total_cost:tgtTC}:i));
                          supabase.from('takeoff_items').update({points:tgtShapes,quantity:tgtQty,total_cost:tgtTC}).eq('id',tgt.id);
                          setSelectedShapes(new Set(newSelKeys));
                          setShowMoveMenu(null);
                        }}
                          style={{padding:'5px 8px',fontSize:10,color:'#e2e8f0',cursor:'pointer',borderRadius:4,display:'flex',alignItems:'center',gap:6}}
                          onMouseEnter={e=>e.currentTarget.style.background='rgba(139,92,246,0.15)'}
                          onMouseLeave={e=>e.currentTarget.style.background='none'}>
                          <span style={{width:8,height:8,borderRadius:2,background:tgt.color||'#4CAF50',flexShrink:0}}/>
                          {tgt.description||'Untitled'}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div style={{width:1,height:18,background:'rgba(255,255,255,0.12)'}}/>
              <button onClick={()=>setSelectedShapes(new Set())} title="Clear selection (Esc)"
                style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:14,padding:'0 2px',lineHeight:1}}>×</button>
            </div>
          )}

          {/* ── Floating Scale Bar (Stack-style, bottom of canvas) ── */}
          {selPlan&&(
            <div style={{position:'absolute',bottom:12,right:16,zIndex:30,display:'flex',alignItems:'center',gap:6,pointerEvents:'all'}}>
              {/* Calibrating status */}
              {scaleStep==='picking'&&(
                <div style={{background:'rgba(16,185,129,0.95)',color:'#fff',borderRadius:6,padding:'5px 12px',fontSize:11,fontWeight:600,boxShadow:'0 2px 10px rgba(0,0,0,0.4)',backdropFilter:'blur(4px)'}}>
                  Click 2 known points ({scalePts.length}/2)
                </div>
              )}
              {/* Scale distance input when 2 pts picked */}
              {scaleStep==='entering'&&(
                <div style={{background:'rgba(10,10,10,0.92)',border:'1px solid rgba(16,185,129,0.4)',borderRadius:8,padding:'8px 12px',boxShadow:'0 4px 20px rgba(0,0,0,0.6)',display:'flex',alignItems:'center',gap:8,backdropFilter:'blur(8px)'}}>
                  <span style={{fontSize:11,color:'rgba(255,255,255,0.5)'}}>Known distance =</span>
                  <input autoFocus type="number" value={scaleDist} onChange={e=>setScaleDist(e.target.value)}
                    placeholder="e.g. 20"
                    style={{width:72,background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.15)',color:'#fff',borderRadius:4,padding:'4px 8px',fontSize:12,outline:'none'}}
                    onKeyDown={e=>{ if(e.key==='Enter') { confirmScale(); setShowScalePanel(false); } }}/>
                  <select value={scaleUnit} onChange={e=>setScaleUnit(e.target.value)} style={{background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.15)',color:'#fff',borderRadius:4,padding:'4px 6px',fontSize:11}}>
                    <option value="ft">ft</option>
                    <option value="in">in</option>
                  </select>
                  <button onClick={()=>{confirmScale();setShowScalePanel(false);}} style={{background:'#4CAF50',border:'none',color:'#fff',borderRadius:5,padding:'4px 12px',cursor:'pointer',fontSize:11,fontWeight:700}}>Set</button>
                  <button onClick={()=>{setScaleStep(null);setScalePts([]);setTool('select');}} style={{background:'none',border:'none',color:'rgba(255,255,255,0.4)',cursor:'pointer',fontSize:14,padding:'0 2px'}}>×</button>
                </div>
              )}

              {/* Scale preset panel */}
              {showScalePanel&&!scaleStep&&(
                <>
                  <div style={{position:'fixed',inset:0,zIndex:29}} onClick={()=>setShowScalePanel(false)}/>
                  <div style={{position:'absolute',bottom:'calc(100% + 8px)',right:0,
                    background:'#1a1a1a',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,
                    boxShadow:'0 8px 32px rgba(0,0,0,0.6)',width:220,zIndex:31,
                    backdropFilter:'blur(8px)',display:'flex',flexDirection:'column',
                    maxHeight:'min(480px, calc(100vh - 80px))'}}>

                    {/* Header */}
                    <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(255,255,255,0.08)',fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.4)',letterSpacing:0.8,flexShrink:0}}>
                      SET SCALE — {selPlan?.name?.slice(0,22)}
                    </div>

                    {/* Custom ratio input — 1" = X ft */}
                    <div style={{padding:'8px 10px',borderBottom:'1px solid rgba(255,255,255,0.08)',flexShrink:0}}>
                      <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:5,letterSpacing:0.5}}>CUSTOM  (1&quot; = ? ft)</div>
                      <div style={{display:'flex',gap:6,alignItems:'center'}}>
                        <span style={{fontSize:11,color:'rgba(255,255,255,0.5)',flexShrink:0}}>1&quot; =</span>
                        <input
                          type="number" min="0.1" step="any"
                          value={customScaleInput}
                          onChange={e=>setCustomScaleInput(e.target.value)}
                          placeholder="e.g. 40"
                          style={{flex:1,background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.15)',
                            color:'#fff',borderRadius:4,padding:'5px 8px',fontSize:12,outline:'none',minWidth:0}}
                          onKeyDown={async e=>{
                            if(e.key!=='Enter') return;
                            const ft = parseFloat(customScaleInput);
                            if(!ft||ft<=0) return;
                            const pxPerFt = (planDpi*12)/( ft*12 );
                            const label = `1"=${ft}ft`;
                            setScale(pxPerFt); setPresetScale(label);
                            if(selPlan?.id&&selPlan.id!=='preview') await supabase.from('precon_plans').update({scale_px_per_ft:pxPerFt}).eq('id',selPlan.id);
                            setShowScalePanel(false); setCustomScaleInput('');
                          }}
                        />
                        <span style={{fontSize:11,color:'rgba(255,255,255,0.5)',flexShrink:0}}>ft</span>
                        <button onClick={async()=>{
                          const ft = parseFloat(customScaleInput);
                          if(!ft||ft<=0) return;
                          const pxPerFt = (planDpi*12)/( ft*12 );
                          const label = `1"=${ft}ft`;
                          setScale(pxPerFt); setPresetScale(label);
                          if(selPlan?.id&&selPlan.id!=='preview') await supabase.from('precon_plans').update({scale_px_per_ft:pxPerFt}).eq('id',selPlan.id);
                          setShowScalePanel(false); setCustomScaleInput('');
                        }} disabled={!customScaleInput||parseFloat(customScaleInput)<=0}
                          style={{background:'#4CAF50',border:'none',color:'#fff',borderRadius:4,padding:'5px 10px',cursor:'pointer',fontSize:11,fontWeight:700,flexShrink:0,opacity:customScaleInput&&parseFloat(customScaleInput)>0?1:0.4}}>
                          Set
                        </button>
                      </div>
                    </div>

                    {/* Calibrate + Auto-detect */}
                    <button onClick={()=>{setTool('scale');setScaleStep('picking');setScalePts([]);setActivePts([]);setShowScalePanel(false);}}
                      style={{width:'100%',background:'none',border:'none',color:'#4CAF50',padding:'9px 12px',cursor:'pointer',fontSize:11,fontWeight:700,textAlign:'left',borderBottom:'1px solid rgba(255,255,255,0.06)',flexShrink:0,display:'flex',alignItems:'center',gap:7}}>
                      <span style={{fontSize:13}}>⊕</span> Calibrate — click 2 points
                    </button>
                    <button onClick={()=>{autoDetectScale();setShowScalePanel(false);}}
                      style={{width:'100%',background:'none',border:'none',color:'#7B6BA4',padding:'9px 12px',cursor:'pointer',fontSize:11,fontWeight:700,textAlign:'left',borderBottom:'1px solid rgba(255,255,255,0.1)',flexShrink:0,display:'flex',alignItems:'center',gap:7}}>
                      <span style={{fontSize:13}}>✦</span> Auto-Detect from drawing
                    </button>

                    {/* Scrollable preset list */}
                    <div style={{overflowY:'auto',flex:1}}>
                      <div style={{padding:'6px 12px 2px',fontSize:9,color:'rgba(255,255,255,0.3)',letterSpacing:0.6,position:'sticky',top:0,background:'#1a1a1a'}}>CIVIL / ENGINEERING</div>
                      {CONSTRUCTION_SCALES.filter(s=>s.group==='Engineering').map(s=>(
                        <button key={s.label} onClick={async()=>{
                          const pxPerFt=(planDpi*12)/s.ratio;
                          setScale(pxPerFt); setPresetScale(s.label);
                          if(selPlan?.id&&selPlan.id!=='preview') await supabase.from('precon_plans').update({scale_px_per_ft:pxPerFt}).eq('id',selPlan.id);
                          setShowScalePanel(false);
                        }} style={{width:'100%',background:presetScale===s.label?'rgba(16,185,129,0.15)':'none',border:'none',
                          color:presetScale===s.label?'#4CAF50':'rgba(255,255,255,0.7)',
                          padding:'6px 14px',cursor:'pointer',fontSize:11,textAlign:'left',display:'flex',alignItems:'center',gap:6}}>
                          {presetScale===s.label&&<span style={{color:'#4CAF50',fontSize:9}}>✓</span>}{s.label}
                        </button>
                      ))}
                      <div style={{padding:'6px 12px 2px',fontSize:9,color:'rgba(255,255,255,0.3)',letterSpacing:0.6,position:'sticky',top:0,background:'#1a1a1a'}}>ARCHITECTURAL</div>
                      {CONSTRUCTION_SCALES.filter(s=>s.group==='Architectural').map(s=>(
                        <button key={s.label} onClick={async()=>{
                          const pxPerFt=(planDpi*12)/s.ratio;
                          setScale(pxPerFt); setPresetScale(s.label);
                          if(selPlan?.id&&selPlan.id!=='preview') await supabase.from('precon_plans').update({scale_px_per_ft:pxPerFt}).eq('id',selPlan.id);
                          setShowScalePanel(false);
                        }} style={{width:'100%',background:presetScale===s.label?'rgba(16,185,129,0.15)':'none',border:'none',
                          color:presetScale===s.label?'#4CAF50':'rgba(255,255,255,0.7)',
                          padding:'6px 14px',cursor:'pointer',fontSize:11,textAlign:'left',display:'flex',alignItems:'center',gap:6}}>
                          {presetScale===s.label&&<span style={{color:'#4CAF50',fontSize:9}}>✓</span>}{s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Current scale chip */}
              {scale&&presetScale&&(
                <button onClick={()=>setShowScalePanel(s=>!s)}
                  style={{background:'rgba(0,0,0,0.7)',border:'1px solid rgba(16,185,129,0.4)',color:'#4CAF50',
                    borderRadius:5,padding:'4px 10px',cursor:'pointer',fontSize:11,fontWeight:600,
                    display:'flex',alignItems:'center',gap:5,backdropFilter:'blur(4px)',
                    boxShadow:'0 2px 8px rgba(0,0,0,0.4)'}}>
                  ✓ {presetScale}
                </button>
              )}

              {/* + New Scale / Set Scale button */}
              <button onClick={()=>setShowScalePanel(s=>!s)}
                style={{background:'#4CAF50',border:'none',color:'#fff',
                  borderRadius:6,padding:'5px 14px',cursor:'pointer',fontSize:11,fontWeight:700,
                  boxShadow:'0 2px 8px rgba(16,185,129,0.4)',display:'flex',alignItems:'center',gap:5}}>
                {scale?`⇔ ${scaleLabel(scale, presetScale)}`:'+ Set Scale'}
              </button>
            </div>
          )}
          </div>
        </div>

        {/* ── Right Tool Bar ── */}
        <div style={{width:52,flexShrink:0,display:'flex',flexDirection:'column',borderLeft:`1px solid ${t.border}`,background:t.bg2,alignItems:'center',paddingTop:4,gap:0,overflowY:'auto'}}>
          {[
            {id:'select', icon:'↖', label:'Edit', color:'#666'},
            null,
            {id:'markup_toggle', icon:'M', label:'Markup', color:'#5B9BD5', isSection:true},
            ...(markupMode !== null ? [
              {id:'highlight', icon:'H', label:'Highlight', color:'#FFB347', markup:true},
              {id:'cloud',     icon:'C', label:'Cloud',     color:'#C0504D', markup:true},
              {id:'callout',   icon:'A', label:'Callout',   color:'#E8A317', markup:true},
              {id:'dimension', icon:'D', label:'Dimension', color:'#5B9BD5', markup:true},
              {id:'text',      icon:'T', label:'Text',      color:'#666',    markup:true},
              {id:'legend',    icon:'L', label:'Legend',     color:'#7B6BA4', markup:true},
            ] : []),
            null,
            {id:'takeoff_active', icon:'T', label:'Takeoff', color:'#4CAF50', isLabel:true},
            {id:'cutout', icon:'⊘', label:'Cut Out', color:'#C0504D'},
            {id:'eraser', icon:'⌫', label:'Eraser', color:'#E8A317'},
          ].map((btn,i)=>{
            if(!btn) return <div key={i} style={{height:1,background:t.border,width:32,margin:'3px 0'}}/>;
            const isMarkupActive = btn.markup && markupMode===btn.id;
            const isActive = btn.markup ? isMarkupActive : btn.id==='markup_toggle' ? markupMode!==null : btn.isLabel ? (activeCondId && tool!=='select' && tool!=='eraser' && tool!=='cutout') : tool===btn.id;
            const onClick = ()=>{
              if(btn.isLabel) return; // just a label, not clickable
              if(btn.id==='markup_toggle'){
                setMarkupMode(prev => prev !== null ? null : 'highlight');
                return;
              }
              if(btn.markup){
                setMarkupMode(btn.id);
                setActiveMarkup(null);
                setTool('select'); setActivePts([]); setActiveCondId(null);
                return;
              }
              // Regular tools
              setMarkupMode(null); setActiveMarkup(null);
              if(btn.id==='cutout'){
                setTool('cutout'); setActivePts([]); setActiveCondId(null);
                setScaleStep(null); setShowScalePanel(false);
                setArchMode(false); setArchCtrlPending(false); setArcPending(false);
                setSelectedShapes(new Set()); setEraserHover(null);
                return;
              }
              setTool(btn.id);setActivePts([]);setScaleStep(null);setShowScalePanel(false);
              setArchMode(false);setArchCtrlPending(false);setArcPending(false);
              setSelectedShapes(new Set());setEraserHover(null);
            };
            return(
              <button key={btn.id} onClick={onClick} title={btn.label}
                style={{width:'100%',padding:btn.markup?'5px 0':'7px 0',border:'none',
                  background:isActive?`${btn.color}15`:'none',
                  color:isActive?btn.color:t.text3,cursor:btn.isLabel?'default':'pointer',
                  display:'flex',flexDirection:'column',alignItems:'center',gap:1,
                  borderRight:isActive?`2px solid ${btn.color}`:'2px solid transparent',
                  boxSizing:'border-box',transition:'all 0.1s',
                  opacity:btn.isLabel?0.7:1}}>
                <span style={{fontSize:btn.markup?11:14,lineHeight:1,fontWeight:btn.markup?700:400}}>{btn.icon}</span>
                <span style={{fontSize:8,fontWeight:isActive?600:400,color:isActive?btn.color:t.text4}}>{btn.label}</span>
              </button>
            );
          })}

          {/* Snap toggle [S] — angle snap 45°/60°/90° */}
          <div style={{height:1,background:t.border,width:32,margin:'4px 0'}}/>
          <button onClick={()=>setSnapEnabled(p=>!p)} title="Angle snap 45°/60°/90° [S]"
            style={{width:'100%',padding:'10px 0',border:'none',
              background:snapEnabled?'#facc1518':'none',color:snapEnabled?'#facc15':t.text3,cursor:'pointer',
              display:'flex',flexDirection:'column',alignItems:'center',gap:2,
              borderRight:snapEnabled?'2px solid #facc15':'2px solid transparent',
              boxSizing:'border-box',transition:'all 0.1s'}}>
            <span style={{fontSize:13,lineHeight:1}}>⊕</span>
            <span style={{fontSize:8,fontWeight:600,color:snapEnabled?'#facc15':t.text4,letterSpacing:0.2}}>Snap</span>
            <span style={{fontSize:7,color:snapEnabled?'#facc15':t.text4,opacity:0.7}}>[S]</span>
          </button>

          {/* Arc mode [A] — shown when any takeoff (linear or area) is armed */}
          {activeCondId&&(()=>{
            const ac=itemsRef.current.find(i=>String(i.id)===String(activeCondId));
            if(!ac||(ac.measurement_type!=='linear'&&ac.measurement_type!=='area')) return null;
            const arcOn = arcPending;
            const canArc = activePtsRef.current.length >= 1;
            return(
              <>
                <div style={{height:1,background:t.border,width:32,margin:'4px 0'}}/>
                <button onClick={()=>{
                  if(arcPending){ setArcPending(false); }
                  else if(canArc){ setArcPending(true); }
                }}
                  title="Arc curve [A] — click peak then endpoint"
                  style={{width:'100%',padding:'10px 0',border:'none',
                    background:arcOn?'#7B6BA418':'none',color:arcOn?'#7B6BA4':canArc?t.text3:'#ddd',cursor:canArc?'pointer':'default',
                    display:'flex',flexDirection:'column',alignItems:'center',gap:2,
                    borderRight:arcOn?'2px solid #7B6BA4':'2px solid transparent',
                    boxSizing:'border-box',transition:'all 0.1s'}}>
                  <span style={{fontSize:15,lineHeight:1}}>⌒</span>
                  <span style={{fontSize:8,fontWeight:600,letterSpacing:0.2}}>Arc</span>
                  <span style={{fontSize:7,opacity:0.7}}>[A]</span>
                </button>
              </>
            );
          })()}

          {/* Print page */}
          <div style={{height:1,background:t.border,width:32,margin:'4px 0'}}/>
          <button onClick={()=>window.print()} title="Print page"
            style={{width:'100%',padding:'7px 0',border:'none',background:'none',
              color:t.text3,cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:1}}>
            <span style={{fontSize:14,lineHeight:1}}>&#9113;</span>
            <span style={{fontSize:8,color:t.text4}}>Print</span>
          </button>

          <div style={{flex:1}}/>
          {/* Live measure readout at bottom of tool bar */}
          {arcPending&&(
            <div style={{padding:'6px 2px',textAlign:'center',borderTop:`1px solid #7B6BA430`,width:'100%',background:'#7B6BA410'}}>
              <span style={{fontSize:9,color:'#7B6BA4',fontWeight:700,display:'block',lineHeight:1.4}}>⌒</span>
              <span style={{fontSize:7,color:'#7B6BA4',fontWeight:600,display:'block',lineHeight:1.4}}>
                {activePts[activePts.length-1]?._through ? 'endpoint' : 'peak'}
              </span>
            </div>
          )}
          {snapEnabled&&(
            <div style={{padding:'6px 2px',textAlign:'center',borderTop:`1px solid #facc1530`,width:'100%',background:'#facc1510'}}>
              <span style={{fontSize:9,color:'#facc15',fontWeight:700,display:'block',lineHeight:1.4}}>⊕</span>
              <span style={{fontSize:7,color:'#facc15',fontWeight:600,display:'block',lineHeight:1.4}}>45/60/90°</span>
            </div>
          )}
          {!archMode&&tool==='area'&&activePts.length>=3&&scale&&hoverPt&&(
            <div style={{padding:'6px 2px',textAlign:'center',borderTop:`1px solid ${t.border}`,width:'100%'}}>
              <span style={{fontSize:9,color:'#F59E0B',fontWeight:700,display:'block',lineHeight:1.4}}>
                {Math.round(calcArea([...activePts,hoverPt])*10)/10}
              </span>
              <span style={{fontSize:8,color:t.text4}}>SF</span>
            </div>
          )}
          {!archMode&&tool==='linear'&&activePts.length>=1&&hoverPt&&scale&&(
            <div style={{padding:'6px 2px',textAlign:'center',borderTop:`1px solid ${t.border}`,width:'100%'}}>
              <span style={{fontSize:9,color:'#4A90A4',fontWeight:700,display:'block',lineHeight:1.4}}>
                {Math.round(calcLinear(activePts[activePts.length-1],hoverPt)*10)/10}
              </span>
              <span style={{fontSize:8,color:t.text4}}>LF</span>
            </div>
          )}
        </div>

      </div>}

      {/* ── Full-screen Estimate Page ── */}
      {rightTab==='estimate'&&(()=>{
        const allItems = items.filter(i=>i.plan_id!=null);
        const allCatGroups=TAKEOFF_CATS.map(cat=>{
          const its=allItems.filter(i=>i.category===cat.id);
          return its.length?{...cat,items:its,subtotal:its.reduce((s,i)=>s+(i.total_cost||0),0)}:null;
        }).filter(Boolean);
        const GC_OVERHEAD = overheadPct/100, PROFIT = profitPct/100;
        const extendedCost = allItems.reduce((s,i)=>s+(i.total_cost||0),0);
        const sellingPrice = Math.round(extendedCost*(1+GC_OVERHEAD+PROFIT));
        const netProfit = sellingPrice - extendedCost;
        const netProfitPct = sellingPrice>0 ? (netProfit/sellingPrice*100) : 0;
        const totalSF = allItems.filter(i=>i.unit==='SF').reduce((s,i)=>s+(i.quantity||0),0);
        const pricePerSF = totalSF>0 ? sellingPrice/totalSF : 0;
        const profitPerSF = totalSF>0 ? netProfit/totalSF : 0;

        const sheetBreakdown = plans.map(p=>{
          const pItems = allItems.filter(i=>i.plan_id===p.id);
          const total = pItems.reduce((s,i)=>s+(i.total_cost||0),0);
          return {plan:p, items:pItems, total};
        }).filter(x=>x.items.length>0);

        const doProposalExport = () => {
          const header = ['Category','Description','Qty','Unit','Unit Cost','Extended Cost','Markup %','Total'].join(',');
          const rows = allItems.map(it=>{
            const mkp = it.markup_pct!=null ? it.markup_pct : (GC_OVERHEAD+PROFIT)*100;
            const ext = (it.quantity||0)*(it.unit_cost||0);
            const tot = ext*(1+mkp/100);
            return [
              `"${TAKEOFF_CATS.find(c=>c.id===it.category)?.label||''}"`,
              `"${(it.description||'').replace(/"/g,'""')}"`,
              it.quantity||0, it.unit||'',
              (it.unit_cost||0).toFixed(2), ext.toFixed(2),
              mkp.toFixed(1), tot.toFixed(2)
            ].join(',');
          });
          rows.push('');
          rows.push(`,,,,,"Extended Cost",,${extendedCost.toFixed(2)}`);
          rows.push(`,,,,,"Overhead (${overheadPct}%)",,${Math.round(extendedCost*GC_OVERHEAD)}`);
          rows.push(`,,,,,"Profit (${profitPct}%)",,${Math.round(extendedCost*PROFIT)}`);
          rows.push(`,,,,,"Selling Price",,${sellingPrice}`);
          const csv = [header,...rows].join('\n');
          const blob = new Blob([csv],{type:'text/csv'});
          const a = document.createElement('a');
          a.href=URL.createObjectURL(blob);
          a.download=`${project.name}_proposal.csv`;
          a.click();
        };

        const saveItemField = async (itemId, field, val) => {
          const numVal = ['quantity','unit_cost','markup_pct','waste_pct'].includes(field) ? (parseFloat(val)||0) : val;
          const it = items.find(i=>i.id===itemId);
          if(!it) return;
          const patch = {[field]: numVal};
          if(field==='quantity'||field==='unit_cost'||field==='waste_pct'){
            const qty = field==='quantity' ? numVal : (it.quantity||0);
            const waste = field==='waste_pct' ? numVal : (it.waste_pct||0);
            const uc = field==='unit_cost' ? numVal : (it.unit_cost||0);
            const effectiveQty = qty * (1 + waste/100);
            patch.total_cost = effectiveQty * uc;
          }
          setEstSaving(itemId);
          await supabase.from('takeoff_items').update(patch).eq('id', itemId);
          setItems(prev=>prev.map(i=>i.id===itemId?{...i,...patch}:i));
          setEstSaving(null);
        };

        return(
        <div style={{position:'absolute',inset:0,background:'#fff',zIndex:100,display:'flex',flexDirection:'column',overflow:'hidden'}}>

          {/* ── Header Bar ── */}
          <div style={{display:'flex',alignItems:'center',gap:12,padding:'0 24px',height:52,borderBottom:'1px solid #E0E0E0',background:'#fff',flexShrink:0}}>
            <button onClick={()=>{setRightTab('items');setMainView('workspace');}}
              style={{background:'none',border:'none',color:'#666',padding:'4px 8px',cursor:'pointer',fontSize:18,lineHeight:1}}>
              &#8249;
            </button>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:15,fontWeight:500,color:'#333',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{project.name}</div>
              <div style={{fontSize:11,color:'#999',marginTop:1}}>Updated: {new Date().toLocaleString()}</div>
            </div>
            {/* Three metric badges */}
            <div style={{display:'flex',gap:12,alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 14px',background:'#FEF2F2',borderRadius:4,border:'1px solid #FECACA'}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:'#C0504D'}}/>
                <div><div style={{fontSize:14,fontWeight:600,color:'#333',fontVariantNumeric:'tabular-nums'}}>${extendedCost.toLocaleString()}</div><div style={{fontSize:9,color:'#999'}}>Extended Cost</div></div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 14px',background:'#E8F5E9',borderRadius:4,border:'1px solid #C8E6C9'}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:'#4CAF50'}}/>
                <div><div style={{fontSize:14,fontWeight:600,color:'#333',fontVariantNumeric:'tabular-nums'}}>{netProfitPct.toFixed(2)}%</div><div style={{fontSize:9,color:'#999'}}>Net Profit</div></div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 14px',background:'#E8F5E9',borderRadius:4,border:'1px solid #C8E6C9'}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:'#4CAF50'}}/>
                <div><div style={{fontSize:14,fontWeight:600,color:'#333',fontVariantNumeric:'tabular-nums'}}>${sellingPrice.toLocaleString()}</div><div style={{fontSize:9,color:'#999'}}>Selling Price</div></div>
              </div>
            </div>
            {/* Summary/Worksheet toggle + Download */}
            <div style={{display:'flex',gap:0,border:'1px solid #E0E0E0',borderRadius:4,overflow:'hidden'}}>
              {[{id:'summary',label:'Summary'},{id:'worksheet',label:'Worksheet'}].map(tab=>(
                <button key={tab.id} onClick={()=>setEstSubTab(tab.id)}
                  style={{padding:'6px 16px',border:'none',cursor:'pointer',fontSize:12,fontWeight:500,
                    background:estSubTab===tab.id?'#4CAF50':'#fff',
                    color:estSubTab===tab.id?'#fff':'#666'}}>
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Company selector */}
            <select value={proposalCompany} onChange={e=>setProposalCompany(e.target.value)}
              style={{padding:'6px 10px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:12,color:'#333',background:'#fff',outline:'none',cursor:'pointer'}}>
              <option value="fcg">FCG</option>
              <option value="brc">BR Concrete</option>
              <option value="p4s">P4S Corp</option>
            </select>
            <button onClick={()=>generateProposalPdf({
                project, items, plans, categories:TAKEOFF_CATS,
                overheadPct, profitPct, companyId:proposalCompany,
                clientInfo, companyProfile, proposalScope, proposalTerms,
              })}
              style={{background:'#4CAF50',border:'none',color:'#fff',padding:'6px 14px',borderRadius:4,cursor:'pointer',fontSize:12,fontWeight:500,display:'flex',alignItems:'center',gap:4}}>
              &#8595; Download Proposal PDF
            </button>
            <button onClick={doProposalExport}
              style={{background:'#fff',border:'1px solid #E0E0E0',color:'#666',padding:'6px 14px',borderRadius:4,cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',gap:4}}>
              &#8595; CSV
            </button>
            {regionalData&&(
              <button onClick={async()=>{
                const region = projectRegion;
                const itemsToUpdate = allItems.filter(i=>i.plan_id!=null);
                if(!itemsToUpdate.length){alert('No items to update.');return;}
                const preview = itemsToUpdate.slice(0,5).map(i=>{
                  const newCost = getDefaultCostForCategory(i.category, region, regionalData.pricing, regionalData.multipliers);
                  return `${i.description}: $${(i.unit_cost||0).toFixed(2)} → $${(newCost||i.unit_cost||0).toFixed(2)}`;
                }).join('\n');
                if(!window.confirm(`Update unit costs for ${itemsToUpdate.length} items to ${region} regional pricing?\n\nPreview:\n${preview}${itemsToUpdate.length>5?'\n... and '+(itemsToUpdate.length-5)+' more':''}\n\nThis will overwrite existing costs.`)) return;
                let updated = 0;
                for(const it of itemsToUpdate){
                  const newCost = getDefaultCostForCategory(it.category, region, regionalData.pricing, regionalData.multipliers);
                  if(newCost!=null && newCost !== it.unit_cost){
                    const total_cost = computeTotalCost({...it, unit_cost:newCost});
                    await supabase.from('takeoff_items').update({unit_cost:newCost,total_cost}).eq('id',it.id);
                    setItems(prev=>prev.map(x=>x.id===it.id?{...x,unit_cost:newCost,total_cost}:x));
                    updated++;
                  }
                }
                alert(`Updated ${updated} of ${itemsToUpdate.length} items to ${region} pricing.`);
              }}
                style={{background:'#fff',border:'1px solid #E0E0E0',color:'#5B9BD5',padding:'6px 14px',borderRadius:4,cursor:'pointer',fontSize:12,fontWeight:500}}>
                &#9733; Regional Pricing ({projectRegion})
              </button>
            )}
          </div>

          {/* ── SUMMARY SUB-TAB ── */}
          {estSubTab==='summary'&&(
            <div style={{flex:1,overflowY:'auto',background:'#f5f5f5',padding:24}}>

              {/* ── Proposal Details — 3 cards ── */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:20,maxWidth:1100}}>

                {/* Card 1: Proposal Details */}
                <div style={{background:'#fff',border:'1px solid #E0E0E0',borderRadius:8,padding:20}}>
                  <div style={{fontSize:16,fontWeight:600,color:'#333',marginBottom:16}}>Proposal Details</div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                    <span style={{color:proposalScope?'#4CAF50':'#ccc',fontSize:14}}>{proposalScope?'✓':'○'}</span>
                    <span style={{flex:1,fontSize:13,color:'#333'}}>Scope of Work</span>
                    <button onClick={()=>setEditModal('scope')} style={{background:'none',border:'none',color:'#999',cursor:'pointer',fontSize:12}}>Edit</button>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
                    <span style={{color:proposalTerms?'#4CAF50':'#ccc',fontSize:14}}>{proposalTerms?'✓':'○'}</span>
                    <span style={{flex:1,fontSize:13,color:'#333'}}>Terms and Conditions</span>
                    <button onClick={()=>setEditModal('terms')} style={{background:'none',border:'none',color:'#999',cursor:'pointer',fontSize:12}}>Edit</button>
                  </div>
                  {proposalScope&&proposalTerms?(
                    <div style={{fontSize:12,color:'#4CAF50',fontWeight:500}}>Your proposal is good to go!</div>
                  ):(
                    <div style={{fontSize:12,color:'#999'}}>Complete both sections above</div>
                  )}
                </div>

                {/* Card 2: Client / Prepared For */}
                <div style={{background:'#fff',border:clientInfo.name?'1px solid #E0E0E0':'1px dashed #ccc',borderRadius:8,padding:20}}>
                  <div style={{display:'flex',alignItems:'center',marginBottom:12}}>
                    <span style={{flex:1,fontSize:16,fontWeight:600,color:'#333'}}>{clientInfo.name?`Prepared for ${clientInfo.name}`:'Client Info'}</span>
                    {clientInfo.name&&<button onClick={()=>setEditModal('client')} style={{background:'none',border:'none',color:'#999',cursor:'pointer',fontSize:16}}>&#8942;</button>}
                  </div>
                  {clientInfo.name?(
                    <div style={{fontSize:13,color:'#333',lineHeight:1.7}}>
                      <div style={{fontWeight:600}}>{clientInfo.name}</div>
                      {clientInfo.company&&<div>{clientInfo.company}</div>}
                      {clientInfo.address&&<div style={{color:'#666'}}>{clientInfo.address}</div>}
                      {clientInfo.email&&<div><a href={`mailto:${clientInfo.email}`} style={{color:'#1976D2',textDecoration:'none'}}>{clientInfo.email}</a></div>}
                      {clientInfo.phone&&<div style={{color:'#666'}}>{clientInfo.phone}</div>}
                    </div>
                  ):(
                    <button onClick={()=>setEditModal('client')}
                      style={{background:'none',border:'1px dashed #ccc',color:'#999',padding:'12px 20px',borderRadius:4,cursor:'pointer',fontSize:13,width:'100%'}}>
                      + Add Client
                    </button>
                  )}
                </div>

                {/* Card 3: Your Company */}
                <div style={{background:'#fff',border:companyProfile?.name?'1px solid #E0E0E0':'1px dashed #ccc',borderRadius:8,padding:20}}>
                  <div style={{display:'flex',alignItems:'center',marginBottom:12}}>
                    <span style={{flex:1,fontSize:16,fontWeight:600,color:'#333'}}>{companyProfile?.name||'Your Company'}</span>
                    {companyProfile?.name&&<button onClick={()=>setEditModal('company')} style={{background:'none',border:'none',color:'#999',cursor:'pointer',fontSize:16}}>&#8942;</button>}
                  </div>
                  {companyProfile?.name?(
                    <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                      <div style={{width:36,height:36,borderRadius:'50%',background:'#4CAF50',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:16,flexShrink:0}}>
                        {companyProfile.name[0]}
                      </div>
                      <div style={{fontSize:13,color:'#333',lineHeight:1.7}}>
                        <div style={{fontWeight:600}}>{companyProfile.name}</div>
                        {companyProfile.address&&<div style={{color:'#666'}}>{companyProfile.address}</div>}
                        {companyProfile.city&&<div style={{color:'#666'}}>{companyProfile.city}</div>}
                        {companyProfile.email&&<div><a href={`mailto:${companyProfile.email}`} style={{color:'#1976D2',textDecoration:'none'}}>{companyProfile.email}</a></div>}
                        {companyProfile.phone&&<div style={{color:'#666'}}>{companyProfile.phone}</div>}
                      </div>
                    </div>
                  ):(
                    <button onClick={()=>setEditModal('company')}
                      style={{background:'none',border:'1px dashed #ccc',color:'#999',padding:'12px 20px',borderRadius:4,cursor:'pointer',fontSize:13,width:'100%'}}>
                      + Add Company Profile
                    </button>
                  )}
                </div>
              </div>

              {/* ── Modals ── */}
              {editModal==='scope'&&(
                <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setEditModal(null)}>
                  <div style={{background:'#fff',borderRadius:8,padding:24,width:560,maxHeight:'80vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
                    <div style={{fontSize:16,fontWeight:600,color:'#333',marginBottom:12}}>Scope of Work</div>
                    <textarea defaultValue={proposalScope} id="_scopeTA" rows={10}
                      style={{width:'100%',border:'1px solid #E0E0E0',borderRadius:4,padding:12,fontSize:13,color:'#333',outline:'none',resize:'vertical',boxSizing:'border-box'}}
                      placeholder="Describe the scope of work for this proposal..."/>
                    <div style={{display:'flex',gap:8,marginTop:12,justifyContent:'flex-end'}}>
                      <button onClick={()=>setEditModal(null)} style={{background:'#fff',border:'1px solid #E0E0E0',color:'#666',padding:'8px 16px',borderRadius:4,cursor:'pointer',fontSize:12}}>Cancel</button>
                      <button onClick={()=>{
                        const v=document.getElementById('_scopeTA').value;
                        setProposalScope(v);
                        try{localStorage.setItem(`proposalScope_${project.id}`,v);}catch{}
                        setEditModal(null);
                      }} style={{background:'#4CAF50',border:'none',color:'#fff',padding:'8px 16px',borderRadius:4,cursor:'pointer',fontSize:12,fontWeight:500}}>Save</button>
                    </div>
                  </div>
                </div>
              )}
              {editModal==='terms'&&(
                <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setEditModal(null)}>
                  <div style={{background:'#fff',borderRadius:8,padding:24,width:560,maxHeight:'80vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
                    <div style={{fontSize:16,fontWeight:600,color:'#333',marginBottom:12}}>Terms and Conditions</div>
                    <div style={{fontSize:11,color:'#999',marginBottom:8}}>One term per line. These appear as bullet points on the proposal PDF.</div>
                    <textarea defaultValue={proposalTerms} id="_termsTA" rows={12}
                      style={{width:'100%',border:'1px solid #E0E0E0',borderRadius:4,padding:12,fontSize:13,color:'#333',outline:'none',resize:'vertical',boxSizing:'border-box'}}
                      placeholder={"We are insured and bondable (Bond not included).\nThis bid is good for thirty (30) days.\nWe exclude rock demolition.\n..."}/>
                    <div style={{display:'flex',gap:8,marginTop:12,justifyContent:'flex-end'}}>
                      <button onClick={()=>setEditModal(null)} style={{background:'#fff',border:'1px solid #E0E0E0',color:'#666',padding:'8px 16px',borderRadius:4,cursor:'pointer',fontSize:12}}>Cancel</button>
                      <button onClick={()=>{
                        const v=document.getElementById('_termsTA').value;
                        setProposalTerms(v);
                        try{localStorage.setItem(`proposalTerms_${project.id}`,v);}catch{}
                        setEditModal(null);
                      }} style={{background:'#4CAF50',border:'none',color:'#fff',padding:'8px 16px',borderRadius:4,cursor:'pointer',fontSize:12,fontWeight:500}}>Save</button>
                    </div>
                  </div>
                </div>
              )}
              {editModal==='client'&&(
                <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setEditModal(null)}>
                  <div style={{background:'#fff',borderRadius:8,padding:24,width:440}} onClick={e=>e.stopPropagation()}>
                    <div style={{fontSize:16,fontWeight:600,color:'#333',marginBottom:16}}>Client / Prepared For</div>
                    {[['name','Contact Name'],['company','Company'],['address','Address'],['email','Email'],['phone','Phone']].map(([k,lbl])=>(
                      <div key={k} style={{marginBottom:10}}>
                        <div style={{fontSize:12,color:'#666',marginBottom:4}}>{lbl}</div>
                        <input defaultValue={clientInfo[k]||''} id={`_client_${k}`}
                          style={{width:'100%',border:'1px solid #E0E0E0',borderRadius:4,padding:'8px 10px',fontSize:13,color:'#333',outline:'none',boxSizing:'border-box'}}/>
                      </div>
                    ))}
                    <div style={{display:'flex',gap:8,marginTop:16,justifyContent:'flex-end'}}>
                      <button onClick={()=>setEditModal(null)} style={{background:'#fff',border:'1px solid #E0E0E0',color:'#666',padding:'8px 16px',borderRadius:4,cursor:'pointer',fontSize:12}}>Cancel</button>
                      <button onClick={async()=>{
                        const ci={};
                        ['name','company','address','email','phone'].forEach(k=>{ci[k]=document.getElementById(`_client_${k}`).value.trim();});
                        setClientInfo(ci);
                        await supabase.from('precon_projects').update({
                          client_name:ci.name,client_company:ci.company,client_address:ci.address,client_email:ci.email,client_phone:ci.phone
                        }).eq('id',project.id);
                        setEditModal(null);
                      }} style={{background:'#4CAF50',border:'none',color:'#fff',padding:'8px 16px',borderRadius:4,cursor:'pointer',fontSize:12,fontWeight:500}}>Save</button>
                    </div>
                  </div>
                </div>
              )}
              {editModal==='company'&&(
                <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setEditModal(null)}>
                  <div style={{background:'#fff',borderRadius:8,padding:24,width:440}} onClick={e=>e.stopPropagation()}>
                    <div style={{fontSize:16,fontWeight:600,color:'#333',marginBottom:16}}>Your Company Profile</div>
                    {[['name','Company Name'],['address','Address'],['city','City, State, ZIP'],['phone','Phone'],['email','Email']].map(([k,lbl])=>(
                      <div key={k} style={{marginBottom:10}}>
                        <div style={{fontSize:12,color:'#666',marginBottom:4}}>{lbl}</div>
                        <input defaultValue={companyProfile?.[k]||''} id={`_co_${k}`}
                          style={{width:'100%',border:'1px solid #E0E0E0',borderRadius:4,padding:'8px 10px',fontSize:13,color:'#333',outline:'none',boxSizing:'border-box'}}/>
                      </div>
                    ))}
                    <div style={{display:'flex',gap:8,marginTop:16,justifyContent:'flex-end'}}>
                      <button onClick={()=>setEditModal(null)} style={{background:'#fff',border:'1px solid #E0E0E0',color:'#666',padding:'8px 16px',borderRadius:4,cursor:'pointer',fontSize:12}}>Cancel</button>
                      <button onClick={()=>{
                        const cp={};
                        ['name','address','city','phone','email'].forEach(k=>{cp[k]=document.getElementById(`_co_${k}`).value.trim();});
                        setCompanyProfile(cp);
                        try{localStorage.setItem('companyProfile',JSON.stringify(cp));}catch{}
                        setEditModal(null);
                      }} style={{background:'#4CAF50',border:'none',color:'#fff',padding:'8px 16px',borderRadius:4,cursor:'pointer',fontSize:12,fontWeight:500}}>Save</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Top row: Summary By SF + Details By SF */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20,maxWidth:1100}}>
                {/* Summary By Square Foot */}
                <div style={{background:'#fff',border:'1px solid #E0E0E0',borderRadius:4,overflow:'hidden'}}>
                  <div style={{padding:'14px 20px',borderBottom:'1px solid #E0E0E0',display:'flex',alignItems:'center'}}>
                    <span style={{fontSize:14,fontWeight:600,color:'#333',flex:1}}>Summary By Square Foot</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:0}}>
                    <div style={{padding:'16px 20px',borderRight:'1px solid #E0E0E0',textAlign:'center'}}>
                      <div style={{fontSize:24,fontWeight:700,color:'#333',fontVariantNumeric:'tabular-nums'}}>{totalSF>0?Math.round(totalSF).toLocaleString():'—'}</div>
                      <div style={{fontSize:10,color:'#999',marginTop:2}}>SQ FT</div>
                      <div style={{fontSize:11,color:'#666',marginTop:4}}>Project Size</div>
                    </div>
                    <div style={{padding:'16px 20px',borderRight:'1px solid #E0E0E0',textAlign:'center',background:'#E8F5E9'}}>
                      <div style={{fontSize:24,fontWeight:700,color:'#333',fontVariantNumeric:'tabular-nums'}}>${pricePerSF.toFixed(2)}</div>
                      <div style={{fontSize:10,color:'#999',marginTop:2}}>/SQ FT</div>
                      <div style={{fontSize:11,color:'#4CAF50',marginTop:4}}>Selling Price</div>
                    </div>
                    <div style={{padding:'16px 20px',textAlign:'center',background:'#E8F5E9'}}>
                      <div style={{fontSize:24,fontWeight:700,color:'#333',fontVariantNumeric:'tabular-nums'}}>${profitPerSF.toFixed(2)}</div>
                      <div style={{fontSize:10,color:'#999',marginTop:2}}>/SQ FT</div>
                      <div style={{fontSize:11,color:'#4CAF50',marginTop:4}}>Net Profit</div>
                    </div>
                  </div>
                </div>

                {/* Project Markups */}
                <div style={{background:'#fff',border:'1px solid #E0E0E0',borderRadius:4,overflow:'hidden'}}>
                  <div style={{padding:'14px 20px',borderBottom:'1px solid #E0E0E0'}}>
                    <span style={{fontSize:14,fontWeight:600,color:'#333'}}>Project Markups</span>
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr style={{background:'#f5f5f5'}}>
                      <th style={{textAlign:'left',padding:'8px 14px',fontSize:11,fontWeight:600,color:'#666'}}>Item</th>
                      <th style={{textAlign:'right',padding:'8px 14px',fontSize:11,fontWeight:600,color:'#666'}}>Extended Cost</th>
                      <th style={{textAlign:'right',padding:'8px 14px',fontSize:11,fontWeight:600,color:'#666'}}>Markup</th>
                      <th style={{textAlign:'right',padding:'8px 14px',fontSize:11,fontWeight:600,color:'#666'}}>Selling Price</th>
                    </tr></thead>
                    <tbody>
                      <tr style={{borderBottom:'1px solid #E0E0E0'}}>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#333'}}>Direct Cost</td>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#333',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${extendedCost.toLocaleString()}</td>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#333',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>—</td>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#333',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${extendedCost.toLocaleString()}</td>
                      </tr>
                      <tr style={{borderBottom:'1px solid #E0E0E0'}}>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#333',display:'flex',alignItems:'center',gap:6}}>
                          Overhead
                          <div style={{display:'inline-flex',alignItems:'center',background:'#f5f5f5',borderRadius:3,border:'1px solid #E0E0E0',padding:'1px 4px'}}>
                            <input type="number" value={overheadPct} onChange={e=>setOverheadPct(Math.max(0,Number(e.target.value)||0))}
                              style={{width:36,background:'none',border:'none',color:'#333',fontSize:11,textAlign:'right',outline:'none',padding:0}}/>
                            <span style={{fontSize:10,color:'#999'}}>%</span>
                          </div>
                        </td>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#666',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${extendedCost.toLocaleString()}</td>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#E8A317',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${Math.round(extendedCost*GC_OVERHEAD).toLocaleString()}</td>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#333',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${Math.round(extendedCost*(1+GC_OVERHEAD)).toLocaleString()}</td>
                      </tr>
                      <tr style={{borderBottom:'1px solid #E0E0E0'}}>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#333',display:'flex',alignItems:'center',gap:6}}>
                          Profit
                          <div style={{display:'inline-flex',alignItems:'center',background:'#f5f5f5',borderRadius:3,border:'1px solid #E0E0E0',padding:'1px 4px'}}>
                            <input type="number" value={profitPct} onChange={e=>setProfitPct(Math.max(0,Number(e.target.value)||0))}
                              style={{width:36,background:'none',border:'none',color:'#333',fontSize:11,textAlign:'right',outline:'none',padding:0}}/>
                            <span style={{fontSize:10,color:'#999'}}>%</span>
                          </div>
                        </td>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#666',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${extendedCost.toLocaleString()}</td>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#4CAF50',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${Math.round(extendedCost*PROFIT).toLocaleString()}</td>
                        <td style={{padding:'8px 14px',fontSize:12,color:'#333',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${Math.round(extendedCost*(1+PROFIT)).toLocaleString()}</td>
                      </tr>
                    </tbody>
                    <tfoot><tr style={{background:'#f5f5f5'}}>
                      <td style={{padding:'10px 14px',fontSize:13,fontWeight:700,color:'#333'}}>Total</td>
                      <td style={{padding:'10px 14px',fontSize:13,fontWeight:700,color:'#333',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${extendedCost.toLocaleString()}</td>
                      <td style={{padding:'10px 14px',fontSize:13,fontWeight:700,color:'#E8A317',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${(sellingPrice-extendedCost).toLocaleString()}</td>
                      <td style={{padding:'10px 14px',fontSize:13,fontWeight:700,color:'#4CAF50',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>${sellingPrice.toLocaleString()}</td>
                    </tr></tfoot>
                  </table>
                </div>
              </div>

              {/* Bottom row: Category + Sheet breakdowns */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,maxWidth:1100}}>
                {/* By Category */}
                <div style={{background:'#fff',border:'1px solid #E0E0E0',borderRadius:4,overflow:'hidden'}}>
                  <div style={{padding:'14px 20px',borderBottom:'1px solid #E0E0E0'}}>
                    <span style={{fontSize:14,fontWeight:600,color:'#333'}}>By Category</span>
                  </div>
                  {allCatGroups.map(cg=>(
                    <div key={cg.id} style={{display:'flex',alignItems:'center',padding:'10px 20px',borderBottom:'1px solid #f0f0f0'}}>
                      <div style={{width:10,height:10,borderRadius:2,background:cg.color,flexShrink:0,marginRight:12}}/>
                      <span style={{flex:1,fontSize:13,color:'#333'}}>{cg.label}</span>
                      <span style={{fontSize:12,color:'#999',fontVariantNumeric:'tabular-nums',marginRight:16}}>{cg.items.length} items</span>
                      <span style={{fontSize:13,fontWeight:600,color:'#333',fontVariantNumeric:'tabular-nums'}}>${Math.round(cg.subtotal).toLocaleString()}</span>
                    </div>
                  ))}
                  <div style={{display:'flex',alignItems:'center',padding:'12px 20px',background:'#f5f5f5'}}>
                    <span style={{flex:1,fontSize:13,fontWeight:700,color:'#333'}}>Total</span>
                    <span style={{fontSize:14,fontWeight:700,color:'#4CAF50',fontVariantNumeric:'tabular-nums'}}>${extendedCost.toLocaleString()}</span>
                  </div>
                </div>

                {/* By Sheet */}
                <div style={{background:'#fff',border:'1px solid #E0E0E0',borderRadius:4,overflow:'hidden'}}>
                  <div style={{padding:'14px 20px',borderBottom:'1px solid #E0E0E0'}}>
                    <span style={{fontSize:14,fontWeight:600,color:'#333'}}>By Sheet</span>
                  </div>
                  {sheetBreakdown.map(({plan:p,items:pItems,total:pTotal})=>(
                    <div key={p.id} style={{display:'flex',alignItems:'center',padding:'10px 20px',borderBottom:'1px solid #f0f0f0',cursor:'pointer'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#fafafa'}
                      onMouseLeave={e=>e.currentTarget.style.background='#fff'}
                      onClick={()=>{setSelPlan(p);if(p.scale_px_per_ft)setScale(p.scale_px_per_ft);setEstSubTab('worksheet');}}>
                      <span style={{flex:1,fontSize:13,color:'#333',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name||'Unnamed'}</span>
                      <span style={{fontSize:12,color:'#999',fontVariantNumeric:'tabular-nums',marginRight:16}}>{pItems.length} items</span>
                      <span style={{fontSize:13,fontWeight:600,color:'#333',fontVariantNumeric:'tabular-nums'}}>${Math.round(pTotal).toLocaleString()}</span>
                    </div>
                  ))}
                  {sheetBreakdown.length===0&&<div style={{padding:'20px',color:'#999',fontSize:12,textAlign:'center'}}>No sheets with items</div>}
                </div>
              </div>
            </div>
          )}

          {/* ── WORKSHEET SUB-TAB ── */}
          {estSubTab==='worksheet'&&(()=>{
            // Build groups based on estGroupBy
            const wsItems = allItems;
            const wsGroups = [];
            if(estGroupBy==='none'){
              wsGroups.push({key:'all',label:'All Items',color:'#666',items:wsItems});
            } else {
              const groupMap = new Map();
              for(const it of wsItems){
                let key,label,color;
                if(estGroupBy==='category'){
                  const cat=TAKEOFF_CATS.find(c=>c.id===it.category)||TAKEOFF_CATS[TAKEOFF_CATS.length-1];
                  key=cat.id; label=cat.label; color=cat.color;
                } else if(estGroupBy==='sheet'){
                  const p=planMap.get(it.plan_id);
                  key=it.plan_id||'none'; label=p?.name||'Unassigned'; color='#5B9BD5';
                } else if(estGroupBy==='trade'){
                  key=it.trade||'Unassigned'; label=it.trade||'Unassigned'; color='#7B6BA4';
                } else if(estGroupBy==='location'){
                  key=it.location||'Unassigned'; label=it.location||'Unassigned'; color='#4A90A4';
                }
                if(!groupMap.has(key)) groupMap.set(key,{key,label,color,items:[]});
                groupMap.get(key).items.push(it);
              }
              wsGroups.push(...groupMap.values());
            }
            const editCell={fontSize:13,color:'#333',padding:'8px 12px',borderBottom:'1px solid #E0E0E0',verticalAlign:'middle'};
            const editInput={background:'transparent',border:'none',outline:'none',width:'100%',fontSize:13,color:'#333',padding:0};
            const thStyle={background:'#4CAF50',color:'#fff',fontSize:12,fontWeight:700,padding:'10px 12px'};
            return(
          <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
            {/* Toolbar */}
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 16px',borderBottom:'1px solid #E0E0E0',flexShrink:0}}>
              <span style={{fontSize:12,color:'#666'}}>Group by:</span>
              <select value={estGroupBy} onChange={e=>setEstGroupBy(e.target.value)}
                style={{padding:'4px 10px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:12,color:'#333',background:'#fff',outline:'none',cursor:'pointer'}}>
                <option value="category">Category</option>
                <option value="sheet">Sheet</option>
                <option value="trade">Trade</option>
                <option value="location">Location</option>
                <option value="none">No Grouping</option>
              </select>
              <div style={{flex:1}}/>
              <span style={{fontSize:12,color:'#999'}}>{wsItems.length} items</span>
            </div>
            {/* Worksheet table */}
            <div style={{flex:1,overflowY:'auto',overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',minWidth:1000}}>
                <thead style={{position:'sticky',top:0,zIndex:2}}>
                  <tr>
                    <th style={{...thStyle,textAlign:'center',width:36}}>#</th>
                    <th style={{...thStyle,textAlign:'left'}}>Description</th>
                    <th style={{...thStyle,textAlign:'left',width:80}}>{estGroupBy==='category'?'Category':estGroupBy==='trade'?'Trade':estGroupBy==='location'?'Location':'Sheet'}</th>
                    <th style={{...thStyle,textAlign:'right',width:90}}>Takeoff Qty</th>
                    <th style={{...thStyle,textAlign:'center',width:50}}>Unit</th>
                    <th style={{...thStyle,textAlign:'right',width:80}}>Unit Cost</th>
                    <th style={{...thStyle,textAlign:'right',width:100}}>Extended Cost</th>
                    <th style={{...thStyle,textAlign:'right',width:80}}>Markup %</th>
                    <th style={{...thStyle,textAlign:'right',width:100}}>Total</th>
                    <th style={{...thStyle,width:32}}/>
                  </tr>
                </thead>
                <tbody>
                  {wsGroups.map(grp=>{
                    const grpSubtotal=grp.items.reduce((s,i)=>s+(i.total_cost||0),0);
                    const grpExtended=grp.items.reduce((s,i)=>s+((i.quantity||0)*(i.unit_cost||0)),0);
                    const collapsed=collapsedEstGroups[grp.key];
                    return(
                    <React.Fragment key={grp.key}>
                      {estGroupBy!=='none'&&(
                        <tr style={{cursor:'pointer'}} onClick={()=>setCollapsedEstGroups(prev=>({...prev,[grp.key]:!prev[grp.key]}))}>
                          <td colSpan={10} style={{background:`${grp.color}10`,padding:'8px 12px',fontSize:12,fontWeight:700,color:grp.color,borderBottom:'1px solid #E0E0E0',borderLeft:`3px solid ${grp.color}`}}>
                            <span style={{fontSize:10,marginRight:6,color:'#999'}}>{collapsed?'▶':'▼'}</span>
                            {grp.label} <span style={{fontWeight:400,color:'#999',marginLeft:6}}>({grp.items.length})</span>
                            <span style={{float:'right',fontVariantNumeric:'tabular-nums'}}>${Math.round(grpSubtotal).toLocaleString()}</span>
                          </td>
                        </tr>
                      )}
                      {!collapsed&&grp.items.map((it,idx)=>{
                        const extCost=(it.quantity||0)*(it.unit_cost||0);
                        const mkp=it.markup_pct!=null?it.markup_pct:Math.round((GC_OVERHEAD+PROFIT)*100*10)/10;
                        const total=extCost*(1+mkp/100);
                        const isSaving=estSaving===it.id;
                        const cat=TAKEOFF_CATS.find(c=>c.id===it.category)||TAKEOFF_CATS[TAKEOFF_CATS.length-1];
                        const grpLabel = estGroupBy==='category'?cat.label:estGroupBy==='sheet'?(planMap.get(it.plan_id)?.name||'—'):estGroupBy==='trade'?(it.trade||'—'):(it.location||'—');
                        return(
                          <tr key={it.id} onMouseEnter={e=>e.currentTarget.style.background='#fafafa'} onMouseLeave={e=>e.currentTarget.style.background='#fff'} style={{background:'#fff'}}>
                            <td style={{...editCell,textAlign:'center',color:'#999',fontSize:11}}>{idx+1}</td>
                            <td style={editCell}>
                              <div style={{display:'flex',alignItems:'center',gap:8}}>
                                <div style={{width:8,height:8,borderRadius:2,background:it.color||cat.color,flexShrink:0}}/>
                                <input defaultValue={it.description||''} onBlur={e=>{if(e.target.value!==it.description)saveItemField(it.id,'description',e.target.value);}} onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}} style={{...editInput,cursor:'text'}}/>
                              </div>
                            </td>
                            <td style={{...editCell,fontSize:11,color:'#666'}}>
                              {estGroupBy==='trade'||estGroupBy==='location'?(
                                <input defaultValue={estGroupBy==='trade'?(it.trade||''):(it.location||'')} onBlur={e=>saveItemField(it.id,estGroupBy,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}} style={{...editInput,fontSize:11,color:'#666'}} placeholder="—"/>
                              ):grpLabel}
                            </td>
                            <td style={{...editCell,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{getDisplayQtyUnit(it).qty.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                            <td style={{...editCell,textAlign:'center',color:'#666'}}>{getDisplayQtyUnit(it).unit||'—'}</td>
                            <td style={editCell}>
                              <input type="number" step="0.01" defaultValue={(it.unit_cost||0).toFixed(2)} onBlur={e=>{if(parseFloat(e.target.value)!==(it.unit_cost||0))saveItemField(it.id,'unit_cost',e.target.value);}} onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}} onFocus={e=>e.target.style.borderBottom='2px solid #5B9BD5'} onBlurCapture={e=>e.target.style.borderBottom='none'} style={{...editInput,textAlign:'right',fontVariantNumeric:'tabular-nums'}}/>
                            </td>
                            <td style={{...editCell,textAlign:'right',fontVariantNumeric:'tabular-nums',fontWeight:500}}>${Math.round(extCost).toLocaleString()}</td>
                            <td style={editCell}>
                              <input type="number" step="0.1" defaultValue={mkp} onBlur={e=>saveItemField(it.id,'markup_pct',e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}} onFocus={e=>e.target.style.borderBottom='2px solid #5B9BD5'} onBlurCapture={e=>e.target.style.borderBottom='none'} style={{...editInput,textAlign:'right',fontVariantNumeric:'tabular-nums'}}/>
                            </td>
                            <td style={{...editCell,textAlign:'right',fontWeight:600,color:'#4CAF50',fontVariantNumeric:'tabular-nums'}}>{isSaving?'…':'$'+Math.round(total).toLocaleString()}</td>
                            <td style={{...editCell,textAlign:'center'}}>
                              <button onClick={async()=>{if(!window.confirm('Delete '+it.description+'?'))return;await supabase.from('takeoff_items').delete().eq('id',it.id).select();setItems(prev=>prev.filter(i=>i.id!==it.id));}} style={{background:'none',border:'none',color:'#ccc',cursor:'pointer',fontSize:12}}>&#10005;</button>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Group subtotal */}
                      {!collapsed&&estGroupBy!=='none'&&grp.items.length>0&&(
                        <tr style={{background:'#f9f9f9'}}>
                          <td colSpan={6} style={{...editCell,fontWeight:600,fontSize:11,color:'#999',borderBottom:'2px solid #E0E0E0'}}>Subtotal: {grp.label}</td>
                          <td style={{...editCell,textAlign:'right',fontWeight:600,fontVariantNumeric:'tabular-nums',borderBottom:'2px solid #E0E0E0'}}>${Math.round(grpExtended).toLocaleString()}</td>
                          <td style={{...editCell,borderBottom:'2px solid #E0E0E0'}}/>
                          <td style={{...editCell,textAlign:'right',fontWeight:600,color:'#4CAF50',fontVariantNumeric:'tabular-nums',borderBottom:'2px solid #E0E0E0'}}>${Math.round(grpSubtotal).toLocaleString()}</td>
                          <td style={{...editCell,borderBottom:'2px solid #E0E0E0'}}/>
                        </tr>
                      )}
                    </React.Fragment>
                    );
                  })}
                </tbody>
                {wsItems.length>0&&(
                  <tfoot>
                    <tr style={{background:'#f5f5f5'}}>
                      <td colSpan={6} style={{padding:'12px',fontSize:13,fontWeight:700,color:'#333'}}>TOTAL</td>
                      <td style={{padding:'12px',textAlign:'right',fontSize:14,fontWeight:700,color:'#333',fontVariantNumeric:'tabular-nums'}}>${extendedCost.toLocaleString()}</td>
                      <td style={{padding:'12px'}}/>
                      <td style={{padding:'12px',textAlign:'right',fontSize:14,fontWeight:700,color:'#4CAF50',fontVariantNumeric:'tabular-nums'}}>${sellingPrice.toLocaleString()}</td>
                      <td/>
                    </tr>
                  </tfoot>
                )}
              </table>
              {wsItems.length===0&&<div style={{textAlign:'center',padding:60,color:'#999',fontSize:13}}>No takeoff items yet</div>}
            </div>

            {/* Bottom summary bar */}
            <div style={{display:'flex',alignItems:'center',gap:20,padding:'10px 24px',borderTop:'1px solid #E0E0E0',background:'#fff',flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,color:'#999'}}>Extended Cost:</span>
                <span style={{fontSize:14,fontWeight:600,color:'#333',fontVariantNumeric:'tabular-nums'}}>${extendedCost.toLocaleString()}</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,color:'#999'}}>Net Profit:</span>
                <span style={{fontSize:14,fontWeight:600,color:'#4CAF50',fontVariantNumeric:'tabular-nums'}}>{netProfitPct.toFixed(1)}%</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,color:'#999'}}>Selling Price:</span>
                <span style={{fontSize:14,fontWeight:600,color:'#4CAF50',fontVariantNumeric:'tabular-nums'}}>${sellingPrice.toLocaleString()}</span>
              </div>
              <div style={{flex:1}}/>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:12,color:'#999'}}>Overhead:</span>
                <input type="number" value={overheadPct} onChange={e=>setOverheadPct(Math.max(0,Number(e.target.value)||0))}
                  style={{width:40,background:'#f5f5f5',border:'1px solid #E0E0E0',borderRadius:3,color:'#333',fontSize:12,textAlign:'right',outline:'none',padding:'2px 4px'}}/>
                <span style={{fontSize:11,color:'#999'}}>%</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:12,color:'#999'}}>Profit:</span>
                <input type="number" value={profitPct} onChange={e=>setProfitPct(Math.max(0,Number(e.target.value)||0))}
                  style={{width:40,background:'#f5f5f5',border:'1px solid #E0E0E0',borderRadius:3,color:'#333',fontSize:12,textAlign:'right',outline:'none',padding:'2px 4px'}}/>
                <span style={{fontSize:11,color:'#999'}}>%</span>
              </div>
            </div>
          </div>
          );
          })()}
        </div>
        );
      })()}
      {/* Category Manager Modal */}
      {showCatManager&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowCatManager(false)}>
          <div style={{background:'#fff',borderRadius:8,width:500,maxHeight:'80vh',display:'flex',flexDirection:'column',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid #E0E0E0',display:'flex',alignItems:'center'}}>
              <span style={{fontSize:16,fontWeight:600,color:'#333',flex:1}}>Manage Categories</span>
              <button onClick={()=>setShowCatManager(false)} style={{background:'none',border:'none',color:'#999',cursor:'pointer',fontSize:18}}>&times;</button>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
              {TAKEOFF_CATS.map(cat=>(
                <div key={cat.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 20px',borderBottom:'1px solid #f0f0f0'}}>
                  <div style={{width:16,height:16,borderRadius:3,background:cat.color,flexShrink:0,cursor:'pointer'}}
                    onClick={()=>setEditCat({...cat})}/>
                  <span style={{flex:1,fontSize:13,color:'#333'}}>{cat.label}</span>
                  <span style={{fontSize:11,color:'#999',width:30,textAlign:'center'}}>{cat.unit}</span>
                  <span style={{fontSize:11,color:'#666',fontVariantNumeric:'tabular-nums',width:55,textAlign:'right'}}>${(cat.default_cost||cat.defaultCost||0).toLocaleString()}</span>
                  <button onClick={()=>setEditCat({...cat})} style={{background:'none',border:'none',color:'#999',cursor:'pointer',fontSize:11}}>Edit</button>
                  <button onClick={async()=>{
                    const used=items.filter(i=>i.category===cat.id).length;
                    if(used>0){alert(`Cannot delete — ${used} items use this category.`);return;}
                    if(!window.confirm('Delete "'+cat.label+'"?'))return;
                    await supabase.from('takeoff_categories').delete().eq('id',cat.id);
                    setDynamicCats(prev=>prev.filter(c=>c.id!==cat.id));
                  }} style={{background:'none',border:'none',color:'#ccc',cursor:'pointer',fontSize:14}}>&times;</button>
                </div>
              ))}
            </div>
            <div style={{padding:'12px 20px',borderTop:'1px solid #E0E0E0',display:'flex',gap:8}}>
              <button onClick={()=>setEditCat({id:'cat_'+Date.now(),label:'',color:'#94A3B8',unit:'SF',default_cost:0,sort_order:TAKEOFF_CATS.length})}
                style={{background:'#4CAF50',border:'none',color:'#fff',padding:'8px 16px',borderRadius:4,cursor:'pointer',fontSize:12,fontWeight:500}}>
                + Add Category
              </button>
              <div style={{flex:1}}/>
            </div>
          </div>
        </div>
      )}
      {/* Edit Category Modal */}
      {editCat&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:210,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setEditCat(null)}>
          <div style={{background:'#fff',borderRadius:8,padding:24,width:380}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:16,fontWeight:600,color:'#333',marginBottom:16}}>{dynamicCats?.find(c=>c.id===editCat.id)?'Edit Category':'New Category'}</div>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:12,color:'#666',marginBottom:4}}>Name</div>
              <input value={editCat.label} onChange={e=>setEditCat(prev=>({...prev,label:e.target.value}))}
                style={{width:'100%',padding:'8px 10px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:13,color:'#333',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:10}}>
              <div>
                <div style={{fontSize:12,color:'#666',marginBottom:4}}>Color</div>
                <input type="color" value={editCat.color||'#94A3B8'} onChange={e=>setEditCat(prev=>({...prev,color:e.target.value}))}
                  style={{width:'100%',height:36,border:'1px solid #E0E0E0',borderRadius:4,cursor:'pointer'}}/>
              </div>
              <div>
                <div style={{fontSize:12,color:'#666',marginBottom:4}}>Unit</div>
                <select value={editCat.unit||'SF'} onChange={e=>setEditCat(prev=>({...prev,unit:e.target.value}))}
                  style={{width:'100%',padding:'8px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:12,outline:'none'}}>
                  {['SF','LF','CY','EA','LS','TN','LB','HR'].map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <div style={{fontSize:12,color:'#666',marginBottom:4}}>Default Cost</div>
                <input type="number" step="0.01" value={editCat.default_cost||editCat.defaultCost||''} onChange={e=>setEditCat(prev=>({...prev,default_cost:Number(e.target.value)||0}))}
                  style={{width:'100%',padding:'8px 10px',border:'1px solid #E0E0E0',borderRadius:4,fontSize:13,outline:'none',boxSizing:'border-box'}}/>
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:16,justifyContent:'flex-end'}}>
              <button onClick={()=>setEditCat(null)} style={{padding:'8px 14px',border:'1px solid #E0E0E0',background:'#fff',color:'#666',borderRadius:4,cursor:'pointer',fontSize:12}}>Cancel</button>
              <button disabled={!editCat.label?.trim()} onClick={async()=>{
                const payload={id:editCat.id,label:editCat.label.trim(),color:editCat.color,unit:editCat.unit,default_cost:editCat.default_cost||0,sort_order:editCat.sort_order||0};
                const existing=dynamicCats?.find(c=>c.id===editCat.id);
                if(existing){
                  await supabase.from('takeoff_categories').update(payload).eq('id',editCat.id);
                  setDynamicCats(prev=>prev.map(c=>c.id===editCat.id?{...c,...payload}:c));
                } else {
                  const {data}=await supabase.from('takeoff_categories').insert([{...payload,is_default:false}]).select().single();
                  if(data) setDynamicCats(prev=>[...prev,data]);
                }
                setEditCat(null);
              }} style={{padding:'8px 16px',background:'#4CAF50',border:'none',color:'#fff',borderRadius:4,cursor:'pointer',fontSize:12,fontWeight:500,opacity:editCat.label?.trim()?1:0.4}}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {editItem&&<TakeoffItemModal item={editItem} onSave={(data,type)=>{
        if(type==='delete'){setItems(prev=>prev.filter(i=>i.id!==editItem.id));}
        else if(type===true){setItems(prev=>[...prev.filter(i=>i.id!==data.id),data]);}
        else{setItems(prev=>prev.map(i=>i.id===data.id?data:i));}
        setEditItem(null);
      }} onClose={()=>setEditItem(null)}/>}
      {showAssembly&&<AssemblyPicker onApply={applyAssembly} onClose={()=>setShowAssembly(false)}/>}
      {showUnitCosts&&<UnitCostEditor onClose={()=>setShowUnitCosts(false)}/>}
      {showBidSummary&&<BidSummaryModal project={project} items={items} onClose={()=>setShowBidSummary(false)}/>}
      {editProject&&<TakeoffProjectModal project={project} apmProjects={apmProjects} onSave={async(data,type)=>{ if(type==='delete'){ const {error}=await supabase.rpc('delete_precon_project',{p_id:data.id}); if(error){console.error('delete_precon_project RPC error:',error);alert('Delete failed: '+error.message);} else{onBack();} } else if(data){ const {data:updated}=await supabase.from('precon_projects').update({name:data.name,company:data.company,address:data.address,gc_name:data.gc_name,bid_date:data.bid_date,contract_value:data.contract_value,status:data.status,apm_project_id:data.apm_project_id}).eq('id',data.id).select().single(); if(updated) onBack(); } else { onBack(); } setEditProject(false); }} onClose={()=>setEditProject(false)}/>}
    </div>
  );
}

// ── PreconSection (top-level) ─────────────────────────

export default TakeoffWorkspace;
