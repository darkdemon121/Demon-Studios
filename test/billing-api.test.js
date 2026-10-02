import assert from "node:assert/strict";
import test from "node:test";
import health from "../api/health.js";
import checkout from "../api/checkout.js";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { this.ended = true; return this; }
  };
}

test("health reports missing Stripe settings without exposing secrets", () => {
  const request = { method: "GET", headers: {} };
  const response = mockResponse();
  health(request, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    billingEnabled: false,
    billingConfigured: false,
    pricesConfigured: false,
    webhookConfigured: false,
    aiConfigured: false,
    alphaAiConfigured: false
  });
});

test("Checkout stays disabled until the owner explicitly enables billing", async () => {
  const previousEnabled = process.env.STRIPE_BILLING_ENABLED;
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_BILLING_ENABLED = "false";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_configured";
  try {
    const response = mockResponse();
    await checkout({ method: "POST", headers: {}, body: { plan: "monthly" } }, response);
    assert.equal(response.statusCode, 503);
    assert.match(response.body.error, /account and payout setup/);
  } finally {
    if (previousEnabled === undefined) delete process.env.STRIPE_BILLING_ENABLED;
    else process.env.STRIPE_BILLING_ENABLED = previousEnabled;
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
});

test("Checkout stays disabled until a webhook signing secret is configured", async () => {
  const previousEnabled = process.env.STRIPE_BILLING_ENABLED;
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_BILLING_ENABLED = "true";
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const request = { method: "POST", headers: {}, body: { plan: "monthly" } };
    const response = mockResponse();
    await checkout(request, response);
    assert.equal(response.statusCode, 503);
    assert.match(response.body.error, /webhook is configured/);
  } finally {
    if (previousEnabled === undefined) delete process.env.STRIPE_BILLING_ENABLED;
    else process.env.STRIPE_BILLING_ENABLED = previousEnabled;
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
});