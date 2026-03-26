import React, { useState, useEffect, useMemo, useCallback, createContext, useContext } from 'react';
import { supabase } from './supabase.js';

const ROLE_LEVELS = { owner: 4, admin: 3, editor: 2, viewer: 1 };

const OrgContext = createContext({ orgId: null, orgs: [], isSuperAdmin: false, viewAllOrgs: false, userRole: null, ready: false });

export function useOrg() { return useContext(OrgContext); }

export const canEdit = (role) => (ROLE_LEVELS[role] || 0) >= ROLE_LEVELS.editor;
export const canManageTeam = (role) => (ROLE_LEVELS[role] || 0) >= ROLE_LEVELS.admin;
export const canManageBilling = (role) => role === 'owner';

export function OrgProvider({ children }) {
  // Use cached orgId for instant render, then verify
  const [orgId, setOrgId] = useState(() => {
    try { return sessionStorage.getItem('cachedOrgId') || localStorage.getItem('selectedOrgId') || null; } catch { return null; }
  });
  const [orgs, setOrgs] = useState([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [viewAllOrgs, setViewAllOrgs] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if(!cancelled){ setOrgId(null); setReady(true); } return; }

      // Parallel: check super admin + get memberships
      const [profileRes, memberRes] = await Promise.all([
        supabase.from('profiles').select('is_super_admin').eq('id', user.id).single(),
        supabase.from('memberships').select('org_id, role, organizations(id, name)').eq('user_id', user.id),
      ]);
      if (cancelled) return;

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
      if (cancelled) return;

      if (memberships?.length) {
        const orgList = memberships.map(m => ({ id: m.org_id, name: m.organizations?.name || 'Organization', role: m.role }));
        setOrgs(orgList);
        const saved = localStorage.getItem('selectedOrgId');
        const match = orgList.find(o => o.id === saved);
        const selectedId = match ? match.id : orgList[0].id;
        setOrgId(selectedId);
        // Cache for instant load next time
        try { sessionStorage.setItem('cachedOrgId', selectedId); } catch {}
        try { localStorage.setItem('selectedOrgId', selectedId); } catch {}
      }
      setReady(true);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setOrgId(null); setOrgs([]); setIsSuperAdmin(false); setReady(false);
      try { sessionStorage.removeItem('cachedOrgId'); } catch {}
    });
    return () => { cancelled = true; subscription?.unsubscribe(); };
  }, []);

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
    <OrgContext.Provider value={{ orgId, orgs, isSuperAdmin, viewAllOrgs, setViewAllOrgs, switchOrg, orgFilter, ready, userRole }}>
      {children}
    </OrgContext.Provider>
  );
}
