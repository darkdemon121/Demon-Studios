import assert from "node:assert/strict";
import test from "node:test";
import { recordSignalForgeWebhookEvent, resolveSignalForgeEntitlement, SIGNALFORGE_PLANS } from "../lib/signalforge-billing.js";
import { createSignalForgeUsageStore } from "../lib/signalforge-usage-store.js";
import { createSignalForgeCheckoutHandler } from "../api/signalforge/checkout.js";
import { createSignalForgePortalHandler } from "../api/signalforge/portal.js";

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { this.ended = true; return this; }
  };
}

function fakeStripe({ plan = "starter", status = "active", paymentStatus = "paid" } = {}) {
  const priceId = plan === "starter" ? "price_signalforge_starter" : "price_signalforge_studio";
  return {
    checkout: { sessions: { retrieve: async () => ({
      mode: "subscription",
      customer: "cus_signalforge_1",
      payment_status: paymentStatus,
      subscription: {
        status,
        current_period_start: 1_800_000_000,
        current_period_end: 1_802_592_000,
        items: { data: [{ price: { id: priceId } }] }
      }
    }) } },
    subscriptions: { retrieve: async subscription => subscription }
  };
}

test("SignalForge recognizes its own Starter subscription and limits", async () => {
  const entitlement = await resolveSignalForgeEntitlement(fakeStripe(), "cs_live_abc123", {
    SIGNALFORGE_PRICE_STARTER: "price_signalforge_starter",
    SIGNALFORGE_PRICE_STUDIO: "price_signalforge_studio"
  });

  assert.deepEqual(entitlement, {
    paid: true,
    plan: "starter",
    customerId: "cus_signalforge_1",
    periodStart: 1_800_000_000,
    periodEnd: 1_802_592_000,
    monthlyLimit: SIGNALFORGE_PLANS.starter.monthlyLimit,
    apiKeyLimit: 1
  });
});

test("SignalForge recognizes Studio independently from Starter", async () => {
  const entitlement = await resolveSignalForgeEntitlement(fakeStripe({ plan: "studio" }), "cs_live_abc123", {
    SIGNALFORGE_PRICE_STARTER: "price_signalforge_starter",
    SIGNALFORGE_PRICE_STUDIO: "price_signalforge_studio"
  });

  assert.equal(entitlement.plan, "studio");
  assert.equal(entitlement.monthlyLimit, 20_000);
  assert.equal(entitlement.apiKeyLimit, 5);
});

test("VibeShift or unrelated price IDs never grant SignalForge entitlement", async () => {
  const entitlement = await resolveSignalForgeEntitlement(fakeStripe(), "cs_live_abc123", {
    SIGNALFORGE_PRICE_STARTER: "price_vibeshift_unlimited",
    SIGNALFORGE_PRICE_STUDIO: "price_signalforge_studio"
  });

  assert.deepEqual(entitlement, { paid: false, plan: null });
});

test("inactive subscriptions cannot use SignalForge", async () => {
  const entitlement = await resolveSignalForgeEntitlement(fakeStripe({ status: "canceled" }), "cs_live_abc123", {
    SIGNALFORGE_PRICE_STARTER: "price_signalforge_starter"
  });

  assert.deepEqual(entitlement, { paid: false, plan: null });
});

