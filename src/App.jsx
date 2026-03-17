import React, { useState, useEffect } from 'react';
import { ThemeProvider, ThemeToggle, useTheme } from './lib/theme.jsx';
import { supabase } from './lib/supabase.js';
import { ErrorBoundary } from './components/ui/ErrorBoundary.jsx';
import LoginScreen from './features/auth/LoginScreen.jsx';
import ProjectList from './features/takeoff/ProjectList.jsx';
import TakeoffWorkspace from './features/takeoff/TakeoffWorkspace.jsx';
import { TakeoffProjectModal } from './features/takeoff/TakeoffComponents.jsx';

function AppShell() {
  const { t } = useTheme();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selProject, setSelProject] = useState(null);
  const [deepLinkProjectId] = useState(() => {
    const h = window.location.hash.replace('#', '');
    if (h.startsWith('/project/')) return parseInt(h.split('/')[2]) || null;
    return null;
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Deep link: auto-open project by ID from URL hash
  useEffect(() => {
    if (!deepLinkProjectId || !user) return;
    supabase.from('precon_projects').select('*').eq('id', deepLinkProjectId).single()
      .then(({ data }) => { if (data) setSelProject(data); });
  }, [deepLinkProjectId, user]);

  if (authLoading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: t.bg, color: t.text4, fontSize: 13 }}>Loading...</div>;
  }

  if (!user) return <LoginScreen />;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: t.bg, color: t.text }}>
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
      <AppShell />
    </ThemeProvider>
  );
}
