import React, { useState, useEffect } from 'react';
import { ThemeProvider, useTheme } from './lib/theme.jsx';
import { supabase } from './lib/supabase.js';
import { ErrorBoundary } from './components/ui/ErrorBoundary.jsx';
import { OrgProvider, useOrg } from './lib/OrgContext.jsx';
import LoginScreen from './features/auth/LoginScreen.jsx';
import SignupPage from './features/auth/SignupPage.jsx';
import OnboardingPage from './features/auth/OnboardingPage.jsx';
import ProjectList from './features/takeoff/ProjectList.jsx';
import TakeoffWorkspace from './features/takeoff/TakeoffWorkspace.jsx';
import OrgSettings from './features/settings/OrgSettings.jsx';

function TrialBanner() {
  const { orgId } = useOrg();
  const [trial, setTrial] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    supabase.from('organizations').select('plan, trial_ends_at, subscription_status, stripe_customer_id').eq('id', orgId).single()
      .then(({ data }) => {
        if (!data) return;
        if (data.subscription_status === 'active') { setTrial(null); return; }
        if (data.plan === 'trial' || data.subscription_status === 'trialing') {
          const daysLeft = Math.ceil((new Date(data.trial_ends_at) - Date.now()) / (1000 * 60 * 60 * 24));
          setTrial({ daysLeft: Math.max(0, daysLeft), expired: daysLeft <= 0, customerId: data.stripe_customer_id });
        }
      });
  }, [orgId]);

  if (!trial || dismissed) return null;
  if (trial.expired) return (
    <div style={{ background: '#C0504D', color: '#fff', padding: '10px 20px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <span style={{ flex: 1 }}>Your free trial has ended. Subscribe to continue using ScopeTakeoff.</span>
      <button onClick={async () => {
        const resp = await fetch('/api/create-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seats: 1, success_url: window.location.origin + '/#/', cancel_url: window.location.origin }) });
        const { url } = await resp.json();
        if (url) window.location.href = url;
      }} style={{ background: '#fff', color: '#C0504D', border: 'none', padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Subscribe Now</button>
    </div>
  );
  const color = trial.daysLeft >= 4 ? '#4CAF50' : trial.daysLeft >= 2 ? '#E8A317' : '#C0504D';
  return (
    <div style={{ background: color + '15', borderBottom: `1px solid ${color}40`, padding: '6px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <span style={{ color, flex: 1 }}>Free trial: <strong>{trial.daysLeft} day{trial.daysLeft !== 1 ? 's' : ''} remaining</strong></span>
      <button onClick={async () => {
        const resp = await fetch('/api/create-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seats: 1, success_url: window.location.origin + '/#/', cancel_url: window.location.origin }) });
        const { url } = await resp.json();
        if (url) window.location.href = url;
      }} style={{ background: color, color: '#fff', border: 'none', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>Subscribe</button>
      <button onClick={() => setDismissed(true)} style={{ background: 'none', border: 'none', color, cursor: 'pointer', fontSize: 14 }}>&times;</button>
    </div>
  );
}

function AppShell() {
  const { t } = useTheme();
  const { orgId, isSuperAdmin, viewAllOrgs, ready: orgReady, error: orgError } = useOrg();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selProject, setSelProject] = useState(null);
  const [hash, setHash] = useState(() => {
    // Handle path-based URLs → redirect to hash-based
    const path = window.location.pathname;
    if (path === '/signup' || path === '/login' || path === '/onboarding') {
      window.location.replace('/#' + path);
      return path;
    }
    return window.location.hash.replace('#', '') || '';
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    const onHash = () => setHash(window.location.hash.replace('#', '') || '');
    window.addEventListener('hashchange', onHash);
    return () => { listener.subscription.unsubscribe(); window.removeEventListener('hashchange', onHash); };
  }, []);

  // Deep link
  useEffect(() => {
    if (!user) return;
    if (hash.startsWith('/project/')) {
      const id = parseInt(hash.split('/')[2]) || null;
      if (id) {
        let q = supabase.from('precon_projects').select('*').eq('id', id);
        if (orgId && !(isSuperAdmin && viewAllOrgs)) q = q.eq('org_id', orgId);
        q.single().then(({ data }) => { if (data) setSelProject(data); });
      }
    }
  }, [hash, user]);

  if (authLoading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff', color: '#999', fontSize: 13 }}>Loading...</div>;

  // Unauthenticated routes
  if (!user) {
    if (hash === '/signup' || hash.startsWith('/signup')) return <SignupPage />;
    return <LoginScreen />;
  }

  // Onboarding
  if (hash === '/onboarding') return <OnboardingPage onGoToDashboard={() => { window.location.hash = '/'; setHash('/'); }} />;

  // Wait for org context to be ready before rendering data-dependent views
  if (!orgReady || orgError) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16 }}>S</div>
      {orgError ? (<>
        <div style={{ color: '#EF4444', fontSize: 13 }}>{orgError}</div>
        <button onClick={() => window.location.reload()} style={{ background: '#10B981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Refresh</button>
      </>) : (
        <div style={{ color: '#9CA3AF', fontSize: 13 }}>Loading workspace...</div>
      )}
    </div>
  );

  // Settings
  if (hash === '/settings') return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: t.bg, color: t.text }}>
      <OrgSettings user={user} onBack={() => { window.location.hash = ''; setHash(''); }} />
    </div>
  );

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: t.bg, color: t.text }}>
      <TrialBanner />
      {selProject ? (
        <ErrorBoundary feature="Takeoff Workspace">
          <TakeoffWorkspace
            project={selProject}
            onBack={() => { setSelProject(null); window.location.hash = ''; }}
            apmProjects={[]}
            onExitToOps={null}
          />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary feature="Projects">
          <ProjectList
            onSelectProject={(p) => { setSelProject(p); window.location.hash = `/project/${p.id}`; }}
            user={user}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <OrgProvider>
        <AppShell />
      </OrgProvider>
    </ThemeProvider>
  );
}
