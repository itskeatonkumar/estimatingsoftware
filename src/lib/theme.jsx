import React, { useState, useEffect } from 'react';

const ThemeContext = React.createContext({ dark: true, toggle: () => {} });

export function useTheme() { return React.useContext(ThemeContext); }

function applyCSSVars(dark) {
  const r = document.documentElement;
  if (dark) {
    r.style.setProperty('--bg',    '#0a0a0a');
    r.style.setProperty('--bg2',   '#0d0d0d');
    r.style.setProperty('--bg3',   '#111111');
    r.style.setProperty('--bg4',   '#151515');
    r.style.setProperty('--bg5',   '#1a1a1a');
    r.style.setProperty('--bd',    '#1a1a1a');
    r.style.setProperty('--bd2',   '#2a2a2a');
    r.style.setProperty('--tx',    '#e5e5e5');
    r.style.setProperty('--tx2',   '#888888');
    r.style.setProperty('--tx3',   '#555555');
    r.style.setProperty('--tx4',   '#444444');
    r.style.setProperty('--inp',   '#0e0e0e');
    r.style.setProperty('--inpbd', 'var(--bd)');
    r.style.setProperty('--inptx', '#e0e0e0');
  } else {
    r.style.setProperty('--bg',    '#f4f4f5');
    r.style.setProperty('--bg2',   '#ffffff');
    r.style.setProperty('--bg3',   '#ffffff');
    r.style.setProperty('--bg4',   '#f9f9f9');
    r.style.setProperty('--bg5',   '#f0f0f0');
    r.style.setProperty('--bd',    '#e4e4e7');
    r.style.setProperty('--bd2',   '#d4d4d8');
    r.style.setProperty('--tx',    '#18181b');
    r.style.setProperty('--tx2',   '#52525b');
    r.style.setProperty('--tx3',   '#71717a');
    r.style.setProperty('--tx4',   '#a1a1aa');
    r.style.setProperty('--inp',   '#ffffff');
    r.style.setProperty('--inpbd', '#d4d4d8');
    r.style.setProperty('--inptx', '#18181b');
  }
}

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    let isDark = true;
    try { const s = localStorage.getItem("theme"); isDark = s ? s === "dark" : false; } catch {}
    applyCSSVars(isDark);
    return isDark;
  });
  const t = {
    bg: 'var(--bg)', bg2: 'var(--bg2)', bg3: 'var(--bg3)', bg4: 'var(--bg4)', bg5: 'var(--bg5)',
    border: 'var(--bd)', border2: 'var(--bd2)',
    text: 'var(--tx)', text2: 'var(--tx2)', text3: 'var(--tx3)', text4: 'var(--tx4)', text5: 'var(--tx4)',
    input: 'var(--inp)', inputBorder: 'var(--inpbd)', inputText: 'var(--inptx)',
  };
  const toggle = () => setDark(d => {
    const n = !d;
    applyCSSVars(n);
    try { localStorage.setItem("theme", n ? "dark" : "light"); } catch {}
    return n;
  });
  return <ThemeContext.Provider value={{ dark, toggle, t }}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button onClick={toggle} title={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{background:'none',border:'none',cursor:'pointer',fontSize:18,padding:4,color:'var(--tx3)'}}>
      {dark ? '☀' : '☾'}
    </button>
  );
}

export function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

// Shared style constants
export const labelStyle = {
  display: "block", fontSize: 10.5, fontFamily: "'DM Mono', monospace",
  color: "var(--tx3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 5
};
export const inputStyle = {
  width: "100%", background: "var(--bg)", border: "1px solid var(--bd)",
  borderRadius: 6, padding: "8px 10px", color: "var(--tx)", fontSize: 13,
  fontFamily: "'Syne', sans-serif", outline: "none", boxSizing: "border-box",
};
