import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { customer_id, return_url } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'Missing customer_id' });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customer_id,
      return_url: return_url || 'https://app.scopetakeoff.com',
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: err.message });
  }
}
