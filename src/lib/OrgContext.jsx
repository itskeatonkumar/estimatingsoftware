import React, { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } from 'react';
import { supabase } from './supabase.js';

const ROLE_LEVELS = { owner: 4, admin: 3, editor: 2, viewer: 1 };

const OrgContext = createContext({ orgId: null, orgs: [], isSuperAdmin: false, viewAllOrgs: false, userRole: null, ready: false });

export function useOrg() { return useContext(OrgContext); }

export const canEdit = (role) => (ROLE_LEVELS[role] || 0) >= ROLE_LEVELS.editor;
export const canManageTeam = (role) => (ROLE_LEVELS[role] || 0) >= ROLE_LEVELS.admin;
export const canManageBilling = (role) => role === 'owner';

export function OrgProvider({ children }) {
  const [orgId, setOrgId] = useState(() => {
    try { return sessionStorage.getItem('cachedOrgId') || localStorage.getItem('selectedOrgId') || null; } catch { return null; }
  });
  const [orgs, setOrgs] = useState([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [viewAllOrgs, setViewAllOrgs] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const loadingRef = useRef(false); // prevent concurrent loads

  const loadOrg = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setOrgId(null); setOrgs([]); setReady(true); loadingRef.current = false; return; }

      const [profileRes, memberRes] = await Promise.all([
        supabase.from('profiles').select('is_super_admin').eq('id', user.id).single(),
        supabase.from('memberships').select('org_id, role, organizations(id, name)').eq('user_id', user.id),
      ]);

      if (profileRes.data?.is_super_admin) setIsSuperAdmin(true);

      let memberships = memberRes.data;
      if (!memberships || memberships.length === 0) {
        const orgName = (user.email?.split('@')[0] || 'My') + "'s Organization";
        const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + user.id.slice(0, 8);
        const { data: newOrg } = await supabase.from('organizations').insert([{ name: orgName, slug }]).select().single();
        if (newOrg) {
          await supabase.from('memberships').insert([{ user_id: user.id, org_id: newOrg.id, role: 'owner' }]);
          memberships = [{ org_id: newOrg.id, role: 'owner', organizations: newOrg }];
        }
      }

      if (memberships?.length) {
        const orgList = memberships.map(m => ({ id: m.org_id, name: m.organizations?.name || 'Organization', role: m.role }));
        setOrgs(orgList);
        const saved = localStorage.getItem('selectedOrgId');
        const match = orgList.find(o => o.id === saved);
        const selectedId = match ? match.id : orgList[0].id;
        setOrgId(selectedId);
        try { sessionStorage.setItem('cachedOrgId', selectedId); localStorage.setItem('selectedOrgId', selectedId); } catch {}
      }
    } catch (e) {
      console.error('[OrgContext] loadOrg failed:', e);
      // Recover from cache
      const cached = sessionStorage.getItem('cachedOrgId');
      if (cached && !orgId) setOrgId(cached);
    }
    setReady(true);
    loadingRef.current = false;
  }, []);

  // Initial load
  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  // Auth state changes — only reset on SIGNED_OUT
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setOrgId(null); setOrgs([]); setIsSuperAdmin(false); setReady(false);
        try { sessionStorage.removeItem('cachedOrgId'); } catch {}
        return;
      }
      // SIGNED_IN after being signed out — reload org
      if (event === 'SIGNED_IN' && !orgId && session?.user) {
        loadOrg();
        return;
      }
      // TOKEN_REFRESHED, INITIAL_SESSION, USER_UPDATED — keep current state
    });
    return () => subscription?.unsubscribe();
  }, [loadOrg, orgId]);

  // Tab visibility — re-verify session on focus, recover if needed
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          // Session still valid — if org missing, reload
          if (!orgId) loadOrg();
        } else {
          // Session gone — sign out
          setOrgId(null); setOrgs([]); setReady(true);
        }
      });
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [orgId, loadOrg]);

  // Timeout fallback — if still not ready after 8s, recover from cache or show error
  useEffect(() => {
    if (ready) return;
    const timeout = setTimeout(() => {
      if (ready) return;
      console.warn('[OrgContext] Loading timed out, attempting recovery');
      const cached = sessionStorage.getItem('cachedOrgId');
      if (cached) {
        setOrgId(cached);
        setReady(true);
      } else {
        setError('Failed to load workspace. Please refresh.');
        setReady(true);
      }
    }, 8000);
    return () => clearTimeout(timeout);
  }, [ready]);

  const switchOrg = useCallback((id) => {
    setOrgId(id);
    try { localStorage.setItem('selectedOrgId', id); sessionStorage.setItem('cachedOrgId', id); } catch {}
  }, []);

  const orgFilter = useCallback((query, col = 'org_id') => {
    if (isSuperAdmin && viewAllOrgs) return query;
    if (!orgId) return query;
    return query.eq(col, orgId);
  }, [orgId, isSuperAdmin, viewAllOrgs]);

  const userRole = useMemo(() => {
    if (!orgId || !orgs.length) return null;
    return orgs.find(o => o.id === orgId)?.role || 'viewer';
  }, [orgId, orgs]);

  return (
    <OrgContext.Provider value={{ orgId, orgs, isSuperAdmin, viewAllOrgs, setViewAllOrgs, switchOrg, orgFilter, ready, userRole, error }}>
      {children}
    </OrgContext.Provider>
  );
}
