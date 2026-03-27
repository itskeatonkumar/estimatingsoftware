import React, { useState, useEffect, useRef } from 'react';

const SPEC_KEYWORDS = ['spec','addend','bid','contract','geotech','report','appendix','exhibit','submittal','schedule','narrative'];
function isSpecFolder(name) { return SPEC_KEYWORDS.some(kw => (name||'').toLowerCase().includes(kw)); }

const ensureJSZip = () => new Promise(r => {
  if (window.JSZip) { r(window.JSZip); return; }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  s.onload = () => r(window.JSZip); s.onerror = () => r(null);
  document.head.appendChild(s);
});
const ensurePdfLib = () => new Promise(r => {
  if (window.pdfjsLib) { r(window.pdfjsLib); return; }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  s.onload = () => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    // Suppress verbose PDF.js warnings (Knockout groups, etc.)
    const _w = console.warn;
    console.warn = (...a) => { if (typeof a[0] === 'string' && (a[0].includes('Knockout') || a[0].includes('getOperatorList'))) return; _w.apply(console, a); };
    r(window.pdfjsLib);
  };
  s.onerror = () => r(null);
  document.head.appendChild(s);
});

// ── Claude API with retry ──────────────────────────────────────
async function callClaude(body, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    const res = await fetch('/api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return await res.json();
    if ((res.status === 529 || res.status === 503 || res.status === 429) && i < retries) {
      console.log(`[claude] ${res.status}, retry ${i}/${retries} in ${i * 3}s...`);
      await new Promise(r => setTimeout(r, i * 3000));
      continue;
    }
    throw new Error(`AI request failed: ${res.status}`);
  }
}

// ── Sheet name extraction ──────────────────────────────────────
const SHEET_RE = /^[A-Z]{1,5}\d{0,3}[.-]?\d{0,3}$/;

