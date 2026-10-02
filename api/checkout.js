import { errorResponse, getStripe, makeIntegrationIdentifier, requireMethod, setCors } from "../lib/stripe.js";

export default async function handler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "POST")) return;
  if (process.env.STRIPE_BILLING_ENABLED !== "true") {
    return response.status(503).json({ error: "Checkout is paused until Stripe account and payout setup are complete." });
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return response.status(503).json({ error: "Billing is paused until the Stripe webhook is configured." });
  }
  const { plan } = request.body || {};
  const price = plan === "monthly" ? process.env.STRIPE_PRICE_MONTHLY : plan === "lifetime" ? process.env.STRIPE_PRICE_LIFETIME : null;
  if (!price || price.includes("replace_me")) {
    return response.status(503).json({ error: "Set the matching Stripe price ID in Vercel before opening checkout." });
  }
  const baseUrl = process.env.PUBLIC_BASE_URL || "https://demonstudios.vercel.app";
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: plan === "monthly" ? "subscription" : "payment",
      line_items: [{ price, quantity: 1 }],
      billing_address_collection: "auto",
      integration_identifier: makeIntegrationIdentifier(),
      ...(plan === "lifetime" ? { invoice_creation: { enabled: true } } : {}),
      success_url: `${baseUrl}/api/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/#work`
    });
    response.status(200).json({ url: session.url });
  } catch (error) {
    errorResponse(response, error, "Stripe could not create a Checkout session.");
  }
}