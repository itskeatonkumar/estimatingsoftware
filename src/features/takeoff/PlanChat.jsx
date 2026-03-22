import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase.js';
import { AI_MODEL_FAST } from '../../lib/constants.js';

const SUGGESTIONS = [
  "What specs are called out on this sheet?",
  "Which sheet has the structural notes?",
  "Summarize the scope of work",
  "What concrete PSI is specified?",
];

export default function PlanChat({ project, plans, items, selPlan, onOpenSheet }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(`chat_${project.id}`) || '[]'); } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    try { sessionStorage.setItem(`chat_${project.id}`, JSON.stringify(messages.slice(-20))); } catch {}
  }, [messages, project.id]);

  const send = async (text) => {
    if (!text?.trim()) return;
    const q = text.trim();
    const userMsg = { role: 'user', content: q };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Decide context scope
      const isProjectWide = /which sheet|find|where|all sheets|every|project/i.test(q);
      const isQuantity = /how many|total|quantity|count/i.test(q);
      const isScopeQ = /write scope|generate scope|bid exclusion|terms and condition/i.test(q);

      if (isScopeQ) {
        setMessages(prev => [...prev, { role: 'assistant', content: '_scope_redirect_' }]);
        setLoading(false);
        return;
      }

      let ocrContext = '';
      if (isProjectWide) {
        ocrContext = plans.slice(0, 15).map(p => `[${p.name}]: ${(p.ocr_text || '').slice(0, 250)}`).join('\n\n');
      } else if (selPlan?.ocr_text) {
        ocrContext = `[${selPlan.name}]:\n${selPlan.ocr_text.slice(0, 3500)}`;
      } else {
        ocrContext = plans.slice(0, 5).map(p => `[${p.name}]: ${(p.ocr_text || '').slice(0, 400)}`).join('\n\n');
      }

      let itemsSummary = '';
      if (isQuantity || items.length <= 30) {
        itemsSummary = items.filter(i => i.plan_id != null).slice(0, 30).map(i => `- ${i.description}: ${i.quantity || 0} ${i.unit}`).join('\n');
      }

      // Build conversation (last 10 messages)
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));

      const resp = await fetch('/api/claude', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: "You are a construction plan reading assistant for ScopeTakeoff estimating software. Answer questions about construction plans based on the OCR text provided. Be concise and specific. If you can identify which sheet contains the answer, mention the sheet name. If the text doesn't contain enough info, say so honestly. Never make up dimensions or specifications.",
          messages: [...history, {
            role: 'user',
            content: `Project: ${project.name}\nCurrent Sheet: ${selPlan?.name || 'None'}\n\nSheet Text:\n${ocrContext.slice(0, 4000)}\n${itemsSummary ? '\nTakeoff Items:\n' + itemsSummary : ''}\n\nQuestion: ${q}`
          }]
        })
      });

      const json = await resp.json();
      const reply = json?.content?.find(b => b.type === 'text')?.text?.trim() || 'Sorry, I could not process that question.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + e.message }]);
    }
    setLoading(false);
  };

  // Render sheet name links in AI responses
  const renderMsg = (text) => {
    if (text === '_scope_redirect_') {
      return (
        <div>
          <div style={{ marginBottom: 8 }}>I can generate a full scope of work for your proposal.</div>
          <button onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('generateScope')); }}
            style={{ background: '#10B981', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>
            Generate Scope →
          </button>
        </div>
      );
    }
    // Make sheet names clickable
    let result = text;
    const parts = [];
    let last = 0;
    for (const plan of plans) {
      if (!plan.name) continue;
      let idx = result.indexOf(plan.name, last);
      while (idx !== -1) {
        if (idx > last) parts.push(result.slice(last, idx));
        parts.push({ sheet: plan });
        last = idx + plan.name.length;
        idx = result.indexOf(plan.name, last);
      }
    }
    if (last < result.length) parts.push(result.slice(last));
    if (parts.length <= 1) return text;
    return parts.map((p, i) =>
      typeof p === 'string' ? <span key={i}>{p}</span> :
        <span key={i} onClick={() => onOpenSheet?.(p.sheet)}
          style={{ color: '#10B981', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>{p.sheet.name}</span>
    );
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
    <div style={{ position: 'absolute', bottom: 16, right: 16, width: 320, height: 500, background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', zIndex: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ color: '#10B981', fontSize: 14 }}>✦</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>Plan Assistant</span>
        <button onClick={() => { setMessages([]); try { sessionStorage.removeItem(`chat_${project.id}`); } catch {} }}
          style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 10 }}>Clear</button>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 16 }}>—</button>
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
              {m.role === 'assistant' ? renderMsg(m.content) : m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start' }}>
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px 12px 12px 2px', padding: '8px 12px', fontSize: 12, color: '#9CA3AF' }}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>&#9696;</span> Thinking...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #E5E7EB', display: 'flex', gap: 8, flexShrink: 0 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Ask about your plans..."
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12, outline: 'none', color: '#1A1A1A', background: '#F9FAFB' }} />
        <button onClick={() => send(input)} disabled={loading || !input.trim()}
          style={{ background: '#10B981', border: 'none', color: '#fff', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 500, opacity: loading || !input.trim() ? 0.4 : 1 }}>
          Send
        </button>
      </div>
    </div>
  );
}
