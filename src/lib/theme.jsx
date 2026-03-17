import React, { useState, useEffect } from 'react';

const ThemeContext = React.createContext({ dark: false, toggle: () => {} });

export function useTheme() { return React.useContext(ThemeContext); }

function applyCSSVars(dark) {
  const r = document.documentElement;
  if (dark) {
    r.style.setProperty('--bg',    '#1a1a1a');
    r.style.setProperty('--bg2',   '#222222');
    r.style.setProperty('--bg3',   '#2a2a2a');
    r.style.setProperty('--bg4',   '#252525');
    r.style.setProperty('--bg5',   '#303030');
    r.style.setProperty('--bd',    '#333333');
    r.style.setProperty('--bd2',   '#444444');
    r.style.setProperty('--tx',    '#e5e5e5');
    r.style.setProperty('--tx2',   '#999999');
    r.style.setProperty('--tx3',   '#777777');
    r.style.setProperty('--tx4',   '#666666');
    r.style.setProperty('--inp',   '#1e1e1e');
    r.style.setProperty('--inpbd', '#333333');
    r.style.setProperty('--inptx', '#e0e0e0');
  } else {
    r.style.setProperty('--bg',    '#ffffff');
    r.style.setProperty('--bg2',   '#ffffff');
    r.style.setProperty('--bg3',   '#f5f5f5');
    r.style.setProperty('--bg4',   '#fafafa');
    r.style.setProperty('--bg5',   '#f0f0f0');
    r.style.setProperty('--bd',    '#e0e0e0');
    r.style.setProperty('--bd2',   '#d0d0d0');
    r.style.setProperty('--tx',    '#333333');
    r.style.setProperty('--tx2',   '#666666');
    r.style.setProperty('--tx3',   '#999999');
    r.style.setProperty('--tx4',   '#999999');
    r.style.setProperty('--inp',   '#ffffff');
    r.style.setProperty('--inpbd', '#e0e0e0');
    r.style.setProperty('--inptx', '#333333');
  }
}

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    let isDark = false;
    try { const s = localStorage.getItem("theme"); isDark = s === "dark"; } catch {}
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
    <button onClick={toggle} title={dark ? "Light mode" : "Dark mode"}
      style={{background:'none',border:`1px solid var(--bd)`,cursor:'pointer',fontSize:11,padding:'4px 8px',color:'var(--tx3)',borderRadius:4}}>
      {dark ? 'Light' : 'Dark'}
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
  display: "block", fontSize: 12, fontWeight: 500,
  color: "var(--tx2)", marginBottom: 5
};
export const inputStyle = {
  width: "100%", background: "var(--inp)", border: "1px solid var(--inpbd)",
  borderRadius: 4, padding: "8px 10px", color: "var(--inptx)", fontSize: 13,
  outline: "none", boxSizing: "border-box",
};
