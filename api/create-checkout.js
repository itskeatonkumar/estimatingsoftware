/**
 * Create Stripe Checkout Session — Vercel API Route
 * Place at: api/create-checkout.js
 * 
 * Env vars: STRIPE_SECRET_KEY
 */
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { org_id, price_id, success_url, cancel_url } = req.body;

  if (!org_id || !price_id) {
    return res.status(400).json({ error: 'Missing org_id or price_id' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: price_id, quantity: 1 }],
      success_url: success_url || `${req.headers.origin}/#/estimate`,
      cancel_url: cancel_url || `${req.headers.origin}/#/estimate`,
      metadata: { org_id },
      subscription_data: {
        metadata: { org_id },
        trial_period_days: 14,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
