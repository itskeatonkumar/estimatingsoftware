import React, { useState } from 'react';
import { supabase } from '../../lib/supabase.js';

export default function SignupPage() {
  const [form, setForm] = useState({ name: '', company: '', email: '', password: '', phone: '', seats: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cancelled = window.location.hash.includes('cancelled=true');

  const handleSignup = async () => {
    if (!form.name.trim() || !form.company.trim() || !form.email.trim() || !form.password.trim()) {
      setError('Please fill in all required fields.'); return;
    }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true); setError('');

    try {
      // Step 1: Create auth account
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: { full_name: form.name.trim(), company: form.company.trim(), phone: form.phone } }
      });
      if (authErr) { setError(authErr.message); setLoading(false); return; }
      if (!authData.user) { setError('Signup failed. Please try again.'); setLoading(false); return; }

      // Step 2: Create organization
      const slug = form.company.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + authData.user.id.slice(0, 8);
      const { data: org, error: orgErr } = await supabase.from('organizations').insert([{
        name: form.company.trim(),
        slug,
        plan: 'trial',
        trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        max_projects: 100,
        max_members: form.seats || 1,
      }]).select().single();

      if (orgErr) { console.error('Org create error:', orgErr); }

      if (org) {
        // Step 3: Create membership
        await supabase.from('memberships').insert([{ user_id: authData.user.id, org_id: org.id, role: 'owner' }]);

        // Step 4: Update profile
        await supabase.from('profiles').update({ full_name: form.name.trim() }).eq('id', authData.user.id);

        // Step 5: Redirect to Stripe Checkout
        try {
          const resp = await fetch('/api/create-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: form.email.trim(),
              org_id: org.id,
              user_id: authData.user.id,
              seats: form.seats || 1,
              success_url: window.location.origin + '/#/onboarding',
              cancel_url: window.location.origin + '/#/signup?cancelled=true',
            })
          });
          const result = await resp.json();
          if (result.url) { window.location.href = result.url; return; }
          console.warn('No checkout URL, proceeding without Stripe:', result);
        } catch (e) {
          console.warn('Stripe checkout failed, proceeding:', e);
        }
      }

      // If Stripe fails, still go to app
      window.location.hash = '/onboarding';
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const monthly = (form.seats || 1) * 100;

  return (
    <div style={{ minHeight: '100dvh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32, justifyContent: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: 4, background: '#4CAF50', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#fff', fontWeight: 700 }}>S</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#333' }}>ScopeTakeoff</div>
            <div style={{ fontSize: 11, color: '#999' }}>Construction Takeoff & Estimating</div>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: 32 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#333', marginBottom: 4, textAlign: 'center' }}>Start your 7-day free trial</div>
          <div style={{ fontSize: 13, color: '#999', marginBottom: 24, textAlign: 'center' }}>$100/month per seat after trial. Cancel anytime.</div>

          {cancelled && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, padding: '8px 12px', marginBottom: 16, fontSize: 12, color: '#C0504D' }}>Checkout was cancelled. You can try again below.</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Full Name *</div>
              <input value={form.name} onChange={e => set('name', e.target.value)} style={inputStyle} autoFocus />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Company Name *</div>
              <input value={form.company} onChange={e => set('company', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Email *</div>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Password * (min 8 characters)</div>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSignup()} style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Phone (optional)</div>
                <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Number of Seats</div>
                <input type="number" min="1" value={form.seats} onChange={e => set('seats', Math.max(1, parseInt(e.target.value) || 1))} style={inputStyle} />
              </div>
            </div>
          </div>

          {/* Price preview */}
          <div style={{ background: '#E8F5E9', borderRadius: 4, padding: '10px 14px', marginTop: 16, fontSize: 13, color: '#333', textAlign: 'center' }}>
            {form.seats || 1} seat{(form.seats || 1) > 1 ? 's' : ''} × $100/month = <strong>${monthly}/month</strong> after 7-day trial
          </div>

          {error && <div style={{ marginTop: 12, color: '#C0504D', fontSize: 12, background: '#fef2f2', border: '1px solid #e0c0c0', borderRadius: 4, padding: '8px 12px' }}>{error}</div>}

          <button onClick={handleSignup} disabled={loading}
            style={{ marginTop: 16, width: '100%', background: '#4CAF50', border: 'none', borderRadius: 4, padding: '14px 0', color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Creating account...' : 'Start Free Trial →'}
          </button>

          <div style={{ fontSize: 11, color: '#999', marginTop: 12, textAlign: 'center', lineHeight: 1.5 }}>
            You'll enter payment details on the next step. You won't be charged until your 7-day trial ends.
          </div>

          <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
            <span style={{ color: '#999' }}>Already have an account? </span>
            <a href="#/login" style={{ color: '#4CAF50', textDecoration: 'none', fontWeight: 500 }}>Sign in</a>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 4,
  fontSize: 14, color: '#333', outline: 'none', boxSizing: 'border-box',
};
