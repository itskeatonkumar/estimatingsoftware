import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://vqpbdlgeixmskpivkmem.supabase.co',
  'sb_publishable_do7yAdj1jtz0DyIEvx2P3g_NFJoRlEB'
);

/** Authenticated fetch — adds Bearer token from current Supabase session */
export async function authFetch(url, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { ...opts.headers };
  if (session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
  return fetch(url, { ...opts, headers });
}