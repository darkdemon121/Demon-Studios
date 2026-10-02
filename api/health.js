import { setCors, requireMethod } from "../lib/stripe.js";

export default function handler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "GET")) return;
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    ok: true,
    billingEnabled: process.env.STRIPE_BILLING_ENABLED === "true",
    billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    pricesConfigured: Boolean(process.env.STRIPE_PRICE_MONTHLY && process.env.STRIPE_PRICE_LIFETIME),
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    alphaAiConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.VIBESHIFT_ALPHA_AI_ENABLED === "true" && process.env.VIBESHIFT_ALPHA_TEST_TOKEN?.length >= 32)
  });
}