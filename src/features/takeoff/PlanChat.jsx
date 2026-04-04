import React, { useState, useRef, useEffect } from 'react';
import { supabase, authFetch } from '../../lib/supabase.js';

const SUGGESTIONS = [
  "What specs are called out on this sheet?",
  "Which sheet has the structural notes?",
  "Summarize the scope of work",
  "What concrete PSI is specified?",
];

const VISUAL_HINTS = /how many|count|where are|show me|what does|look like|opening|door|window|fixture|layout|locate|identify|visible|drawn|symbol/i;

// Render the current plan image to a small JPEG base64
async function renderPlanImage(fileUrl) {
  try {
    const resp = await fetch(fileUrl);
    const blob = await resp.blob();
    // If it's already a JPEG/PNG, resize it
    const img = new Image();
    const bUrl = URL.createObjectURL(blob);
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = bUrl; });
    URL.revokeObjectURL(bUrl);
    // Scale down to max 1200px wide
    const MAX = 1200;
    const scale = Math.min(1, MAX / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const b64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
    canvas.width = 0; canvas.height = 0;
    return b64;
  } catch (e) {
    console.warn('[PlanChat] image render failed:', e);
    return null;
  }
}

export default function PlanChat({ project, plans, items, selPlan, onOpenSheet, onReextract }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(`chat_${project.id}`) || '[]'); } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    try { sessionStorage.setItem(`chat_${project.id}`, JSON.stringify(messages.slice(-20))); } catch {}
  }, [messages, project.id]);

  const send = async (text, forceImage = false) => {
    if (!text?.trim()) return;
    const q = text.trim();
    const useImage = forceImage || imageMode;
    const userMsg = { role: 'user', content: q, withImage: useImage };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Scope redirect
      if (/write scope|generate scope|bid exclusion|terms and condition/i.test(q)) {
        setMessages(prev => [...prev, { role: 'assistant', content: '_scope_redirect_' }]);
        setLoading(false);
        return;
      }

      // Fetch fresh OCR
      const {data:freshPlans} = await supabase.from('precon_plans').select('id, name, ocr_text').eq('project_id', project.id);
      const planOcrMap = new Map((freshPlans||[]).map(p=>[p.id, p]));
      const plansWithOcr = plans.map(p => ({...p, ocr_text: planOcrMap.get(p.id)?.ocr_text || p.ocr_text}));

      // Sort by discipline
      const priority = { 'S': 1, 'A': 2, 'C': 3, 'E': 4, 'M': 5, 'P': 6, 'L': 7, 'F': 8 };
      const sorted = [...plansWithOcr].sort((a, b) => {
        const ap = priority[(a.name || '')[0]?.toUpperCase()] || 99;
        const bp = priority[(b.name || '')[0]?.toUpperCase()] || 99;
        return ap - bp;
      });

      // Build OCR context
      let ocrContext = '';
      const MAX_CONTEXT = useImage ? 5000 : 30000; // less text when image is included
      for (const plan of sorted) {
        const incomplete = !plan.ocr_text || plan.ocr_text.length < 50;
        const text = plan.ocr_text || 'No text extracted';
        const tag = incomplete ? ' [OCR INCOMPLETE]' : '';
        const chunk = `\n\n=== SHEET: ${plan.name}${tag} ===\n${text}`;
        if (ocrContext.length + chunk.length > MAX_CONTEXT) {
          ocrContext += `\n\n=== SHEET: ${plan.name}${tag} ===\n${text.slice(0, 300)}...`;
          break;
        }
        ocrContext += chunk;
      }

      const itemsSummary = items.filter(i => i.plan_id != null).slice(0, 30)
        .map(i => `- ${i.description}: ${i.quantity || 0} ${i.unit}`).join('\n');

      const history = messages.slice(-8).filter(m => typeof m.content === 'string').map(m => ({ role: m.role, content: m.content }));

      // Build message content
      let userContent;
      const textPart = `Project: ${project.name}\nCurrent Sheet: ${selPlan?.name || 'None'}\n\n${itemsSummary ? 'Takeoff Items:\n' + itemsSummary + '\n\n' : ''}Plan Sheets OCR Text:\n${ocrContext}\n\nQuestion: ${q}`;

      if (useImage && selPlan?.file_url) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'user') return [...prev.slice(0, -1), { ...last, content: q + ' 📷' }];
          return prev;
        });
        const imageB64 = await renderPlanImage(selPlan.file_url);
        if (imageB64) {
          userContent = [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
            { type: 'text', text: textPart + '\n\nYou can SEE the current sheet image above. Look at the drawing to answer visual questions. Count items visually if asked. Reference specific areas on the plan.' }
          ];
        } else {
          userContent = textPart;
        }
      } else {
        userContent = textPart;
      }

      const model = useImage ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001';
      const requestBody = {
        model,
        max_tokens: useImage ? 1000 : 800,
        system: 'You are a construction plan reading assistant.' + (useImage ? ' You can SEE the current plan sheet image. Use both the image and the OCR text to answer questions. Count items visually when asked. Be specific about locations.' : ' You have OCR text from plan sheets. Search ALL sheets. Cite which sheet. Quote text. Be specific — give exact numbers, dimensions, specs. Never make up information.'),
        messages: [...history, { role: 'user', content: userContent }]
      };

      const resp = await authFetch('/api/claude', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!resp.ok) {
        const errText = await resp.text();
        setMessages(prev => [...prev, { role: 'assistant', content: `API error (${resp.status}): ${errText.slice(0, 200)}` }]);
        setLoading(false);
        return;
      }

      const json = await resp.json();
      const reply = json?.content?.find(b => b.type === 'text')?.text?.trim();
      if (!reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'No response. Raw: ' + JSON.stringify(json).slice(0, 200) }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: reply, withImage: useImage }]);
      }

      // Auto-suggest image mode if question looks visual and image wasn't used
      if (!useImage && VISUAL_HINTS.test(q)) {
        setMessages(prev => [...prev, { role: 'assistant', content: '_image_suggest_', question: q }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + e.message }]);
    }
    setLoading(false);
  };

  const renderMsg = (text, msg) => {
    if (text === '_scope_redirect_') {
      return (
        <div>
          <div style={{ marginBottom: 8 }}>I can generate a full scope of work for your proposal.</div>
          <button onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('generateScope')); }}
            style={{ background: '#10B981', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>
            Generate Scope &rarr;
          </button>
        </div>
      );
    }
    if (text === '_image_suggest_') {
      return (
        <div style={{ background: '#FEF3C7', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#92400E' }}>
          This question might need the visual plan.{' '}
          <button onClick={() => send(msg.question, true)}
            style={{ background: '#10B981', border: 'none', color: '#fff', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 10, fontWeight: 600, marginLeft: 4 }}>
            Ask with image (1 credit)
          </button>
        </div>
      );
    }
    // Make sheet names clickable
    const sortedPlans = [...plans].filter(p => p.name).sort((a, b) => b.name.length - a.name.length);
    let result = text;
    const renderParts = [];
    let lastIdx = 0;
    for (const plan of sortedPlans) {
      let idx = result.indexOf(plan.name);
      while (idx !== -1) {
        if (idx > lastIdx) renderParts.push({ type: 'text', value: result.slice(lastIdx, idx) });
        renderParts.push({ type: 'sheet', plan });
        lastIdx = idx + plan.name.length;
        idx = result.indexOf(plan.name, lastIdx);
      }
    }
    if (lastIdx < result.length) renderParts.push({ type: 'text', value: result.slice(lastIdx) });
    if (renderParts.length <= 1) return text;
    return renderParts.map((p, i) => {
      if (p.type === 'text') return <span key={i}>{p.value}</span>;
      return <span key={i} onClick={() => onOpenSheet?.(p.plan)}
        style={{ color: '#10B981', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>{p.plan.name}</span>;
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title="Plan Assistant"
        style={{ position: 'absolute', bottom: 80, right: 16, width: 44, height: 44, borderRadius: '50%', background: '#10B981', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        &#128172;
      </button>
    );
  }

  return (
    <div style={{ position: 'absolute', bottom: 16, right: 16, width: 340, height: 520, background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', zIndex: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ color: '#10B981', fontSize: 14 }}>{'\u2726'}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>Plan Assistant</span>
        <button onClick={() => { setMessages([]); try { sessionStorage.removeItem(`chat_${project.id}`); } catch {} }}
          style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 10 }}>Clear</button>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 16 }}>&mdash;</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 12, textAlign: 'center' }}>Ask anything about your plans</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s)}
                  style={{ background: '#F3F4F6', border: 'none', color: '#4B5563', padding: '6px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11 }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
            <div style={{
              background: m.role === 'user' ? '#ECFDF5' : '#fff',
              border: m.role === 'user' ? 'none' : '1px solid #E5E7EB',
              borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              padding: '8px 12px', fontSize: 12, color: '#1A1A1A', lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}>
              {m.role === 'assistant' ? renderMsg(m.content, m) : m.content}
            </div>
            {m.withImage && m.role === 'assistant' && <div style={{ fontSize: 9, color: '#7B6BA4', marginTop: 2 }}>{'\uD83D\uDCF7'} Used plan image</div>}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start' }}>
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px 12px 12px 2px', padding: '8px 12px', fontSize: 12, color: '#9CA3AF' }}>
              {imageMode ? '\uD83D\uDCF7 Analyzing image...' : 'Thinking...'}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid #E5E7EB', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => setImageMode(p => !p)} title={imageMode ? 'Image mode ON: AI can see the plan (uses Sonnet)' : 'Text only mode (uses Haiku)'}
            style={{ background: imageMode ? '#10B981' : '#F3F4F6', border: 'none', color: imageMode ? '#fff' : '#9CA3AF', width: 32, height: 32, borderRadius: 6, cursor: 'pointer', fontSize: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {'\uD83D\uDCF7'}
          </button>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder={imageMode ? 'Ask about what you see...' : 'Ask about your plans...'}
            style={{ flex: 1, padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, outline: 'none', color: '#1A1A1A', background: '#F9FAFB' }} />
          <button onClick={() => send(input)} disabled={loading || !input.trim()}
            style={{ background: '#10B981', border: 'none', color: '#fff', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500, opacity: loading || !input.trim() ? 0.4 : 1 }}>
            Send
          </button>
        </div>
        {imageMode && <div style={{ fontSize: 9, color: '#7B6BA4', marginTop: 3 }}>{'\uD83D\uDCF7'} Image mode: AI sees the current sheet (1 credit per question)</div>}
      </div>
    </div>
  );
}
