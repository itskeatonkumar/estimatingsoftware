/**
 * Stripe Webhook Handler — Vercel API Route
 * 
 * Place at: api/webhooks/stripe.js
 * 
 * Handles subscription lifecycle events and syncs to Supabase organizations table.
 * Configure in Stripe Dashboard → Webhooks → Add endpoint:
 *   URL: https://opsboard-six.vercel.app/api/webhooks/stripe
 *   Events: customer.subscription.created, customer.subscription.updated,
 *           customer.subscription.deleted, checkout.session.completed
 * 
 * Environment variables needed:
 *   STRIPE_SECRET_KEY — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET — whsec_...
 *   SUPABASE_URL — your project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (NOT anon key)
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Use service role to bypass RLS — this is server-side only
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Plan config — maps Stripe price IDs to feature limits
const PLAN_LIMITS = {
  free:       { max_projects: 2,   max_members: 1,  max_sheets_per_project: 10 },
  pro:        { max_projects: 999, max_members: 5,  max_sheets_per_project: 999 },
  enterprise: { max_projects: 999, max_members: 99, max_sheets_per_project: 999 },
};

// Map Stripe price IDs to plan names (update these with your actual Stripe price IDs)
const PRICE_TO_PLAN = {
  // 'price_xxx_monthly_pro': 'pro',
  // 'price_xxx_annual_pro': 'pro',
  // 'price_xxx_enterprise': 'enterprise',
};

function getPlanFromPriceId(priceId) {
  return PRICE_TO_PLAN[priceId] || 'pro';
}

export const config = {
  api: { bodyParser: false }, // Need raw body for Stripe signature verification
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read raw body for signature verification
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log(`[Stripe Webhook] ${event.type}`, event.id);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const orgId = session.metadata?.org_id;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (orgId && customerId) {
          // Link Stripe customer to org
          const { error } = await supabase.from('organizations').update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_status: 'active',
          }).eq('id', orgId);

          if (error) console.error('Failed to update org after checkout:', error);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const status = subscription.status; // 'active', 'past_due', 'canceled', 'trialing'
        const priceId = subscription.items.data[0]?.price?.id;
        const plan = getPlanFromPriceId(priceId);
        const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.pro;

        const { error } = await supabase.from('organizations').update({
          stripe_subscription_id: subscription.id,
          stripe_price_id: priceId,
          subscription_status: status,
          plan,
          ...limits,
        }).eq('stripe_customer_id', customerId);

        if (error) console.error('Failed to update subscription:', error);
        console.log(`[Stripe] Subscription ${status} for customer ${customerId}, plan: ${plan}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        // Downgrade to free
        const { error } = await supabase.from('organizations').update({
          subscription_status: 'canceled',
          plan: 'free',
          ...PLAN_LIMITS.free,
        }).eq('stripe_customer_id', customerId);

        if (error) console.error('Failed to downgrade after cancellation:', error);
        console.log(`[Stripe] Subscription canceled for customer ${customerId}`);
        break;
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, err);
    return res.status(500).json({ error: 'Internal processing error' });
  }

  return res.status(200).json({ received: true });
}
