import React from 'react';
import { labelStyle } from '../../lib/theme.jsx';

/**
 * Modal — full-screen overlay with centered content panel
 */
export function Modal({ title, children, onClose, width = 540 }) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 1000, padding: isMobile ? 0 : 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "var(--bg3)", border: "1px solid var(--bd2)", borderRadius: isMobile ? "16px 16px 0 0" : 12, padding: isMobile ? "24px 20px 32px" : 28, width: "100%", maxWidth: isMobile ? "100%" : width, boxShadow: "0 24px 80px rgba(0,0,0,0.7)", maxHeight: isMobile ? "92vh" : "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--tx)", fontFamily: "'Syne',sans-serif" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--tx3)", cursor: "pointer", fontSize: 22 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// Aliases for backward compatibility
export function APMModal(props) { return Modal(props); }
export function APMField(props) { return Field(props); }
