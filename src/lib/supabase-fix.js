import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://vqpbdlgeixmskpivkmem.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_do7yAdj1jtz0DyIEvx2P3g_NFJoRlEB';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper: get current user's org_id (first org they belong to)
let _cachedOrgId = null;

export async function getCurrentOrgId() {
  if (_cachedOrgId) return _cachedOrgId;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  _cachedOrgId = data?.org_id || null;
  return _cachedOrgId;
}

// Clear cache on auth state change
supabase.auth.onAuthStateChange(() => { _cachedOrgId = null; });

// Safe delete: always chain .select() to surface RLS failures
export async function safeDelete(table, column, value) {
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq(column, value)
    .select();
  if (error) {
    console.error(`Delete failed on ${table}:`, error);
    return { success: false, error };
  }
  if (!data || data.length === 0) {
    console.warn(`Delete on ${table} affected 0 rows — possible RLS issue`);
    return { success: false, error: { message: 'No rows deleted — check RLS policies' } };
  }
  return { success: true, data };
}

// Safe update with .select() for RLS detection
export async function safeUpdate(table, payload, column, value) {
  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .eq(column, value)
    .select()
    .single();
  if (error) {
    console.error(`Update failed on ${table}:`, error);
    return { success: false, error };
  }
  return { success: true, data };
}
