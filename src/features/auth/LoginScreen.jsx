import React, { useState } from "react";
import { labelStyle, inputStyle } from "../../lib/theme.jsx";
import { supabase } from "../../lib/supabase.js";

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) return;
    setLoading(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setLoading(false); }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) { setError('Enter your email first.'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) setError(error.message);
    else setResetSent(true);
  };

  return (
    <div style={{ minHeight: "100dvh", background: "#F9FAFB", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 40, justifyContent: "center" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#10B981", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#fff", fontWeight: 700 }}>S</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1A1A1A", letterSpacing: -0.5 }}>ScopeTakeoff</div>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 400 }}>Construction Takeoff & Estimating</div>
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#1A1A1A", marginBottom: 4 }}>Sign in</div>
          <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 24 }}>Use your work email and password</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoFocus onKeyDown={e => e.key === "Enter" && handleLogin()} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && handleLogin()} style={inputStyle} />
            </div>
          </div>
          {error && <div style={{ marginTop: 14, color: "#991B1B", fontSize: 12, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "10px 12px" }}>{error}</div>}
          {resetSent && <div style={{ marginTop: 14, color: "#065F46", fontSize: 12, background: "#D1FAE5", border: "1px solid #A7F3D0", borderRadius: 6, padding: "10px 12px" }}>Password reset email sent. Check your inbox.</div>}
          <button onClick={handleLogin} disabled={loading || !email.trim() || !password.trim()}
            style={{ marginTop: 20, width: "100%", background: "#10B981", border: "none", borderRadius: 6, padding: 0, height: 44, color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: email.trim() && password.trim() && !loading ? 1 : 0.4 }}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <button onClick={handleForgotPassword} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 12 }}>Forgot password?</button>
            <a href="#/signup" style={{ color: '#10B981', textDecoration: 'none', fontSize: 12, fontWeight: 500 }}>Create account</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginScreen;