// Extract sheet number by searching the ENTIRE page and scoring candidates
function extractSheetNumber(textItems, w, h) {
  const items = [];
  for (const it of textItems) {
    const str = it.str?.trim();
    if (!str || !it.transform) continue;
    const fs = Math.sqrt(it.transform[0] ** 2 + it.transform[1] ** 2);
    if (fs < 1) continue;
    items.push({ str, x: it.transform[4], y: it.transform[5], fs });
  }
  if (!items.length) return null;

  // Find ALL text matching sheet number pattern on the entire page
  const candidates = items
    .map(it => ({ ...it, cleaned: it.str.replace(/\s+/g, '') }))
    .filter(it => it.cleaned.length >= 2 && it.cleaned.length <= 10 && SHEET_RE.test(it.cleaned));

  if (!candidates.length) return null;

  // Score each candidate
  const scored = candidates.map(it => {
    let score = 0;
    // Font size — larger is better (sheet numbers are prominent)
    score += it.fs * 2;
    // Position: prefer bottom-right (PDF coords: y=0 bottom, x=0 left)
    const xr = it.x / w, yr = it.y / h;
    if (xr > 0.7) score += 20; else if (xr > 0.5) score += 10;
    if (yr < 0.3) score += 20; else if (yr < 0.5) score += 10;
    // Bonus: has both letters AND numbers (real sheet refs like FP1, A1.0)
    if (/[A-Z]/.test(it.cleaned) && /\d/.test(it.cleaned)) score += 15;
    // Penalize: short text in the middle of the page (grid bubbles)
    if (it.cleaned.length <= 2 && xr > 0.2 && xr < 0.8 && yr > 0.2 && yr < 0.8) score -= 50;
    return { ...it, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.cleaned || null;
}

// ── Component ──────────────────────────────────────────────────
export default function PlanUploadManager({ rawFiles, onStartUpload, onClose }) {
  const [pages, setPages] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selFolder, setSelFolder] = useState(null);
  const [parsing, setParsing] = useState(true);
  const [parseStatus, setParseStatus] = useState('Reading files...');
  const [parsePct, setParsePct] = useState(0);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [step, setStep] = useState('preview');
  const [progress, setProgress] = useState({ current: 0, total: 0, file: '' });
  const [results, setResults] = useState({ success: 0, failed: 0, errors: [] });
  const [editingId, setEditingId] = useState(null);
  const [naming, setNaming] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (rawFiles?.length) parseInput(rawFiles);
    else setParsing(false);
  }, []);

  const parsePdfPages = async (file, folderName, statusPrefix) => {
    const lib = await ensurePdfLib();
    const fallback = { id: `${folderName}_${file.name}`, name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim(), checked: true, autoNamed: false, source: 'filename', folder: folderName, rawFile: file, ocrText: '' };
    if (!lib) return [fallback];

    const buf = await file.arrayBuffer();
    let doc;
    try { doc = await lib.getDocument({ data: buf.slice(0) }).promise; }
    catch { return [fallback]; }

    const numPages = doc.numPages;
    const names = new Array(numPages).fill(null);
    const sources = new Array(numPages).fill('not found');

    // ═══ METHOD 1: PAGE LABELS (Revit/AutoCAD embed these) ═══
    setParseStatus(`${statusPrefix || file.name} \u2014 checking PDF metadata...`);
    try {
      const pageLabels = await doc.getPageLabels();
      if (pageLabels?.length === numPages) {
        let labelCount = 0;
        for (let i = 0; i < numPages; i++) {
          if (pageLabels[i]?.trim()?.length > 1) {
            names[i] = pageLabels[i].trim();
            sources[i] = 'pdf-label';
            labelCount++;
          }
        }
        if (labelCount) console.log(`[OCR] Page labels: ${labelCount}/${numPages} named`);
      }
    } catch (e) { /* no page labels */ }

    // ═══ METHOD 2: BOOKMARKS / OUTLINE ═══
    try {
      const outline = await doc.getOutline();
      if (outline?.length) {
        const flat = [];
        const walk = (items) => { for (const it of items) { flat.push(it); if (it.items?.length) walk(it.items); } };
        walk(outline);
        let bmCount = 0;
        for (const entry of flat) {
          if (!entry.title || !entry.dest) continue;
          try {
            let pageIdx = null;
            if (typeof entry.dest === 'string') {
              const destRef = await doc.getDestination(entry.dest);
              if (destRef) pageIdx = await doc.getPageIndex(destRef[0]);
            } else if (Array.isArray(entry.dest)) {
              pageIdx = await doc.getPageIndex(entry.dest[0]);
            }
            if (pageIdx != null && pageIdx >= 0 && pageIdx < numPages && !names[pageIdx]) {
              names[pageIdx] = entry.title.trim();
              sources[pageIdx] = 'bookmark';
              bmCount++;
            }
          } catch { /* dest resolve failed */ }
        }
        if (bmCount) console.log(`[OCR] Bookmarks: ${bmCount} additional names`);
      }
    } catch (e) { /* no outline */ }

    const namedSoFar = names.filter(Boolean).length;
    console.log(`[OCR] After metadata: ${namedSoFar}/${numPages} named`);

    // ═══ METHOD 3: TEXT EXTRACTION (fallback for unnamed pages) ═══
    const result = [];
    for (let i = 0; i < numPages; i++) {
      const prefix = statusPrefix || file.name;
      setParseStatus(`${prefix} \u2014 page ${i + 1} of ${numPages}`);
      setParsePct(Math.round(((i + 1) / numPages) * 100));

      let ocrText = '';
      if (!names[i]) {
        // Only do text extraction for pages not named by metadata
        try {
          const page = await doc.getPage(i + 1);
          const tc = await page.getTextContent();
          const vp = page.getViewport({ scale: 1 });
          ocrText = tc.items.map(it => it.str || '').join(' ').slice(0, 5000);
          const sheetNum = extractSheetNumber(tc.items, vp.width, vp.height);
          if (sheetNum) { names[i] = sheetNum; sources[i] = 'sheet-num'; }
        } catch { /* text extraction failed */ }
      } else {
        // Still grab OCR text for sheet index detection
        try {
          const page = await doc.getPage(i + 1);
          const tc = await page.getTextContent();
          ocrText = tc.items.map(it => it.str || '').join(' ').slice(0, 5000);
        } catch { /* ok */ }
      }

      const baseName = numPages === 1 ? file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim() : null;
      const finalName = names[i] || baseName || `Page ${i + 1} of ${numPages}`;
      const finalSource = names[i] ? sources[i] : (baseName ? 'filename' : 'not found');

      result.push({
        id: `${folderName}_${file.name}_p${i + 1}`,
        name: finalName,
        checked: true,
        autoNamed: !!names[i],
        source: finalSource,
        folder: folderName,
        pageNum: numPages > 1 ? i + 1 : undefined,
        pdfFile: numPages > 1 ? file : undefined,
        rawFile: numPages === 1 ? file : undefined,
        ocrText,
      });

      if (i % 10 === 0) await new Promise(r => setTimeout(r, 10));
    }

    console.log('[OCR] Final:', result.filter(r => r.autoNamed).length + '/' + numPages, 'named');
    return result;
  };

  const parseInput = async (fileList) => {
    setParsing(true);
    const files = Array.from(fileList);
    const allPages = [];
    const folderSet = new Set();

    for (const file of files) {
      const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
      if (isZip) {
        setParseStatus(`Extracting ${file.name}...`);
        const JSZip = await ensureJSZip();
        if (!JSZip) continue;
        try {
          const zip = await JSZip.loadAsync(file);
          const entries = [];
          zip.forEach((path, entry) => { if (!entry.dir && path.toLowerCase().endsWith('.pdf')) entries.push({ path, entry }); });
          for (let ei = 0; ei < entries.length; ei++) {
            const { path, entry } = entries[ei];
            const parts = path.split('/');
            const fname = parts.pop();
            const folder = parts.length ? parts.join('/') : 'Root';
            folderSet.add(folder);
            const blob = await entry.async('blob');
            const pdfFile = new File([blob], fname, { type: 'application/pdf' });
            allPages.push(...await parsePdfPages(pdfFile, folder, `${ei + 1}/${entries.length}: ${fname}`));
          }
        } catch (e) { console.error('ZIP error:', e); }
      } else if (file.type?.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
        const folder = files.length > 1 ? 'Selected Files' : file.name.replace(/\.[^.]+$/, '');
        folderSet.add(folder);
        allPages.push(...await parsePdfPages(file, folder));
      } else if (file.type?.startsWith('image/')) {
        folderSet.add('Images');
        allPages.push({ id: `img_${file.name}`, name: file.name, checked: true, autoNamed: false, source: 'filename', folder: 'Images', rawFile: file });
      }
    }

    const fl = [...folderSet].sort().map(name => {
      const isSpec = isSpecFolder(name);
      if (isSpec) allPages.filter(p => p.folder === name).forEach(p => { p.checked = false; });
      return { name, checked: !isSpec };
    });
    setPages(allPages);
    setFolders(fl);
    if (fl.length) setSelFolder(fl[0].name);
    setParsing(false);
  };

  // Re-scan unnamed pages with improved extraction (free)
  // AI naming — send title block crop to Claude for full sheet number + description
  const runAiNaming = async (targets) => {
    setNaming(true);
    const lib = await ensurePdfLib();
    if (!lib) { setNaming(false); return; }
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      setParseStatus(`AI naming ${i + 1}/${targets.length}`);
      try {
        const file = p.pdfFile || p.rawFile;
        const buf = await file.arrayBuffer();
        const doc = await lib.getDocument({ data: buf.slice(0) }).promise;
        const page = await doc.getPage(p.pageNum || 1);
        const vp = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        const cw = Math.floor(canvas.width * 0.5), ch = Math.floor(canvas.height * 0.38);
        const crop = document.createElement('canvas');
        const sc = Math.min(1, 1000 / cw);
        crop.width = Math.floor(cw * sc); crop.height = Math.floor(ch * sc);
        crop.getContext('2d').drawImage(canvas, canvas.width - cw, canvas.height - ch, cw, ch, 0, 0, crop.width, crop.height);
        const b64 = crop.toDataURL('image/jpeg', 0.85).split(',')[1];
        const j = await callClaude({
          model: 'claude-haiku-4-5-20251001', max_tokens: 60,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: 'Read the title block of this construction plan sheet. Return ONLY the sheet number and full sheet name in this exact format:\nSHEET_NUM - SHEET NAME\nExamples: A1.0 - FLOOR PLAN, S2.1 - FOUNDATION PLAN, C3.0 - GRADING PLAN\nIf you cannot determine it, return UNKNOWN' }
          ] }]
        });
        const raw = (j?.content?.find(b => b.type === 'text')?.text || '').trim().replace(/^["'`*\s]+|["'`*\s]+$/g, '');
        if (raw && !raw.includes('UNKNOWN') && raw.length >= 3 && /[A-Za-z]/.test(raw)) {
          setPages(prev => prev.map(pp => pp.id === p.id ? { ...pp, name: raw, autoNamed: true, source: 'ai' } : pp));
        }
      } catch (e) { console.warn('[ai-name]', e); }
    }
    setNaming(false);
  };

  // AI name unnamed only
  const aiNameUnnamed = async () => {
    const targets = pages.filter(p => p.source === 'not found' && p.checked && (p.pdfFile || p.rawFile));
    if (!targets.length) { alert('All selected pages are already named.'); return; }
    if (!confirm(`Use AI to name ${targets.length} unnamed sheet${targets.length > 1 ? 's' : ''}?\nThis uses ${targets.length} AI credit${targets.length > 1 ? 's' : ''}.`)) return;
    await runAiNaming(targets);
  };


  const toggleFolder = (fname, checked) => {
    setFolders(prev => prev.map(f => f.name === fname ? { ...f, checked } : f));
    setPages(prev => prev.map(p => p.folder === fname ? { ...p, checked } : p));
  };
  const togglePage = (id) => setPages(prev => prev.map(p => p.id === id ? { ...p, checked: !p.checked } : p));
  const renamePage = (id, val) => { if (val?.trim()) setPages(prev => prev.map(p => p.id === id ? { ...p, name: val.trim(), source: 'manual' } : p)); setEditingId(null); };

  const totalPages = pages.length;
  const selectedCount = pages.filter(p => p.checked).length;
  const namedCount = pages.filter(p => p.source !== 'not found').length;
  const unnamedCount = pages.filter(p => p.source === 'not found' && p.checked).length;
  const folderPages = selFolder ? pages.filter(p => p.folder === selFolder) : [];

  const startUpload = () => {
    cancelRef.current = false;
    setStep('uploading');
    setResults({ success: 0, failed: 0, errors: [] });
    const checked = pages.filter(p => p.checked);
    setProgress({ current: 0, total: checked.length, file: '' });
    onStartUpload({
      files: checked, folders: folders.filter(f => f.checked), skipDuplicates, cancelRef,
      onFileStart: (id) => setProgress(prev => ({ ...prev, file: checked.find(f => f.id === id)?.name || '' })),
      onFileComplete: () => { setResults(prev => ({ ...prev, success: prev.success + 1 })); setProgress(prev => ({ ...prev, current: prev.current + 1 })); },
      onFileError: (id, err) => { setResults(prev => ({ ...prev, failed: prev.failed + 1, errors: [...prev.errors, { name: checked.find(f => f.id === id)?.name || id, error: err }] })); setProgress(prev => ({ ...prev, current: prev.current + 1 })); },
      onComplete: () => setStep('complete'),
    });
  };

  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  const SRC = { 'pdf-label': { c: '#10B981', l: 'PDF' }, 'bookmark': { c: '#10B981', l: 'Bookmark' }, 'sheet-num': { c: '#3B82F6', l: 'Sheet #' }, 'ai': { c: '#7B6BA4', l: 'AI' }, 'manual': { c: '#1A1A1A', l: 'Manual' }, 'filename': { c: '#6B7280', l: 'File' }, 'not found': { c: '#D1D5DB', l: 'Not found' } };

  // ── PARSING SCREEN ──
  if (parsing) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '32px 40px', textAlign: 'center', maxWidth: 440, width: '90%' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #E5E7EB', borderTopColor: '#10B981', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 6 }}>{parseStatus}</div>
        <div style={{ height: 4, background: '#E5E7EB', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', background: '#10B981', borderRadius: 2, width: `${parsePct}%`, transition: 'width 0.2s' }} />
        </div>
        <div style={{ fontSize: 11, color: '#9CA3AF' }}>{pages.length} sheets found</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );

  // ── MAIN MODAL ──
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget && step !== 'uploading') onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '92vw', maxWidth: 960, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A' }}>Plan Upload Manager</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>
              {step === 'preview' && `${selectedCount}/${totalPages} selected \u00B7 ${namedCount} named \u00B7 ${unnamedCount} unnamed`}
              {step === 'uploading' && `Uploading ${progress.current}/${progress.total} (${pct}%)`}
              {step === 'complete' && `${results.success} uploaded${results.failed ? ', ' + results.failed + ' failed' : ''}`}
            </div>
          </div>
          {step !== 'uploading' && <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '4px 8px' }}>&times;</button>}
        </div>

        {/* ═══ PREVIEW ═══ */}
        {step === 'preview' && (<>
          {/* Action bar */}
          <div style={{ padding: '6px 24px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: '#FAFAFA', flexWrap: 'wrap' }}>
            {unnamedCount > 0 && (
              <button onClick={aiNameUnnamed} disabled={naming}
                style={{ padding: '4px 10px', border: '1px solid #7B6BA4', background: '#F5F3FF', color: '#7B6BA4', borderRadius: 4, cursor: naming ? 'default' : 'pointer', fontSize: 11, fontWeight: 600 }}>
                {naming ? parseStatus : `AI Name (${unnamedCount} unnamed)`}
              </button>
            )}
            <span style={{ fontSize: 10, color: '#bbb' }}>Click any name to edit</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => { setPages(p => p.map(x => ({ ...x, checked: true }))); setFolders(f => f.map(x => ({ ...x, checked: true }))); }}
              style={{ fontSize: 10, color: '#10B981', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>All</button>
            <button onClick={() => { setPages(p => p.map(x => ({ ...x, checked: false }))); setFolders(f => f.map(x => ({ ...x, checked: false }))); }}
              style={{ fontSize: 10, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}>None</button>
          </div>

          <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* Folders */}
            {folders.length > 1 && (
              <div style={{ width: 190, borderRight: '1px solid #E5E7EB', overflow: 'auto', padding: '4px 0', flexShrink: 0 }}>
                {folders.map(f => {
                  const cnt = pages.filter(p => p.folder === f.name && p.checked).length;
                  const tot = pages.filter(p => p.folder === f.name).length;
                  return (
                    <div key={f.name} onClick={() => setSelFolder(f.name)}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', cursor: 'pointer',
                        background: selFolder === f.name ? '#F0FDF4' : 'transparent', borderLeft: selFolder === f.name ? '3px solid #10B981' : '3px solid transparent' }}>
                      <input type="checkbox" checked={f.checked} onChange={e => { e.stopPropagation(); toggleFolder(f.name, e.target.checked); }} style={{ accentColor: '#10B981' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: f.checked ? '#1A1A1A' : '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                        <div style={{ fontSize: 9, color: '#9CA3AF' }}>{cnt}/{tot}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Page table */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '26px 30px 1fr 64px', gap: 0, padding: '5px 10px', borderBottom: '1px solid #E5E7EB', position: 'sticky', top: 0, background: '#F9FAFB', zIndex: 1 }}>
                <div /><div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 700 }}>#</div>
                <div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 700 }}>SHEET NAME</div>
                <div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 700 }}>SOURCE</div>
              </div>
              {folderPages.map((p, i) => (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '26px 30px 1fr 64px', gap: 0, padding: '4px 10px', alignItems: 'center', borderBottom: '1px solid #F3F4F6', background: p.checked ? '#fff' : '#FAFAFA' }}>
                  <input type="checkbox" checked={p.checked} onChange={() => togglePage(p.id)} style={{ accentColor: '#10B981', width: 14, height: 14 }} />
                  <span style={{ fontSize: 10, color: '#bbb' }}>{p.pageNum || (i + 1)}</span>
                  {editingId === p.id ? (
                    <input defaultValue={p.name} autoFocus
                      onBlur={e => renamePage(p.id, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') renamePage(p.id, e.target.value); if (e.key === 'Escape') setEditingId(null); }}
                      style={{ fontSize: 12, color: '#1A1A1A', border: '1px solid #10B981', borderRadius: 3, padding: '2px 5px', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                  ) : (
                    <div onClick={() => setEditingId(p.id)} title="Click to edit"
                      style={{ fontSize: 12, color: p.source === 'not found' ? '#9CA3AF' : '#1A1A1A', cursor: 'text', padding: '2px 5px', borderRadius: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid transparent' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = '#E5E7EB'} onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
                      {p.name}
                    </div>
                  )}
                  <span style={{ fontSize: 10, color: SRC[p.source]?.c || '#bbb', fontWeight: 500 }}>{SRC[p.source]?.l || p.source}</span>
                </div>
              ))}
              {folderPages.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: '#bbb', fontSize: 12 }}>Select a folder</div>}
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '8px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} style={{ accentColor: '#10B981' }} />
              <span style={{ fontSize: 11, color: '#555' }}>Skip duplicates</span>
            </label>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ padding: '6px 14px', border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button onClick={startUpload} disabled={selectedCount === 0}
              style={{ padding: '6px 18px', background: selectedCount ? '#10B981' : '#E5E7EB', border: 'none', color: selectedCount ? '#fff' : '#9CA3AF', borderRadius: 5, cursor: selectedCount ? 'pointer' : 'default', fontSize: 13, fontWeight: 600 }}>
              Upload {selectedCount} &rarr;
            </button>
          </div>
        </>)}

        {/* ═══ UPLOADING ═══ */}
        {step === 'uploading' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>Uploading {progress.current}/{progress.total} ({pct}%)</span>
                <button onClick={() => { cancelRef.current = true; }} style={{ background: 'none', border: '1px solid #EF4444', color: '#EF4444', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>Cancel</button>
              </div>
              <div style={{ height: 4, background: '#E5E7EB', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#10B981', borderRadius: 2, width: `${pct}%`, transition: 'width 0.3s' }} />
              </div>
              {progress.file && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{progress.file}</div>}
            </div>
            {pages.filter(p => p.checked).map((p, idx) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', fontSize: 11 }}>
                <span>{idx < progress.current ? (results.errors.some(e => e.name === p.name) ? '\u274C' : '\u2705') : idx === progress.current ? '\u23F3' : '\u25CB'}</span>
                <span style={{ color: '#6B7280' }}>{p.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* ═══ COMPLETE ═══ */}
        {step === 'complete' && (
          <div style={{ flex: 1, padding: 36, textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>{results.failed === 0 ? '\u2705' : '\u26A0\uFE0F'}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#1A1A1A', marginBottom: 6 }}>Upload Complete</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 18 }}>
              {results.success} sheet{results.success !== 1 ? 's' : ''} uploaded
              {results.failed > 0 && <span style={{ color: '#EF4444' }}> &mdash; {results.failed} failed</span>}
            </div>
            {results.errors.length > 0 && (
              <div style={{ textAlign: 'left', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 10, maxWidth: 380, margin: '0 auto 16px' }}>
                {results.errors.map((e, i) => <div key={i} style={{ fontSize: 11, color: '#991B1B', marginBottom: 2 }}>{e.name}: {e.error}</div>)}
              </div>
            )}
            <button onClick={onClose} style={{ padding: '8px 22px', background: '#10B981', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
