import { errorResponse, getStripe, requireMethod, setCors } from "../lib/stripe.js";

const sessionPattern = /^cs_(test|live)_[A-Za-z0-9_]+$/;

export default async function handler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "POST")) return;
  const sessionId = request.body?.session_id;
  if (typeof sessionId !== "string" || !sessionPattern.test(sessionId)) {
    return response.status(400).json({ error: "A valid Checkout session ID is required." });
  }
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    if (session.mode !== "subscription" || !session.customer) {
      return response.status(400).json({ error: "This purchase does not have a subscription to manage." });
    }
    const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
    const baseUrl = process.env.PUBLIC_BASE_URL || "https://demonstudios.vercel.app";
    const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: baseUrl });
    response.status(200).json({ url: portal.url });
  } catch (error) {
    errorResponse(response, error, "Could not create a Stripe customer portal session.");
  }
}