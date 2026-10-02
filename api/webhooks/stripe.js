import { getStripe } from "../../lib/stripe.js";

export const config = { api: { bodyParser: false } };

async function rawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed." });
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return response.status(503).json({ error: "Stripe webhook signing secret is not configured." });
  }
  try {
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(
      await rawBody(request),
      request.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id);
      if (!["paid", "no_payment_required"].includes(session.payment_status)) {
        return response.status(200).json({ received: true, pending: true });
      }
    }
    response.status(200).json({ received: true });
  } catch {
    response.status(400).json({ error: "Invalid Stripe webhook signature or event." });
  }
}