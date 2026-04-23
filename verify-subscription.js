// Cloudflare Worker — DiskTree subscription verifier
// Deploy at: workers.cloudflare.com (or via wrangler)
// Set secret: PADDLE_API_KEY = your Paddle API key (live_...)
//
// The app POSTs { "email": "customer@example.com" }
// Worker checks Paddle Billing for an active subscription on that email.
// Returns { "valid": true/false, "status": "active"|"canceled"|"not_found" }

export default {
  async fetch(request, env) {

    // CORS — allow requests from the app and website
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    let email;
    try {
      const body = await request.json();
      email = (body.email || '').trim().toLowerCase();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
    }

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ valid: false, status: 'invalid_email' }), { status: 200, headers });
    }

    try {
      // 1. Look up customer by email
      const customerRes = await fetch(
        `https://api.paddle.com/customers?email=${encodeURIComponent(email)}&per_page=1`,
        {
          headers: {
            'Authorization': `Bearer ${env.PADDLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const customerData = await customerRes.json();
      const customer = customerData?.data?.[0];

      if (!customer) {
        return new Response(JSON.stringify({ valid: false, status: 'not_found' }), { status: 200, headers });
      }

      // 2. Look up subscriptions for that customer
      const subRes = await fetch(
        `https://api.paddle.com/subscriptions?customer_id=${customer.id}&per_page=10`,
        {
          headers: {
            'Authorization': `Bearer ${env.PADDLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const subData = await subRes.json();
      const subscriptions = subData?.data ?? [];

      // Active = "active" or "trialing"
      const active = subscriptions.find(
        s => s.status === 'active' || s.status === 'trialing'
      );

      if (active) {
        return new Response(JSON.stringify({ valid: true, status: active.status }), { status: 200, headers });
      }

      // Has a subscription but it's canceled/past_due
      const any = subscriptions[0];
      if (any) {
        return new Response(JSON.stringify({ valid: false, status: any.status }), { status: 200, headers });
      }

      return new Response(JSON.stringify({ valid: false, status: 'no_subscription' }), { status: 200, headers });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Upstream error' }), { status: 502, headers });
    }
  },
};
