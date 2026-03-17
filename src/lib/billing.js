import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';

/**
 * useBilling — provides current org plan, limits, and upgrade actions
 * 
 * Usage:
 *   const { plan, limits, canCreate, createCheckout } = useBilling();
 *   if (!canCreate('project')) showUpgradePrompt();
 */
export function useBilling() {
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrg();
  }, []);

  async function loadOrg() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('memberships')
      .select('org_id, organizations(*)')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (data?.organizations) {
      setOrg(data.organizations);
    }
    setLoading(false);
  }

  const plan = org?.plan || 'free';
  const isFree = plan === 'free';
  const isPro = plan === 'pro';
  const isEnterprise = plan === 'enterprise';
  const isTrial = org?.subscription_status === 'trialing';
  const isPastDue = org?.subscription_status === 'past_due';

  const limits = {
    maxProjects: org?.max_projects || 2,
    maxMembers: org?.max_members || 1,
    maxSheetsPerProject: org?.max_sheets_per_project || 10,
  };

  // Check if user can create a resource (checks against current counts)
  async function canCreate(resource) {
    if (!org) return false;
    if (isEnterprise) return true;

    if (resource === 'project') {
      const { count } = await supabase
        .from('precon_projects')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', org.id);
      return (count || 0) < limits.maxProjects;
    }

    if (resource === 'member') {
      const { count } = await supabase
        .from('memberships')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', org.id);
      return (count || 0) < limits.maxMembers;
    }

    return true;
  }

  // Create a Stripe Checkout session and redirect
  async function createCheckout(priceId) {
    if (!org) return;

    // Call your Vercel API route to create a checkout session
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: org.id,
        price_id: priceId,
        success_url: window.location.origin + '/#/estimate',
        cancel_url: window.location.origin + '/#/estimate',
      }),
    });

    const { url, error } = await res.json();
    if (url) {
      window.location.href = url;
    } else {
      console.error('Checkout error:', error);
    }
  }

  // Open Stripe Customer Portal for self-service billing
  async function openPortal() {
    if (!org?.stripe_customer_id) return;

    const res = await fetch('/api/create-portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: org.stripe_customer_id,
        return_url: window.location.href,
      }),
    });

    const { url, error } = await res.json();
    if (url) {
      window.location.href = url;
    } else {
      console.error('Portal error:', error);
    }
  }

  return {
    org,
    plan,
    limits,
    loading,
    isFree,
    isPro,
    isEnterprise,
    isTrial,
    isPastDue,
    canCreate,
    createCheckout,
    openPortal,
    refresh: loadOrg,
  };
}