test("SignalForge usage storage atomically enforces the monthly limit", async () => {
  const rows = new Map();
  const store = createSignalForgeUsageStore({
    url: "file:test.db",
    authToken: "test-token",
    connectFactory: () => ({
      batch: async () => [],
      prepare: sql => ({
        run: async params => {
          if (sql.startsWith("INSERT INTO signalforge_usage")) {
            const key = `${params[0]}:${params[1]}`;
            if (!rows.has(key)) rows.set(key, 0);
            return { rowsAffected: 1 };
          }
          if (sql.startsWith("UPDATE signalforge_usage")) {
            const [count, , customerId, periodStart, conditionCount, limit] = params;
            const key = `${customerId}:${periodStart}`;
            const used = rows.get(key) || 0;
            if (used + conditionCount > limit) return { rowsAffected: 0 };
            rows.set(key, used + count);
            return { rowsAffected: 1 };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        get: async ([customerId, periodStart]) => ({ used: rows.get(`${customerId}:${periodStart}`) || 0 })
      })
    })
  });

  assert.equal(await store.consume("cus_1", 123, 2, 3), 2);
  await assert.rejects(store.consume("cus_1", 123, 2, 3), error => error.statusCode === 429);
  assert.equal(await store.getUsage("cus_1", 123), 2);
});

test("SignalForge checkout remains disabled until its own flag is enabled", async () => {
  const handler = createSignalForgeCheckoutHandler({ env: () => ({ SIGNALFORGE_BILLING_ENABLED: "false" }) });
  const response = responseMock();
  await handler({ method: "POST", headers: {}, body: { plan: "starter" } }, response);
  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /SignalForge checkout is not enabled/);
});

test("SignalForge Starter checkout uses only the configured SignalForge price", async () => {
  let checkoutParameters;
  const env = {
    SIGNALFORGE_BILLING_ENABLED: "true",
    STRIPE_WEBHOOK_SECRET: "whsec_vibeshift_existing",
    SIGNALFORGE_PRICE_STARTER: "price_signalforge_starter_live",
    PUBLIC_BASE_URL: "https://www.demon-studios.com"
  };
  const handler = createSignalForgeCheckoutHandler({
    env: () => env,
    getStripeClient: () => ({ checkout: { sessions: { create: async parameters => {
      checkoutParameters = parameters;
      return { url: "https://checkout.stripe.test/signalforge" };
    } } } })
  });
  const response = responseMock();
  await handler({ method: "POST", headers: {}, body: { plan: "starter" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.url, "https://checkout.stripe.test/signalforge");
  assert.equal(checkoutParameters.mode, "subscription");
  assert.deepEqual(checkoutParameters.line_items, [{ price: "price_signalforge_starter_live", quantity: 1 }]);
  assert.deepEqual(checkoutParameters.metadata, { product: "signalforge", plan: "starter" });
  assert.match(checkoutParameters.integration_identifier, /^signalforge_[a-z]{8}$/);
  assert.match(checkoutParameters.success_url, /signalforge-checkout/);
});

test("SignalForge checkout does not accept VibeShift plan names", async () => {
  const env = { SIGNALFORGE_BILLING_ENABLED: "true", STRIPE_WEBHOOK_SECRET: "whsec_test" };
  const handler = createSignalForgeCheckoutHandler({ env: () => env, getStripeClient: () => { throw new Error("must not call Stripe"); } });
  const response = responseMock();
  await handler({ method: "POST", headers: {}, body: { plan: "lifetime" } }, response);
  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /SignalForge price is not configured/);
});

test("SignalForge portal requires an active SignalForge subscription", async () => {
  const env = { SIGNALFORGE_PRICE_STARTER: "price_signalforge_starter" };
  const stripe = fakeStripe({ status: "canceled" });
  stripe.billingPortal = { sessions: { create: async () => { throw new Error("must not create portal"); } } };
  const handler = createSignalForgePortalHandler({ env: () => env, getStripeClient: () => stripe });
  const response = responseMock();
  await handler({ method: "POST", headers: {}, body: { session_id: "cs_live_abc123" }, query: {} }, response);
  assert.equal(response.statusCode, 403);
});

test("SignalForge portal creates a customer portal for the SignalForge customer", async () => {
  const env = { SIGNALFORGE_PRICE_STARTER: "price_signalforge_starter", PUBLIC_BASE_URL: "https://www.demon-studios.com" };
  let portalParameters;
  const stripe = fakeStripe();
  stripe.billingPortal = { sessions: { create: async parameters => { portalParameters = parameters; return { url: "https://billing.stripe.test/portal" }; } } };
  const handler = createSignalForgePortalHandler({ env: () => env, getStripeClient: () => stripe });
  const response = responseMock();
  await handler({ method: "POST", headers: {}, body: { session_id: "cs_live_abc123" }, query: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(portalParameters.customer, "cus_signalforge_1");
  assert.equal(portalParameters.return_url, "https://www.demon-studios.com");
});

test("SignalForge webhook dispatcher ignores VibeShift events and records its own events", async () => {
  const recorded = [];
  const usageStore = { recordWebhookEvent: async (...args) => { recorded.push(args); return recorded.length === 1; } };
  const vibeEvent = { id: "evt_vibe", type: "checkout.session.completed", data: { object: { metadata: { product: "vibeshift" } } } };
  const signalForgeEvent = { id: "evt_sf", type: "customer.subscription.updated", data: { object: { metadata: { product: "signalforge" } } } };
  assert.equal(await recordSignalForgeWebhookEvent(vibeEvent, usageStore), false);
  assert.equal(await recordSignalForgeWebhookEvent(signalForgeEvent, usageStore), true);
  assert.equal(await recordSignalForgeWebhookEvent(signalForgeEvent, usageStore), false);
  assert.deepEqual(recorded, [["evt_sf", "customer.subscription.updated"], ["evt_sf", "customer.subscription.updated"]]);
});