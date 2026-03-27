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
  s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; r(window.pdfjsLib); };
  s.onerror = () => r(null);
  document.head.appendChild(s);
});

// ── Sheet name extraction from PDF.js textContent ──────────────
const SHEET_NUM_RE = /^[A-Z]{1,3}\d{0,2}[.-]\d{1,2}(?:[.-]\d{1,2})?$/;
const GARBAGE_RE = /[\^`~|{}<>\\\u0000-\u001F]/;
const LABEL_BLACKLIST = /^(SCALE|DATE|DRAWN|CHECKED|APPROVED|REV|NO\.|JOB|PROJECT|SHEET|DWG|ISSUED|MARK|STAMP|SEAL|OWNER|ARCHITECT|ENGINEER|REVISION|KEY PLAN|VICINITY|LOCATION|COPYRIGHT|CONFIDENTIAL)/i;

function isValidName(s) {
  if (!s || s.length < 2) return false;
  if (!/[a-zA-Z]/.test(s)) return false;
  if (GARBAGE_RE.test(s)) return false;
  const letterRatio = (s.match(/[a-zA-Z ]/g) || []).length / s.length;
  return letterRatio >= 0.6;
}

function extractSheetNameFromPage(textItems, vpWidth, vpHeight) {
  if (!textItems?.length) return null;

  // Build items with position and font size
  const items = [];
  for (const item of textItems) {
    const str = item.str?.trim();
    if (!str || !item.transform) continue;
    const fontSize = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);
    if (fontSize < 1) continue;
    items.push({
      str,
      x: item.transform[4],
      y: item.transform[5], // PDF coords: y=0 at bottom
      fontSize,
      width: item.width || str.length * fontSize * 0.5,
    });
  }
  if (!items.length) return null;

  // Title block = bottom-right in PDF coords (low Y, high X)
  const tbItems = items.filter(it => it.x > vpWidth * 0.5 && it.y < vpHeight * 0.4);

  // STEP 1: Find sheet number (prefer larger font, in title block first)
  let sheetNum = null, sheetNumItem = null;
  const findSheetNum = (pool) => {
    const sorted = [...pool].sort((a, b) => b.fontSize - a.fontSize);
    for (const it of sorted) {
      const cleaned = it.str.replace(/\s+/g, '');
      if (SHEET_NUM_RE.test(cleaned)) {
        return { num: cleaned, item: it };
      }
    }
    return null;
  };

  const tbResult = findSheetNum(tbItems);
  if (tbResult) { sheetNum = tbResult.num; sheetNumItem = tbResult.item; }

  if (!sheetNum) {
    const allResult = findSheetNum(items);
    if (allResult) { sheetNum = allResult.num; sheetNumItem = allResult.item; }
  }

  if (!sheetNum) return null;

  // STEP 2: Find sheet name — descriptive text near the sheet number
  const nearby = items.filter(it => {
    if (it === sheetNumItem) return false;
    const yDist = Math.abs(it.y - sheetNumItem.y);
    const xDist = Math.abs(it.x - sheetNumItem.x);
    return yDist < 50 && xDist < 300;
  });

  let sheetName = null;
  const candidates = nearby.filter(it => {
    const s = it.str;
    if (s.length < 3 || s.length > 60) return false;
    if (/^\d+$/.test(s)) return false;
    if (/^\d+[-\/]\d+/.test(s)) return false;
    if (GARBAGE_RE.test(s)) return false;
    if (LABEL_BLACKLIST.test(s)) return false;
    if (SHEET_NUM_RE.test(s.replace(/\s+/g, ''))) return false;
    const letterRatio = (s.match(/[a-zA-Z ]/g) || []).length / s.length;
    if (letterRatio < 0.7) return false;
    return true;
  }).sort((a, b) => b.str.length - a.str.length);

  if (candidates.length) sheetName = candidates[0].str;

  // Combine and validate
  const result = sheetName ? `${sheetNum} - ${sheetName}` : sheetNum;
  return isValidName(result) ? result : (SHEET_NUM_RE.test(sheetNum) ? sheetNum : null);
}

// ── Component ──────────────────────────────────────────────────
export default function PlanUploadManager({ rawFiles, onStartUpload, onClose }) {
  const [pages, setPages] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selFolder, setSelFolder] = useState(null);
  const [parsing, setParsing] = useState(true);
  const [parseStatus, setParseStatus] = useState('Reading files...');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [step, setStep] = useState('preview');
  const [progress, setProgress] = useState({ current: 0, total: 0, file: '' });
  const [results, setResults] = useState({ success: 0, failed: 0, errors: [] });
  const [editingId, setEditingId] = useState(null);
  const [naming, setNaming] = useState(false); // true while OCR/AI naming is running
  const cancelRef = useRef(false);

  useEffect(() => {
    if (rawFiles?.length) parseInput(rawFiles);
    else setParsing(false);
  }, []);

  const parsePdfPages = async (file, folderName) => {
    const lib = await ensurePdfLib();
    if (!lib) return [{ id: `${folderName}_${file.name}`, name: file.name.replace(/\.[^.]+$/, ''), checked: true, autoNamed: false, source: 'filename', folder: folderName, rawFile: file }];

    const buf = await file.arrayBuffer();
    let doc;
    try { doc = await lib.getDocument({ data: buf.slice(0) }).promise; }
    catch { return [{ id: `${folderName}_${file.name}`, name: file.name.replace(/\.[^.]+$/, ''), checked: true, autoNamed: false, source: 'filename', folder: folderName, rawFile: file }]; }

    const numPages = doc.numPages;
    const result = [];

    for (let i = 1; i <= numPages; i++) {
      setParseStatus(`Scanning ${file.name}... page ${i} of ${numPages}`);
      try {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        const vp = page.getViewport({ scale: 1 });
        const name = extractSheetNameFromPage(tc.items, vp.width, vp.height);
        const baseName = numPages === 1 ? file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim() : null;
        result.push({
          id: `${folderName}_${file.name}_p${i}`,
          name: name || baseName || `Page ${i} of ${numPages}`,
          checked: true,
          autoNamed: !!name,
          source: name ? 'auto-detect' : (baseName ? 'filename' : 'not found'),
          folder: folderName,
          pageNum: numPages > 1 ? i : undefined,
          pdfFile: numPages > 1 ? file : undefined,
          rawFile: numPages === 1 ? file : undefined,
        });
      } catch (e) {
        console.warn('[parse] page', i, 'failed:', e);
        result.push({
          id: `${folderName}_${file.name}_p${i}`,
          name: `Page ${i} of ${numPages}`,
          checked: true, autoNamed: false, source: 'not found',
          folder: folderName, pageNum: numPages > 1 ? i : undefined,
          pdfFile: numPages > 1 ? file : undefined, rawFile: numPages === 1 ? file : undefined,
        });
      }
    }
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
            setParseStatus(`Scanning ${ei + 1}/${entries.length}: ${fname}`);
            const blob = await entry.async('blob');
            const pdfFile = new File([blob], fname, { type: 'application/pdf' });
            allPages.push(...await parsePdfPages(pdfFile, folder));
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

  // Re-scan unnamed pages with PDF.js (free)
  const rescanOcr = async () => {
    const unnamed = pages.filter(p => p.source === 'not found' && p.checked && (p.pdfFile || p.rawFile));
    if (!unnamed.length) return;
    setNaming(true);
    const lib = await ensurePdfLib();
    if (!lib) { setNaming(false); return; }

    for (let i = 0; i < unnamed.length; i++) {
      const p = unnamed[i];
      setParseStatus(`Re-scanning ${i + 1}/${unnamed.length}: ${p.name}`);
      try {
        const file = p.pdfFile || p.rawFile;
        const buf = await file.arrayBuffer();
        const doc = await lib.getDocument({ data: buf.slice(0) }).promise;
        const page = await doc.getPage(p.pageNum || 1);
        const tc = await page.getTextContent();
        const vp = page.getViewport({ scale: 1 });
        const name = extractSheetNameFromPage(tc.items, vp.width, vp.height);
        if (name) {
          setPages(prev => prev.map(pp => pp.id === p.id ? { ...pp, name, autoNamed: true, source: 'ocr' } : pp));
        }
      } catch (e) { console.warn('[rescan]', e); }
    }
    setNaming(false);
  };

  // AI naming for remaining unnamed pages
  const aiName = async () => {
    const unnamed = pages.filter(p => (p.source === 'not found') && p.checked && (p.pdfFile || p.rawFile));
    if (!unnamed.length) { alert('All pages are already named.'); return; }
    if (!confirm(`Use AI to name ${unnamed.length} unnamed sheet${unnamed.length > 1 ? 's' : ''}? This uses AI credits.`)) return;
    setNaming(true);
    const lib = await ensurePdfLib();
    if (!lib) { setNaming(false); return; }

    for (let i = 0; i < unnamed.length; i++) {
      const p = unnamed[i];
      setParseStatus(`AI naming ${i + 1}/${unnamed.length}...`);
      try {
        const file = p.pdfFile || p.rawFile;
        const buf = await file.arrayBuffer();
        const doc = await lib.getDocument({ data: buf.slice(0) }).promise;
        const page = await doc.getPage(p.pageNum || 1);
        const vp = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        // Crop bottom-right for title block
        const cw = Math.floor(canvas.width * 0.5), ch = Math.floor(canvas.height * 0.38);
        const crop = document.createElement('canvas');
        const sc = Math.min(1, 1000 / cw);
        crop.width = Math.floor(cw * sc); crop.height = Math.floor(ch * sc);
        crop.getContext('2d').drawImage(canvas, canvas.width - cw, canvas.height - ch, cw, ch, 0, 0, crop.width, crop.height);
        const b64 = crop.toDataURL('image/jpeg', 0.85).split(',')[1];

        const resp = await fetch('/api/claude', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 60,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
              { type: 'text', text: 'This is the title block of a construction drawing. Extract the sheet number and title.\nReply ONLY: SHEET_NUM - SHEET_TITLE\nExamples: A1.0 - FLOOR PLAN, S2.1 - FOUNDATION PLAN\nIf unreadable reply: UNKNOWN' }
            ] }]
          })
        });
        if (!resp.ok) continue;
        const j = await resp.json();
        const raw = (j?.content?.find(b => b.type === 'text')?.text || '').trim();
        if (raw && !raw.includes('UNKNOWN') && raw.length >= 3 && isValidName(raw)) {
          const cleaned = raw.replace(/^["'`*\s]+|["'`*\s]+$/g, '').trim();
          setPages(prev => prev.map(pp => pp.id === p.id ? { ...pp, name: cleaned, autoNamed: true, source: 'ai' } : pp));
        }
      } catch (e) { console.warn('[ai-name]', e); }
    }
    setNaming(false);
  };

  const toggleFolder = (fname, checked) => {
    setFolders(prev => prev.map(f => f.name === fname ? { ...f, checked } : f));
    setPages(prev => prev.map(p => p.folder === fname ? { ...p, checked } : p));
  };
  const togglePage = (id) => setPages(prev => prev.map(p => p.id === id ? { ...p, checked: !p.checked } : p));
  const renamePage = (id, newName) => {
    if (newName?.trim()) setPages(prev => prev.map(p => p.id === id ? { ...p, name: newName.trim(), source: 'manual' } : p));
    setEditingId(null);
  };

  const totalPages = pages.length;
  const selectedCount = pages.filter(p => p.checked).length;
  const autoCount = pages.filter(p => p.autoNamed || p.source === 'manual').length;
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
  const SRC_STYLE = { 'auto-detect': { color: '#10B981', label: 'Auto-detect' }, 'ocr': { color: '#3B82F6', label: 'OCR' }, 'ai': { color: '#7B6BA4', label: 'AI' }, 'manual': { color: '#1A1A1A', label: 'Manual' }, 'filename': { color: '#6B7280', label: 'Filename' }, 'not found': { color: '#9CA3AF', label: 'Not found' } };

  // ── RENDER ──
  if (parsing) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 40, textAlign: 'center', maxWidth: 420 }}>
        <div style={{ width: 32, height: 32, border: '3px solid #E5E7EB', borderTopColor: '#10B981', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ fontSize: 14, color: '#333', marginBottom: 4 }}>{parseStatus}</div>
        <div style={{ fontSize: 11, color: '#9CA3AF' }}>{pages.length > 0 ? `${pages.length} sheets found` : 'Please wait...'}</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget && step !== 'uploading') onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '92vw', maxWidth: 960, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A' }}>Plan Upload Manager</div>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
              {step === 'preview' && `${selectedCount} of ${totalPages} sheets \u00B7 ${autoCount} named \u00B7 ${unnamedCount} unnamed`}
              {step === 'uploading' && `Uploading ${progress.current}/${progress.total} (${pct}%)`}
              {step === 'complete' && `${results.success} uploaded, ${results.failed} failed`}
            </div>
          </div>
          {step !== 'uploading' && <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>&times;</button>}
        </div>

        {/* ═══ PREVIEW ═══ */}
        {step === 'preview' && (<>
          {/* Naming action bar */}
          <div style={{ padding: '8px 24px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: '#FAFAFA' }}>
            <button onClick={rescanOcr} disabled={naming || unnamedCount === 0}
              style={{ padding: '5px 12px', border: '1px solid #3B82F6', background: naming ? '#F3F4F6' : '#EFF6FF', color: '#3B82F6', borderRadius: 4, cursor: naming || unnamedCount === 0 ? 'default' : 'pointer', fontSize: 11, fontWeight: 600, opacity: unnamedCount === 0 ? 0.4 : 1 }}>
              {naming ? 'Scanning...' : `Re-scan OCR (${unnamedCount} unnamed)`}
            </button>
            <button onClick={aiName} disabled={naming || unnamedCount === 0}
              style={{ padding: '5px 12px', border: '1px solid #7B6BA4', background: '#F5F3FF', color: '#7B6BA4', borderRadius: 4, cursor: naming || unnamedCount === 0 ? 'default' : 'pointer', fontSize: 11, fontWeight: 600, opacity: unnamedCount === 0 ? 0.4 : 1 }}>
              AI Name ({unnamedCount} sheets)
            </button>
            <span style={{ fontSize: 10, color: '#9CA3AF' }}>Click any name to edit</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => { setPages(prev => prev.map(p => ({ ...p, checked: true }))); setFolders(prev => prev.map(f => ({ ...f, checked: true }))); }}
              style={{ fontSize: 10, color: '#10B981', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>All</button>
            <button onClick={() => { setPages(prev => prev.map(p => ({ ...p, checked: false }))); setFolders(prev => prev.map(f => ({ ...f, checked: false }))); }}
              style={{ fontSize: 10, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}>None</button>
          </div>

          <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* Left: folders */}
            {folders.length > 1 && (
              <div style={{ width: 200, borderRight: '1px solid #E5E7EB', overflow: 'auto', padding: '6px 0', flexShrink: 0 }}>
                {folders.map(f => {
                  const cnt = pages.filter(p => p.folder === f.name && p.checked).length;
                  const tot = pages.filter(p => p.folder === f.name).length;
                  return (
                    <div key={f.name} onClick={() => setSelFolder(f.name)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', cursor: 'pointer',
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

            {/* Right: page table */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '28px 32px 1fr 80px', gap: 0, padding: '6px 12px', borderBottom: '1px solid #E5E7EB', position: 'sticky', top: 0, background: '#F9FAFB', zIndex: 1 }}>
                <div />
                <div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 700 }}>#</div>
                <div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 700 }}>SHEET NAME</div>
                <div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 700 }}>SOURCE</div>
              </div>
              {folderPages.map((p, i) => (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '28px 32px 1fr 80px', gap: 0, padding: '5px 12px', alignItems: 'center',
                  borderBottom: '1px solid #F3F4F6', background: p.checked ? '#fff' : '#FAFAFA' }}>
                  <input type="checkbox" checked={p.checked} onChange={() => togglePage(p.id)} style={{ accentColor: '#10B981' }} />
                  <span style={{ fontSize: 10, color: '#9CA3AF' }}>{p.pageNum || (i + 1)}</span>
                  {editingId === p.id ? (
                    <input defaultValue={p.name} autoFocus
                      onBlur={e => renamePage(p.id, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') renamePage(p.id, e.target.value); if (e.key === 'Escape') setEditingId(null); }}
                      style={{ fontSize: 12, color: '#1A1A1A', border: '1px solid #10B981', borderRadius: 3, padding: '2px 6px', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                  ) : (
                    <div onClick={() => setEditingId(p.id)} title="Click to rename"
                      style={{ fontSize: 12, color: p.checked ? '#1A1A1A' : '#9CA3AF', cursor: 'text', padding: '2px 6px', borderRadius: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        border: '1px solid transparent' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = '#E5E7EB'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
                      {p.name}
                    </div>
                  )}
                  <span style={{ fontSize: 10, color: SRC_STYLE[p.source]?.color || '#9CA3AF', fontWeight: 500 }}>
                    {SRC_STYLE[p.source]?.label || p.source}
                  </span>
                </div>
              ))}
              {folderPages.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Select a folder</div>}
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '10px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} style={{ accentColor: '#10B981' }} />
              <span style={{ fontSize: 11, color: '#333' }}>Skip duplicates</span>
            </label>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ padding: '7px 16px', border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button onClick={startUpload} disabled={selectedCount === 0}
              style={{ padding: '7px 20px', background: selectedCount ? '#10B981' : '#E5E7EB', border: 'none', color: selectedCount ? '#fff' : '#9CA3AF', borderRadius: 6, cursor: selectedCount ? 'pointer' : 'default', fontSize: 13, fontWeight: 600 }}>
              {`Upload ${selectedCount} sheet${selectedCount !== 1 ? 's' : ''}`} &rarr;
            </button>
          </div>
        </>)}

        {/* ═══ UPLOADING ═══ */}
        {step === 'uploading' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>Uploading {progress.current}/{progress.total} ({pct}%)</span>
                <button onClick={() => { cancelRef.current = true; }} style={{ background: 'none', border: '1px solid #EF4444', color: '#EF4444', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>Cancel</button>
              </div>
              <div style={{ height: 5, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#10B981', borderRadius: 3, width: `${pct}%`, transition: 'width 0.3s' }} />
              </div>
              {progress.file && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{progress.file}</div>}
            </div>
            {pages.filter(p => p.checked).map((p, idx) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 11 }}>
                <span>{idx < progress.current ? (results.errors.some(e => e.name === p.name) ? '\u274C' : '\u2705') : idx === progress.current ? '\u23F3' : '\u25CB'}</span>
                <span style={{ color: '#6B7280' }}>{p.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* ═══ COMPLETE ═══ */}
        {step === 'complete' && (
          <div style={{ flex: 1, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{results.failed === 0 ? '\u2705' : '\u26A0\uFE0F'}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1A1A', marginBottom: 8 }}>Upload Complete!</div>
            <div style={{ fontSize: 14, color: '#6B7280', marginBottom: 20 }}>
              {results.success} sheet{results.success !== 1 ? 's' : ''} uploaded
              {results.failed > 0 && <span style={{ color: '#EF4444' }}> &mdash; {results.failed} failed</span>}
            </div>
            {results.errors.length > 0 && (
              <div style={{ textAlign: 'left', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, maxWidth: 400, margin: '0 auto 20px' }}>
                {results.errors.map((e, i) => <div key={i} style={{ fontSize: 11, color: '#991B1B', marginBottom: 2 }}>{e.name}: {e.error}</div>)}
              </div>
            )}
            <button onClick={onClose} style={{ padding: '10px 24px', background: '#10B981', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
