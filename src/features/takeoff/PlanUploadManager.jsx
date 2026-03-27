import React, { useState, useEffect, useRef } from 'react';

const SPEC_KEYWORDS = ['spec','addend','bid','contract','geotech','report','appendix','exhibit','submittal','schedule','narrative'];

function isSpecFolder(name) {
  const low = (name || '').toLowerCase();
  return SPEC_KEYWORDS.some(kw => low.includes(kw));
}

export default function PlanUploadManager({ rawFiles, onStartUpload, onClose }) {
  const [folders, setFolders] = useState([]); // [{name, checked, namingMode:'filename'|'ocr', files:[{name,path,checked,size,entry?,rawFile?}]}]
  const [selFolder, setSelFolder] = useState(null); // folder name
  const [globalOcr, setGlobalOcr] = useState(false);
  const [createFolders, setCreateFolders] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [parsing, setParsing] = useState(true);
  const [step, setStep] = useState('preview'); // preview | uploading | complete
  const [progress, setProgress] = useState({ current: 0, total: 0, file: '', folder: '' });
  const [folderStatus, setFolderStatus] = useState({}); // {folderName: {done:N, total:N, status:'waiting'|'active'|'complete'}}
  const [fileStatus, setFileStatus] = useState({}); // {path: 'queued'|'uploading'|'done'|'error'}
  const [results, setResults] = useState({ success: 0, failed: 0, errors: [] });
  const cancelRef = useRef(false);

  // Parse files on mount
  useEffect(() => {
    console.log('[UploadManager] mounted, rawFiles:', rawFiles?.length, Array.isArray(rawFiles) ? rawFiles.map(f=>f.name) : typeof rawFiles);
    if(rawFiles?.length) parseInput(rawFiles);
    else { console.warn('[UploadManager] no files received'); setParsing(false); }
  }, []);

  const ensureJSZip = () => new Promise((resolve) => {
    if (window.JSZip) { resolve(window.JSZip); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });

  const parseInput = async (fileList) => {
    setParsing(true);
    const files = Array.from(fileList);
    const tree = {};
    let hasZip = false;

    for (const file of files) {
      const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
      if (isZip) {
        hasZip = true;
        const JSZip = await ensureJSZip();
        if (!JSZip) continue;
        try {
          const zip = await JSZip.loadAsync(file);
          zip.forEach((path, entry) => {
            if (entry.dir) return;
            if (!path.toLowerCase().endsWith('.pdf')) return;
            const parts = path.split('/');
            const filename = parts.pop();
            const folder = parts.length ? parts.join('/') : 'Root';
            if (!tree[folder]) tree[folder] = { name: folder, checked: true, namingMode: 'filename', files: [] };
            tree[folder].files.push({ name: filename, path, checked: true, size: entry._data?.uncompressedSize || 0, entry });
          });
        } catch (e) { console.error('ZIP parse error:', e); }
      } else if (file.type?.includes('pdf') || file.type?.startsWith('image/') || file.name.toLowerCase().endsWith('.pdf')) {
        const folder = 'Selected Files';
        if (!tree[folder]) tree[folder] = { name: folder, checked: true, namingMode: 'filename', files: [] };
        tree[folder].files.push({ name: file.name, path: file.name, checked: true, size: file.size, rawFile: file });
      }
    }

    const folderList = Object.values(tree).sort((a, b) => {
      if (a.name === 'Root' || a.name === 'Selected Files') return 1;
      if (b.name === 'Root' || b.name === 'Selected Files') return -1;
      return a.name.localeCompare(b.name);
    });

    // Auto-uncheck spec folders
    folderList.forEach(f => {
      if (isSpecFolder(f.name)) {
        f.checked = false;
        f.files.forEach(ff => ff.checked = false);
      }
    });

    // For single multi-page PDF, default to OCR naming
    if (folderList.length === 1 && folderList[0].files.length === 1 && folderList[0].files[0].name.toLowerCase().endsWith('.pdf')) {
      folderList[0].namingMode = 'ocr';
    }

    setFolders(folderList);
    if (folderList.length) setSelFolder(folderList[0].name);
    setParsing(false);
  };

  const toggleFolder = (fname, checked) => {
    setFolders(prev => prev.map(f => f.name === fname ? { ...f, checked, files: f.files.map(ff => ({ ...ff, checked })) } : f));
  };

  const toggleFile = (fname, fpath) => {
    setFolders(prev => prev.map(f => {
      if (f.name !== fname) return f;
      const files = f.files.map(ff => ff.path === fpath ? { ...ff, checked: !ff.checked } : ff);
      return { ...f, files, checked: files.some(ff => ff.checked) };
    }));
  };

  const setNamingMode = (fname, mode) => {
    setFolders(prev => prev.map(f => f.name === fname ? { ...f, namingMode: mode } : f));
  };

  const totalFiles = folders.reduce((s, f) => s + f.files.length, 0);
  const selectedFiles = folders.reduce((s, f) => s + f.files.filter(ff => ff.checked).length, 0);
  const selectedFolder = folders.find(f => f.name === selFolder);

  useEffect(() => {
    if (globalOcr) setFolders(prev => prev.map(f => ({ ...f, namingMode: 'ocr' })));
  }, [globalOcr]);

  const startUpload = () => {
    cancelRef.current = false;
    setStep('uploading');
    setResults({ success: 0, failed: 0, errors: [] });

    const checkedFolders = folders.filter(f => f.checked && f.files.some(ff => ff.checked));
    const allChecked = checkedFolders.flatMap(f => f.files.filter(ff => ff.checked).map(ff => ({ ...ff, folder: f.name, namingMode: f.namingMode })));

    // Init statuses
    const fs = {};
    checkedFolders.forEach(f => { fs[f.name] = { done: 0, total: f.files.filter(ff => ff.checked).length, status: 'waiting' }; });
    setFolderStatus(fs);
    const ffs = {};
    allChecked.forEach(f => { ffs[f.path] = 'queued'; });
    setFileStatus(ffs);
    setProgress({ current: 0, total: allChecked.length, file: '', folder: '' });

    // Call parent with the prepared file list and callbacks
    onStartUpload({
      files: allChecked,
      folders: checkedFolders,
      createFolders,
      skipDuplicates,
      cancelRef,
      onFileStart: (path, folder) => {
        setFileStatus(prev => ({ ...prev, [path]: 'uploading' }));
        setFolderStatus(prev => ({ ...prev, [folder]: { ...prev[folder], status: 'active' } }));
      },
      onFileComplete: (path, folder) => {
        setFileStatus(prev => ({ ...prev, [path]: 'done' }));
        setFolderStatus(prev => {
          const f = { ...prev[folder], done: (prev[folder]?.done || 0) + 1 };
          if (f.done >= f.total) f.status = 'complete';
          return { ...prev, [folder]: f };
        });
        setResults(prev => ({ ...prev, success: prev.success + 1 }));
        setProgress(prev => ({ ...prev, current: prev.current + 1 }));
      },
      onFileError: (path, folder, err) => {
        setFileStatus(prev => ({ ...prev, [path]: 'error' }));
        setResults(prev => ({ ...prev, failed: prev.failed + 1, errors: [...prev.errors, { name: path.split('/').pop(), error: err }] }));
        setProgress(prev => ({ ...prev, current: prev.current + 1 }));
      },
      onProgress: (current, total, file, folder) => {
        setProgress({ current, total, file, folder });
      },
      onComplete: () => {
        setStep('complete');
      },
    });
  };

  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;

  // ── RENDER ──

  if (parsing) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>&#9696;</div>
        <div style={{ fontSize: 14, color: '#333' }}>Reading files...</div>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget && step !== 'uploading') onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '90vw', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A' }}>Plan Upload Manager</div>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
              {step === 'preview' && `${selectedFiles} of ${totalFiles} files selected`}
              {step === 'uploading' && `Uploading ${progress.current} of ${progress.total} files (${pct}%)`}
              {step === 'complete' && `${results.success} uploaded, ${results.failed} failed`}
            </div>
          </div>
          {step !== 'uploading' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 20 }}>&times;</button>
          )}
        </div>

        {/* ═══ PREVIEW STEP ═══ */}
        {step === 'preview' && (
          <>
            {/* Folder tree + file list */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {/* Left: folder tree */}
              <div style={{ width: 280, borderRight: '1px solid #E5E7EB', overflow: 'auto', padding: '12px 0', flexShrink: 0 }}>
                <div style={{ padding: '0 12px 8px', display: 'flex', gap: 6 }}>
                  <button onClick={() => setFolders(prev => prev.map(f => ({ ...f, checked: true, files: f.files.map(ff => ({ ...ff, checked: true })) })))}
                    style={{ fontSize: 10, color: '#10B981', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Select All</button>
                  <button onClick={() => setFolders(prev => prev.map(f => ({ ...f, checked: false, files: f.files.map(ff => ({ ...ff, checked: false })) })))}
                    style={{ fontSize: 10, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}>Deselect All</button>
                </div>
                {folders.map(f => (
                  <div key={f.name}
                    onClick={() => setSelFolder(f.name)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer',
                      background: selFolder === f.name ? '#F0FDF4' : 'transparent', borderLeft: selFolder === f.name ? '3px solid #10B981' : '3px solid transparent' }}>
                    <input type="checkbox" checked={f.checked} onChange={e => { e.stopPropagation(); toggleFolder(f.name, e.target.checked); }}
                      style={{ accentColor: '#10B981', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: f.checked ? '#1A1A1A' : '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.name === 'Root' ? '(Root files)' : f.name === 'Selected Files' ? 'Selected Files' : f.name}
                      </div>
                      <div style={{ fontSize: 10, color: '#9CA3AF' }}>{f.files.filter(ff => ff.checked).length} of {f.files.length} files</div>
                    </div>
                    {isSpecFolder(f.name) && <span style={{ fontSize: 9, color: '#E8A317', background: '#FEF3C7', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>Spec</span>}
                  </div>
                ))}
              </div>

              {/* Right: file list */}
              <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
                {selectedFolder ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>{selectedFolder.name}</span>
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>{selectedFolder.files.length} files</span>
                      <div style={{ flex: 1 }} />
                      <button onClick={() => setFolders(prev => prev.map(f => f.name !== selFolder ? f : { ...f, checked: true, files: f.files.map(ff => ({ ...ff, checked: true })) }))}
                        style={{ fontSize: 10, color: '#10B981', background: 'none', border: 'none', cursor: 'pointer' }}>All</button>
                      <button onClick={() => setFolders(prev => prev.map(f => f.name !== selFolder ? f : { ...f, checked: false, files: f.files.map(ff => ({ ...ff, checked: false })) }))}
                        style={{ fontSize: 10, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}>None</button>
                    </div>
                    {selectedFolder.files.map(ff => (
                      <div key={ff.path} onClick={() => toggleFile(selFolder, ff.path)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
                          background: ff.checked ? '#F9FAFB' : 'transparent', borderBottom: '1px solid #F3F4F6' }}>
                        <input type="checkbox" checked={ff.checked} onChange={() => toggleFile(selFolder, ff.path)}
                          onClick={e => e.stopPropagation()} style={{ accentColor: '#10B981', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: ff.checked ? '#1A1A1A' : '#9CA3AF', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ff.name}</span>
                        {ff.size > 0 && <span style={{ fontSize: 10, color: '#9CA3AF', flexShrink: 0 }}>{(ff.size / 1024 / 1024).toFixed(1)} MB</span>}
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>Select a folder to see files</div>
                )}
              </div>
            </div>

            {/* Naming & settings */}
            <div style={{ borderTop: '1px solid #E5E7EB', padding: '12px 24px', flexShrink: 0, maxHeight: 200, overflow: 'auto' }}>
              {/* Global OCR toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={globalOcr} onChange={e => setGlobalOcr(e.target.checked)} style={{ accentColor: '#10B981' }} />
                <span style={{ fontSize: 12, color: '#1A1A1A', fontWeight: 500 }}>Auto-name all with OCR</span>
                <span style={{ fontSize: 10, color: '#9CA3AF' }}>(uses AI credits)</span>
              </label>

              {/* Per-folder naming */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '4px 12px', fontSize: 12, alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, color: '#6B7280', fontSize: 10, textTransform: 'uppercase' }}>Folder</div>
                <div style={{ fontWeight: 600, color: '#6B7280', fontSize: 10, textTransform: 'uppercase' }}>Files</div>
                <div style={{ fontWeight: 600, color: '#6B7280', fontSize: 10, textTransform: 'uppercase' }}>Naming</div>
                {folders.filter(f => f.checked).map(f => (
                  <React.Fragment key={f.name}>
                    <div style={{ color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                    <div style={{ color: '#9CA3AF', textAlign: 'center' }}>{f.files.filter(ff => ff.checked).length}</div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                        <input type="radio" name={`nm_${f.name}`} checked={f.namingMode === 'filename'} onChange={() => setNamingMode(f.name, 'filename')} style={{ accentColor: '#10B981' }} />
                        <span style={{ fontSize: 11, color: '#333' }}>Filenames</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                        <input type="radio" name={`nm_${f.name}`} checked={f.namingMode === 'ocr'} onChange={() => setNamingMode(f.name, 'ocr')} style={{ accentColor: '#10B981' }} />
                        <span style={{ fontSize: 11, color: '#333' }}>Auto-name (OCR)</span>
                      </label>
                    </div>
                  </React.Fragment>
                ))}
              </div>

              {/* Settings toggles */}
              <div style={{ display: 'flex', gap: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={createFolders} onChange={e => setCreateFolders(e.target.checked)} style={{ accentColor: '#10B981' }} />
                  <span style={{ fontSize: 11, color: '#333' }}>Create folders matching ZIP structure</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} style={{ accentColor: '#10B981' }} />
                  <span style={{ fontSize: 11, color: '#333' }}>Skip duplicate filenames</span>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
              <div style={{ flex: 1 }} />
              <button onClick={startUpload} disabled={selectedFiles === 0}
                style={{ padding: '8px 20px', background: selectedFiles ? '#10B981' : '#E5E7EB', border: 'none', color: selectedFiles ? '#fff' : '#9CA3AF', borderRadius: 6, cursor: selectedFiles ? 'pointer' : 'default', fontSize: 13, fontWeight: 600 }}>
                Start Upload &rarr;
              </button>
            </div>
          </>
        )}

        {/* ═══ UPLOADING STEP ═══ */}
        {step === 'uploading' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
            {/* Overall progress bar */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>Uploading {progress.current} of {progress.total} files ({pct}%)</span>
                <button onClick={() => { cancelRef.current = true; }}
                  style={{ background: 'none', border: '1px solid #EF4444', color: '#EF4444', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>Cancel</button>
              </div>
              <div style={{ height: 6, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#10B981', borderRadius: 3, width: `${pct}%`, transition: 'width 0.3s' }} />
              </div>
              {progress.file && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{progress.folder}: {progress.file}</div>}
            </div>

            {/* Per-folder progress */}
            {Object.entries(folderStatus).map(([fname, fs]) => (
              <div key={fname} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>
                    {fs.status === 'complete' ? '\u2705' : fs.status === 'active' ? '\u23F3' : '\u23F8'}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#1A1A1A', flex: 1 }}>{fname}</span>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>{fs.done} of {fs.total}</span>
                </div>
                {/* Show individual files for active folder */}
                {fs.status === 'active' && folders.find(f => f.name === fname)?.files.filter(ff => ff.checked).map(ff => (
                  <div key={ff.path} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 2px 28px', fontSize: 11 }}>
                    <span>{fileStatus[ff.path] === 'done' ? '\u2705' : fileStatus[ff.path] === 'uploading' ? '\u23F3' : fileStatus[ff.path] === 'error' ? '\u274C' : '\u25CB'}</span>
                    <span style={{ color: fileStatus[ff.path] === 'error' ? '#EF4444' : '#6B7280' }}>{ff.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ═══ COMPLETE STEP ═══ */}
        {step === 'complete' && (
          <div style={{ flex: 1, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{results.failed === 0 ? '\u2705' : '\u26A0\uFE0F'}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1A1A', marginBottom: 8 }}>
              Upload Complete!
            </div>
            <div style={{ fontSize: 14, color: '#6B7280', marginBottom: 20 }}>
              {results.success} sheet{results.success !== 1 ? 's' : ''} uploaded
              {folders.filter(f => f.checked).length > 1 ? ` in ${folders.filter(f => f.checked).length} folders` : ''}
              {results.failed > 0 && <span style={{ color: '#EF4444' }}> — {results.failed} failed</span>}
            </div>
            {results.errors.length > 0 && (
              <div style={{ textAlign: 'left', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, marginBottom: 20, maxWidth: 400, margin: '0 auto 20px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#EF4444', marginBottom: 6 }}>Errors:</div>
                {results.errors.map((e, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#991B1B', marginBottom: 2 }}>{e.name}: {e.error}</div>
                ))}
              </div>
            )}
            <button onClick={onClose}
              style={{ padding: '10px 24px', background: '#10B981', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
