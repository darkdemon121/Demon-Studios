import { errorResponse, requireMethod, setCors } from "../../lib/stripe.js";
import { getSignalForgeStripe, makeSignalForgeIntegrationIdentifier, SIGNALFORGE_PLANS } from "../../lib/signalforge-billing.js";

export function createSignalForgeCheckoutHandler({ getStripeClient = getSignalForgeStripe, env = () => process.env } = {}) {
  return async function signalForgeCheckoutHandler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "POST")) return;
  const config = env();
  if (config.SIGNALFORGE_BILLING_ENABLED !== "true") {
    return response.status(503).json({ error: "SignalForge checkout is not enabled yet." });
  }
  if (!(config.SIGNALFORGE_STRIPE_WEBHOOK_SECRET || config.STRIPE_WEBHOOK_SECRET)) {
    return response.status(503).json({ error: "SignalForge billing is paused until the Stripe webhook is configured." });
  }

  const { plan } = request.body || {};
  const planConfig = SIGNALFORGE_PLANS[plan];
  const price = planConfig && config[planConfig.priceEnv];
  if (!price || price.includes("replace_me")) {
    return response.status(503).json({ error: "The selected SignalForge price is not configured." });
  }

  const baseUrl = env().PUBLIC_BASE_URL || "https://www.demon-studios.com";
  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      billing_address_collection: "auto",
      integration_identifier: makeSignalForgeIntegrationIdentifier(),
      success_url: `${baseUrl}/signalforge-checkout.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/#work`,
      metadata: { product: "signalforge", plan },
      subscription_data: { metadata: { product: "signalforge", plan } }
    });
    response.status(200).json({ url: session.url });
  } catch (error) {
    errorResponse(response, error, "Stripe could not create a SignalForge Checkout session.");
  }
  };
}

export default createSignalForgeCheckoutHandler();