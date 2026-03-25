import React, { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { supabase } from './supabase.js';

const ROLE_LEVELS = { owner: 4, admin: 3, editor: 2, viewer: 1 };

const OrgContext = createContext({ orgId: null, orgs: [], isSuperAdmin: false, viewAllOrgs: false, userRole: null });

export function useOrg() { return useContext(OrgContext); }

// Permission helpers — importable by any component
export const canEdit = (role) => (ROLE_LEVELS[role] || 0) >= ROLE_LEVELS.editor;
export const canManageTeam = (role) => (ROLE_LEVELS[role] || 0) >= ROLE_LEVELS.admin;
export const canManageBilling = (role) => role === 'owner';

export function OrgProvider({ children }) {
  const [orgId, setOrgId] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [viewAllOrgs, setViewAllOrgs] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setReady(true); return; }

      // Check super admin
      const { data: profile } = await supabase.from('profiles').select('is_super_admin').eq('id', user.id).single();
      if (profile?.is_super_admin) setIsSuperAdmin(true);

      // Get memberships
      let { data: memberships } = await supabase.from('memberships').select('org_id, role, organizations(id, name)').eq('user_id', user.id);

      if (!memberships || memberships.length === 0) {
        // Auto-create personal org
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
        console.log('[OrgContext] SETTING ORG ID:', selectedId, 'from', orgList.length, 'orgs:', orgList.map(o => o.name));
        setOrgId(selectedId);
      }
      setReady(true);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setOrgId(null); setOrgs([]); setIsSuperAdmin(false); setReady(false);
    });
    return () => subscription?.unsubscribe();
  }, []);

  const switchOrg = (id) => {
    setOrgId(id);
    try { localStorage.setItem('selectedOrgId', id); } catch {}
  };

  const orgFilter = (query, col = 'org_id') => {
    if (isSuperAdmin && viewAllOrgs) return query;
    if (!orgId) return query;
    return query.eq(col, orgId);
  };

  // Derive userRole from selected org
  const userRole = useMemo(() => {
    if (!orgId || !orgs.length) return null;
    const match = orgs.find(o => o.id === orgId);
    return match?.role || 'viewer';
  }, [orgId, orgs]);

  return (
    <OrgContext.Provider value={{ orgId, orgs, isSuperAdmin, viewAllOrgs, setViewAllOrgs, switchOrg, orgFilter, ready, userRole }}>
      {children}
    </OrgContext.Provider>
  );
}
