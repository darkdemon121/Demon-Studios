import { errorResponse, requireMethod, setCors } from "../../lib/stripe.js";
import { getSignalForgeStripe, resolveSignalForgeEntitlement } from "../../lib/signalforge-billing.js";
import { signalForgeUsageStore } from "../../lib/signalforge-usage-store.js";

export default async function handler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "POST")) return;
  const count = request.body?.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 25) {
    return response.status(400).json({ error: "count must be an integer from 1 to 25." });
  }
  try {
    const entitlement = await resolveSignalForgeEntitlement(getSignalForgeStripe(), request.body?.session_id);
    if (!entitlement.paid) return response.status(402).json({ error: "An active SignalForge subscription is required." });
    const used = await signalForgeUsageStore.consume(entitlement.customerId, entitlement.periodStart, count, entitlement.monthlyLimit);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ paid: true, plan: entitlement.plan, used, limit: entitlement.monthlyLimit, remaining: entitlement.monthlyLimit - used });
  } catch (error) {
    errorResponse(response, error, "Could not authorize SignalForge usage.");
  }
}