import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, org_id, user_id, seats, success_url, cancel_url } = req.body;

  try {
    // Find or create Stripe customer
    let customer;
    if (email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      customer = customers.data[0];
      if (!customer) {
        customer = await stripe.customers.create({ email, metadata: { org_id: org_id || '', user_id: user_id || '' } });
      }
    }

    const sessionParams = {
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: seats || 1 }],
      mode: 'subscription',
      subscription_data: {
        trial_period_days: 7,
        metadata: { org_id: org_id || '', user_id: user_id || '' }
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
