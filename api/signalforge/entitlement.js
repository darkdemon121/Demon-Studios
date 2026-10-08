import { errorResponse, requireMethod, setCors } from "../../lib/stripe.js";
import { getSignalForgeStripe, resolveSignalForgeEntitlement } from "../../lib/signalforge-billing.js";
import { signalForgeUsageStore } from "../../lib/signalforge-usage-store.js";

export default async function handler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "GET")) return;
  try {
    const entitlement = await resolveSignalForgeEntitlement(getSignalForgeStripe(), request.query.session_id);
    if (!entitlement.paid) {
      response.setHeader("Cache-Control", "no-store");
      return response.status(200).json({ paid: false, plan: null });
    }
    const used = await signalForgeUsageStore.getUsage(entitlement.customerId, entitlement.periodStart);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({
      paid: true,
      plan: entitlement.plan,
      used,
      limit: entitlement.monthlyLimit,
      remaining: Math.max(0, entitlement.monthlyLimit - used),
      currentPeriodEnd: entitlement.periodEnd
    });
  } catch (error) {
    errorResponse(response, error, "Could not verify SignalForge subscription with Stripe.");
  }
}