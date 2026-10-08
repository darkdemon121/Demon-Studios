import { errorResponse, requireMethod, setCors } from "../../lib/stripe.js";
import { getSignalForgeStripe, resolveSignalForgeEntitlement } from "../../lib/signalforge-billing.js";

export function createSignalForgePortalHandler({ getStripeClient = getSignalForgeStripe, env = () => process.env } = {}) {
  return async function signalForgePortalHandler(request, response) {
    if (setCors(request, response)) return;
    if (!requireMethod(request, response, "POST")) return;
    try {
      const sessionId = request.body?.session_id;
      const stripe = getStripeClient();
      const entitlement = await resolveSignalForgeEntitlement(stripe, sessionId, env());
      if (!entitlement.paid) return response.status(403).json({ error: "An active SignalForge subscription is required." });
      const baseUrl = env().PUBLIC_BASE_URL || "https://www.demon-studios.com";
      const portal = await stripe.billingPortal.sessions.create({ customer: entitlement.customerId, return_url: baseUrl });
      response.status(200).json({ url: portal.url });
    } catch (error) {
      errorResponse(response, error, "Could not open SignalForge subscription management.");
    }
  };
}

export default createSignalForgePortalHandler();