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
    <div style={{ minHeight: "100dvh", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 40, justifyContent: "center" }}>
          <div style={{ width: 36, height: 36, borderRadius: 4, background: "#4CAF50", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#fff", fontWeight: 700 }}>S</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#333" }}>ScopeTakeoff</div>
            <div style={{ fontSize: 12, color: "#999" }}>Construction Takeoff & Estimating</div>
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, padding: 32 }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: "#333", marginBottom: 4 }}>Sign in</div>
          <div style={{ fontSize: 13, color: "#999", marginBottom: 24 }}>Use your work email and password</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoFocus onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ ...inputStyle, fontSize: 14 }} />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ ...inputStyle, fontSize: 14 }} />
            </div>
          </div>
          {error && <div style={{ marginTop: 14, color: "#C0504D", fontSize: 12, background: "#fef2f2", border: "1px solid #e0c0c0", borderRadius: 4, padding: "10px 12px" }}>{error}</div>}
          {resetSent && <div style={{ marginTop: 14, color: "#4CAF50", fontSize: 12, background: "#E8F5E9", border: "1px solid #C8E6C9", borderRadius: 4, padding: "10px 12px" }}>Password reset email sent. Check your inbox.</div>}
          <button onClick={handleLogin} disabled={loading || !email.trim() || !password.trim()} style={{ marginTop: 20, width: "100%", background: "#4CAF50", border: "none", borderRadius: 4, padding: "12px 0", color: "#fff", fontSize: 14, fontWeight: 500, cursor: loading ? "not-allowed" : "pointer", opacity: email.trim() && password.trim() && !loading ? 1 : 0.4 }}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <button onClick={handleForgotPassword} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 12 }}>Forgot password?</button>
            <a href="#/signup" style={{ color: '#4CAF50', textDecoration: 'none', fontSize: 12, fontWeight: 500 }}>Create account</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginScreen;
