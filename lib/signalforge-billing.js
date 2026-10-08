import { randomInt } from "node:crypto";
import Stripe from "stripe";

const checkoutSessionPattern = /^cs_(test|live)_[A-Za-z0-9_]+$/;
let stripeClient;

export function getSignalForgeStripe() {
  const secretKey = process.env.SIGNALFORGE_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    const error = new Error("SignalForge Stripe is not configured.");
    error.statusCode = 503;
    throw error;
  }
  stripeClient ||= new Stripe(secretKey, { apiVersion: "2026-09-30.endive" });
  return stripeClient;
}

export const SIGNALFORGE_PLANS = Object.freeze({
  starter: Object.freeze({ priceEnv: "SIGNALFORGE_PRICE_STARTER", monthlyLimit: 2_000, apiKeyLimit: 1 }),
  studio: Object.freeze({ priceEnv: "SIGNALFORGE_PRICE_STUDIO", monthlyLimit: 20_000, apiKeyLimit: 5 })
});

export function makeSignalForgeIntegrationIdentifier() {
  return `signalforge_${Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join("")}`;
}

export function validateCheckoutSessionId(sessionId) {
  return typeof sessionId === "string" && checkoutSessionPattern.test(sessionId);
}

const signalForgeWebhookEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted"
]);

export async function recordSignalForgeWebhookEvent(event, usageStore) {
  if (event?.data?.object?.metadata?.product !== "signalforge" || !signalForgeWebhookEvents.has(event.type)) return false;
  return usageStore.recordWebhookEvent(event.id, event.type);
}

export async function resolveSignalForgeEntitlement(stripe, sessionId, env = process.env) {
  if (!validateCheckoutSessionId(sessionId)) {
    const error = new Error("A valid SignalForge Checkout session ID is required.");
    error.statusCode = 400;
    throw error;
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  const subscription = typeof session.subscription === "string"
    ? await stripe.subscriptions.retrieve(session.subscription, { expand: ["items.data.price"] })
    : session.subscription;
  if (session.mode !== "subscription" || !session.customer || !["paid", "no_payment_required"].includes(session.payment_status) || !["active", "trialing"].includes(subscription?.status)) {
    return { paid: false, plan: null };
  }

  const prices = subscription.items?.data?.map(item => typeof item.price === "string" ? item.price : item.price?.id) || [];
  const plan = Object.entries(SIGNALFORGE_PLANS).find(([key, config]) => env[config.priceEnv] && prices.includes(env[config.priceEnv]))?.[0];
  if (!plan) return { paid: false, plan: null };

  return {
    paid: true,
    plan,
    customerId: typeof session.customer === "string" ? session.customer : session.customer.id,
    periodStart: Number(subscription.current_period_start) || 0,
    periodEnd: Number(subscription.current_period_end) || 0,
    monthlyLimit: SIGNALFORGE_PLANS[plan].monthlyLimit,
    apiKeyLimit: SIGNALFORGE_PLANS[plan].apiKeyLimit
  };
}