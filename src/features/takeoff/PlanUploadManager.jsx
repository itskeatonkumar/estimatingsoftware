import React, { useState, useEffect, useRef } from 'react';
import { extractTitleBlock } from '../../lib/pdfParsing.js';

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

// Extract sheet name from a single PDF page using text content
function extractPageSheetName(textItems, vpWidth, vpHeight) {
  if (!textItems?.length) return null;
  // Build positioned items like TakeoffWorkspace does
  const positioned = [];
  for (const item of textItems) {
    if (!item.str?.trim() || !item.transform) continue;
    positioned.push({ str: item.str.trim(), x: item.transform[4], y: vpHeight - item.transform[5], w: item.width || 0, h: Math.sqrt(item.transform[0]**2 + item.transform[1]**2) });
  }
  const tb = extractTitleBlock(positioned, vpWidth, vpHeight);
  if (tb?.sheetNumber && tb?.sheetName) return `${tb.sheetNumber} - ${tb.sheetName}`;
  if (tb?.sheetNumber) return tb.sheetNumber;
  return null;
}

export default function PlanUploadManager({ rawFiles, onStartUpload, onClose }) {
  const [pages, setPages] = useState([]); // [{id, name, checked, autoNamed, source, folder, pageNum, rawFile?, entry?, pdfFile?, editingName?}]
  const [folders, setFolders] = useState([]); // for ZIP: [{name, checked}]
  const [selFolder, setSelFolder] = useState(null);
  const [parsing, setParsing] = useState(true);
  const [parseStatus, setParseStatus] = useState('Reading files...');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [step, setStep] = useState('preview');
  const [progress, setProgress] = useState({ current: 0, total: 0, file: '' });
  const [results, setResults] = useState({ success: 0, failed: 0, errors: [] });
  const [editingId, setEditingId] = useState(null);
  const cancelRef = useRef(false);
  const editRef = useRef(null);

  useEffect(() => {
    if (rawFiles?.length) parseInput(rawFiles);
    else { setParsing(false); }
  }, []);

  // Parse a single PDF file into pages with sheet names
  const parsePdfPages = async (file, folderName) => {
    const lib = await ensurePdfLib();
    if (!lib) return [{ id: `${folderName}_${file.name}`, name: file.name, checked: true, autoNamed: false, source: 'filename', folder: folderName, rawFile: file }];

    const buf = await file.arrayBuffer();
    let doc;
    try { doc = await lib.getDocument({ data: buf.slice(0) }).promise; } catch { return [{ id: `${folderName}_${file.name}`, name: file.name, checked: true, autoNamed: false, source: 'filename', folder: folderName, rawFile: file }]; }

    const numPages = doc.numPages;
    if (numPages === 1) {
      // Single page — try to extract name
      const page = await doc.getPage(1);
      const tc = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      const sheetName = extractPageSheetName(tc.items, vp.width, vp.height);
      const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
      return [{ id: `${folderName}_${file.name}`, name: sheetName || baseName, checked: true, autoNamed: !!sheetName, source: sheetName ? 'auto-detect' : 'filename', folder: folderName, rawFile: file }];
    }

    // Multi-page PDF — split into individual page entries
    const result = [];
    for (let i = 1; i <= numPages; i++) {
      setParseStatus(`Scanning ${file.name}... page ${i} of ${numPages}`);
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      const sheetName = extractPageSheetName(tc.items, vp.width, vp.height);
      result.push({
        id: `${folderName}_${file.name}_p${i}`,
        name: sheetName || `Page ${i} of ${numPages}`,
        checked: true,
        autoNamed: !!sheetName,
        source: sheetName ? 'auto-detect' : 'not found',
        folder: folderName,
        pageNum: i,
        pdfFile: file, // reference to the original multi-page PDF
      });
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
          const pdfEntries = [];
          zip.forEach((path, entry) => {
            if (!entry.dir && path.toLowerCase().endsWith('.pdf')) pdfEntries.push({ path, entry });
          });
          setParseStatus(`Found ${pdfEntries.length} PDFs in ${file.name}`);
          for (let ei = 0; ei < pdfEntries.length; ei++) {
            const { path, entry } = pdfEntries[ei];
            const parts = path.split('/');
            const fname = parts.pop();
            const folder = parts.length ? parts.join('/') : 'Root';
            folderSet.add(folder);
            setParseStatus(`Scanning ${ei + 1} of ${pdfEntries.length}: ${fname}`);
            const blob = await entry.async('blob');
            const pdfFile = new File([blob], fname, { type: 'application/pdf' });
            const pgs = await parsePdfPages(pdfFile, folder);
            allPages.push(...pgs);
          }
        } catch (e) { console.error('ZIP parse error:', e); }

      } else if (file.type?.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
        setParseStatus(`Scanning ${file.name}...`);
        const folder = files.length > 1 ? 'Selected Files' : file.name.replace(/\.[^.]+$/, '');
        folderSet.add(folder);
        const pgs = await parsePdfPages(file, folder);
        allPages.push(...pgs);

      } else if (file.type?.startsWith('image/')) {
        const folder = 'Images';
        folderSet.add(folder);
        allPages.push({ id: `img_${file.name}`, name: file.name, checked: true, autoNamed: false, source: 'filename', folder, rawFile: file });
      }
    }

    // Build folder list and auto-uncheck spec folders
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

  const toggleFolder = (fname, checked) => {
    setFolders(prev => prev.map(f => f.name === fname ? { ...f, checked } : f));
    setPages(prev => prev.map(p => p.folder === fname ? { ...p, checked } : p));
  };

  const togglePage = (id) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, checked: !p.checked } : p));
  };

  const renamePage = (id, newName) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, name: newName, source: 'manual' } : p));
    setEditingId(null);
  };

  const totalPages = pages.length;
  const selectedCount = pages.filter(p => p.checked).length;
  const autoNamedCount = pages.filter(p => p.autoNamed).length;
  const folderPages = selFolder ? pages.filter(p => p.folder === selFolder) : [];

  const startUpload = () => {
    cancelRef.current = false;
    setStep('uploading');
    setResults({ success: 0, failed: 0, errors: [] });
    const checked = pages.filter(p => p.checked);
    setProgress({ current: 0, total: checked.length, file: '' });

    onStartUpload({
      files: checked,
      folders: folders.filter(f => f.checked),
      skipDuplicates,
      cancelRef,
      onFileStart: (id) => setProgress(prev => ({ ...prev, file: checked.find(f => f.id === id)?.name || '' })),
      onFileComplete: () => {
        setResults(prev => ({ ...prev, success: prev.success + 1 }));
        setProgress(prev => ({ ...prev, current: prev.current + 1 }));
      },
      onFileError: (id, err) => {
        setResults(prev => ({ ...prev, failed: prev.failed + 1, errors: [...prev.errors, { name: checked.find(f => f.id === id)?.name || id, error: err }] }));
        setProgress(prev => ({ ...prev, current: prev.current + 1 }));
      },
      onComplete: () => setStep('complete'),
    });
  };

  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;

  // ── RENDER ──

  if (parsing) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 40, textAlign: 'center', maxWidth: 400 }}>
        <div style={{ width: 32, height: 32, border: '3px solid #E5E7EB', borderTopColor: '#10B981', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ fontSize: 14, color: '#333', marginBottom: 4 }}>{parseStatus}</div>
        <div style={{ fontSize: 11, color: '#9CA3AF' }}>{pages.length > 0 ? `${pages.length} sheets found so far` : 'Please wait...'}</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget && step !== 'uploading') onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '90vw', maxWidth: 940, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A' }}>Plan Upload Manager</div>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
              {step === 'preview' && `${selectedCount} of ${totalPages} sheets selected \u00B7 ${autoNamedCount} auto-named`}
              {step === 'uploading' && `Uploading ${progress.current} of ${progress.total} (${pct}%)`}
              {step === 'complete' && `${results.success} uploaded, ${results.failed} failed`}
            </div>
          </div>
          {step !== 'uploading' && <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 20 }}>&times;</button>}
        </div>

        {/* ═══ PREVIEW ═══ */}
        {step === 'preview' && (<>
          <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* Left: folders (if multiple) */}
            {folders.length > 1 && (
              <div style={{ width: 220, borderRight: '1px solid #E5E7EB', overflow: 'auto', padding: '8px 0', flexShrink: 0 }}>
                {folders.map(f => {
                  const cnt = pages.filter(p => p.folder === f.name && p.checked).length;
                  const total = pages.filter(p => p.folder === f.name).length;
                  return (
                    <div key={f.name} onClick={() => setSelFolder(f.name)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', cursor: 'pointer',
                        background: selFolder === f.name ? '#F0FDF4' : 'transparent', borderLeft: selFolder === f.name ? '3px solid #10B981' : '3px solid transparent' }}>
                      <input type="checkbox" checked={f.checked} onChange={e => { e.stopPropagation(); toggleFolder(f.name, e.target.checked); }} style={{ accentColor: '#10B981' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: f.checked ? '#1A1A1A' : '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                        <div style={{ fontSize: 10, color: '#9CA3AF' }}>{cnt}/{total} sheets</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Right: page list */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '32px 36px 1fr 90px 32px', gap: 0, padding: '8px 12px', borderBottom: '1px solid #E5E7EB', position: 'sticky', top: 0, background: '#F9FAFB', zIndex: 1 }}>
                <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600 }}></div>
                <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600 }}>#</div>
                <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600 }}>SHEET NAME</div>
                <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600 }}>SOURCE</div>
                <div></div>
              </div>
              {/* Rows */}
              {folderPages.map((p, i) => (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '32px 36px 1fr 90px 32px', gap: 0, padding: '6px 12px', alignItems: 'center',
                  borderBottom: '1px solid #F3F4F6', background: p.checked ? '#fff' : '#FAFAFA' }}>
                  <input type="checkbox" checked={p.checked} onChange={() => togglePage(p.id)} style={{ accentColor: '#10B981' }} />
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>{p.pageNum || (i + 1)}</span>
                  {editingId === p.id ? (
                    <input ref={editRef} defaultValue={p.name} autoFocus
                      onBlur={e => renamePage(p.id, e.target.value.trim() || p.name)}
                      onKeyDown={e => { if (e.key === 'Enter') renamePage(p.id, e.target.value.trim() || p.name); if (e.key === 'Escape') setEditingId(null); }}
                      style={{ fontSize: 12, color: '#1A1A1A', border: '1px solid #10B981', borderRadius: 4, padding: '3px 6px', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                  ) : (
                    <div onClick={() => setEditingId(p.id)} style={{ fontSize: 12, color: p.checked ? '#1A1A1A' : '#9CA3AF', cursor: 'text', padding: '3px 6px', borderRadius: 4, minHeight: 20,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title="Click to rename">{p.name}</div>
                  )}
                  <span style={{ fontSize: 10, color: p.source === 'auto-detect' ? '#10B981' : p.source === 'manual' ? '#3B82F6' : '#9CA3AF', fontWeight: 500 }}>
                    {p.source === 'auto-detect' ? 'Auto-detect' : p.source === 'manual' ? 'Manual' : p.source === 'filename' ? 'Filename' : 'Not found'}
                  </span>
                  <span></span>
                </div>
              ))}
              {folderPages.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Select a folder to see sheets</div>}
            </div>
          </div>

          {/* Settings bar */}
          <div style={{ borderTop: '1px solid #E5E7EB', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} style={{ accentColor: '#10B981' }} />
              <span style={{ fontSize: 11, color: '#333' }}>Skip duplicates</span>
            </label>
            <div style={{ flex: 1 }} />
            <button onClick={() => { setPages(prev => prev.map(p => ({ ...p, checked: true }))); setFolders(prev => prev.map(f => ({ ...f, checked: true }))); }}
              style={{ fontSize: 10, color: '#10B981', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Select All</button>
            <button onClick={() => { setPages(prev => prev.map(p => ({ ...p, checked: false }))); setFolders(prev => prev.map(f => ({ ...f, checked: false }))); }}
              style={{ fontSize: 10, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}>None</button>
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <div style={{ flex: 1 }} />
            <button onClick={startUpload} disabled={selectedCount === 0}
              style={{ padding: '8px 20px', background: selectedCount ? '#10B981' : '#E5E7EB', border: 'none', color: selectedCount ? '#fff' : '#9CA3AF', borderRadius: 6, cursor: selectedCount ? 'pointer' : 'default', fontSize: 13, fontWeight: 600 }}>
              {`Upload ${selectedCount} sheet${selectedCount !== 1 ? 's' : ''}`} &rarr;
            </button>
          </div>
        </>)}

        {/* ═══ UPLOADING ═══ */}
        {step === 'uploading' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>Uploading {progress.current} of {progress.total} ({pct}%)</span>
                <button onClick={() => { cancelRef.current = true; }} style={{ background: 'none', border: '1px solid #EF4444', color: '#EF4444', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>Cancel</button>
              </div>
              <div style={{ height: 6, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#10B981', borderRadius: 3, width: `${pct}%`, transition: 'width 0.3s' }} />
              </div>
              {progress.file && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{progress.file}</div>}
            </div>
            {pages.filter(p => p.checked).map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 11 }}>
                <span>{results.success + results.failed >= pages.filter(pp => pp.checked).indexOf(p) + 1 ? (results.errors.some(e => e.name === p.name) ? '\u274C' : '\u2705') : progress.file === p.name ? '\u23F3' : '\u25CB'}</span>
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
