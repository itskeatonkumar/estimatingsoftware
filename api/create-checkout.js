import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check — require valid Supabase session
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authErr || !user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const { email, org_id, user_id, seats, success_url, cancel_url } = req.body;

  try {
    // Find or create Stripe customer
    let customer;
    const customerEmail = email || user.email;
    if (customerEmail) {
      const customers = await stripe.customers.list({ email: customerEmail, limit: 1 });
      customer = customers.data[0];
      if (!customer) {
        customer = await stripe.customers.create({ email: customerEmail, metadata: { org_id: org_id || '', user_id: user_id || user.id } });
      }
    }

    const sessionParams = {
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: seats || 1 }],
      mode: 'subscription',
      subscription_data: {
        trial_period_days: 7,
        metadata: { org_id: org_id || '', user_id: user_id || user.id }
      },
      success_url: success_url || 'https://app.scopetakeoff.com/#/onboarding',
      cancel_url: cancel_url || 'https://app.scopetakeoff.com/#/signup',
    };
    if (customer) sessionParams.customer = customer.id;

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message });
  }
}
