import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/**
 * TakeoffStore — manages all takeoff workspace state
 * 
 * Accessible outside React (canvas handlers, keyboard listeners)
 * via useTakeoffStore.getState()
 */
export const useTakeoffStore = create(
  immer((set, get) => ({

    // ── Plans ──────────────────────────────────────────
    plans: [],
    selPlan: null,
    openTabs: [],
    loadingPlan: false,

    setPlans: (plans) => set({ plans }),
    setSelPlan: (plan) => set({ selPlan: plan }),
    addOpenTab: (planId) => set(s => {
      if (!s.openTabs.includes(planId)) s.openTabs.push(planId);
    }),
    removeOpenTab: (planId) => set(s => {
      s.openTabs = s.openTabs.filter(id => id !== planId);
    }),

    // ── Items (takeoff_items) ──────────────────────────
    items: [],
    setItems: (items) => set({ items }),
    updateItem: (id, patch) => set(s => {
      const idx = s.items.findIndex(i => String(i.id) === String(id));
      if (idx >= 0) Object.assign(s.items[idx], patch);
    }),
    addItem: (item) => set(s => { s.items.push(item); }),
    removeItem: (id) => set(s => {
      s.items = s.items.filter(i => String(i.id) !== String(id));
    }),
    findItem: (id) => get().items.find(i => String(i.id) === String(id)),

    // ── Active condition (armed item for drawing) ──────
    activeCondId: null,
    setActiveCondId: (id) => set({ activeCondId: id }),

    // ── Drawing tool state ─────────────────────────────
    tool: 'select', // 'select'|'area'|'linear'|'count'|'cutout'|'eraser'|'scale'
    activePts: [],
    hoverPt: null,
    snapEnabled: false,
    arcPending: false,
    archMode: false,
    archCtrlPending: false,

    setTool: (tool) => set({ tool, activePts: [], arcPending: false, archMode: false, archCtrlPending: false }),
    setActivePts: (pts) => set({ activePts: pts }),
    addActivePt: (pt) => set(s => { s.activePts.push(pt); }),
    setHoverPt: (pt) => set({ hoverPt: pt }),
    setSnapEnabled: (v) => set({ snapEnabled: typeof v === 'function' ? v(get().snapEnabled) : v }),
    setArcPending: (v) => set({ arcPending: v }),
    setArchMode: (v) => set({ archMode: typeof v === 'function' ? v(get().archMode) : v }),

    // ── Selection ──────────────────────────────────────
    selectedShapes: new Set(), // "itemId::shapeIdx" keys
    clipboard: [],
    copyFlash: 0,

    setSelectedShapes: (val) => set({ selectedShapes: typeof val === 'function' ? val(get().selectedShapes) : val }),
    clearSelection: () => set({ selectedShapes: new Set() }),
    setClipboard: (entries) => set({ clipboard: entries }),

    // ── Drag state ─────────────────────────────────────
    dragOffset: null,
    vertexDrag: null,
    setDragOffset: (v) => set({ dragOffset: v }),
    setVertexDrag: (v) => set({ vertexDrag: v }),

    // ── Eraser ─────────────────────────────────────────
    eraserHover: null,
    setEraserHover: (v) => set({ eraserHover: v }),

    // ── Scale ──────────────────────────────────────────
    scale: null, // px per ft
    presetScale: '',
    scalePts: [],
    scaleStep: null, // null|'picking'|'entering'
    scaleDist: '',
    scaleUnit: 'ft',
    planDpi: 150,

    setScale: (v) => set({ scale: v }),
    setPresetScale: (v) => set({ presetScale: v }),
    setScalePts: (v) => set({ scalePts: v }),
    setScaleStep: (v) => set({ scaleStep: v }),

    // ── View state ─────────────────────────────────────
    zoom: 1,
    leftTab: 'takeoffs',
    mainView: 'workspace', // 'workspace'|'reports'
    rightTab: 'items', // 'items'|'estimate'
    estSubTab: 'worksheet',
    editItem: null,
    editProject: false,

    setZoom: (v) => set({ zoom: typeof v === 'function' ? v(get().zoom) : v }),
    setLeftTab: (v) => set({ leftTab: v }),
    setMainView: (v) => set({ mainView: v }),
    setRightTab: (v) => set({ rightTab: v }),
    setEstSubTab: (v) => set({ estSubTab: v }),
    setEditItem: (v) => set({ editItem: v }),
    setEditProject: (v) => set({ editProject: v }),

    // ── Estimate settings ──────────────────────────────
    overheadPct: 0,
    profitPct: 0,
    setOverheadPct: (v) => set({ overheadPct: v }),
    setProfitPct: (v) => set({ profitPct: v }),

    // ── Computed ────────────────────────────────────────
    get totalEst() { return get().items.reduce((s, i) => s + (i.total_cost || 0), 0); },
    get planItems() {
      const sp = get().selPlan;
      return sp ? get().items.filter(i => i.plan_id === sp.id) : [];
    },
    get activeCond() {
      const id = get().activeCondId;
      return id ? get().items.find(i => String(i.id) === String(id)) : null;
    },

    // ── Reset ──────────────────────────────────────────
    resetDrawingState: () => set({
      tool: 'select',
      activePts: [],
      activeCondId: null,
      selectedShapes: new Set(),
      clipboard: [],
      dragOffset: null,
      vertexDrag: null,
      eraserHover: null,
      arcPending: false,
      archMode: false,
      archCtrlPending: false,
    }),
  }))
);
