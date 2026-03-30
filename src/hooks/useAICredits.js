import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

/**
 * Reusable hook for AI credit tracking.
 * Wraps the existing get_ai_credits / use_ai_credit RPCs.
 */
export default function useAICredits(orgId) {
  const [credits, setCredits] = useState(null); // {available, monthly, used, purchased, reset_at}
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_ai_credits');
      if (!error && data) setCredits(data);
      else setCredits({ available: 999, monthly: 999, used: 0, purchased: 0, reset_at: null });
    } catch {
      setCredits({ available: 999, monthly: 999, used: 0, purchased: 0, reset_at: null });
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const available = credits?.available ?? 999;
  const monthly = credits?.monthly ?? 999;
  const used = credits?.used ?? 0;
  const isUnlimited = monthly >= 999;

  const creditColor = isUnlimited ? '#6B7280'
    : available / monthly > 0.5 ? '#166534'
    : available / monthly > 0.2 ? '#92400E'
    : '#991B1B';

  const canUse = (n = 1) => isUnlimited || available >= n;

  /**
   * Use credits via the existing RPC. Returns updated credits or null on failure.
   * For operations that consume multiple credits, call once per credit or use logUsage.
   */
  const useCredit = async (planId, projectId) => {
    try {
      const { data, error } = await supabase.rpc('use_ai_credit', { p_plan_id: planId, p_project_id: projectId });
      if (!error && data && !data.error) {
        setCredits(prev => ({ ...prev, available: data.available, used: data.used }));
        return data;
      }
      if (data?.error === 'No credits remaining') return { error: 'No credits remaining' };
    } catch { /* credit system not set up */ }
    return null;
  };

  /**
   * Log bulk usage to ai_usage table (for batch operations like sheet naming).
   * Decrements the local available count immediately.
   */
  const logUsage = async (creditsUsed, usageType) => {
    try {
      await supabase.from('ai_usage').insert([{
        org_id: orgId,
        credits_used: creditsUsed,
        usage_type: usageType,
      }]);
      setCredits(prev => prev ? { ...prev, available: Math.max(0, prev.available - creditsUsed), used: prev.used + creditsUsed } : prev);
    } catch (e) { console.warn('[ai-credits] log failed:', e); }
  };

  return { credits, available, monthly, used, loading, isUnlimited, creditColor, canUse, useCredit, logUsage, reload: load, setCredits };
}
