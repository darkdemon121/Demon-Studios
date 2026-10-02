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
    billingConfigured: false,
    pricesConfigured: false,
    webhookConfigured: false
  });
});

test("Checkout stays disabled until a webhook signing secret is configured", async () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const request = { method: "POST", headers: {}, body: { plan: "monthly" } };
    const response = mockResponse();
    await checkout(request, response);
    assert.equal(response.statusCode, 503);
    assert.match(response.body.error, /webhook is configured/);
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
});