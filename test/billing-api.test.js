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
    alphaAiConfigured: false,
    socialStorageConfigured: false,
    socialProvidersConfigured: { linkedin: false, x: false, instagram: false }
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

test("health reports social setup booleans without exposing provider configuration", () => {
  const previous = {
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    SOCIAL_TOKEN_ENCRYPTION_KEY: process.env.SOCIAL_TOKEN_ENCRYPTION_KEY,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET
  };
  process.env.TURSO_DATABASE_URL = "libsql://test.turso.io";
  process.env.TURSO_AUTH_TOKEN = "turso-secret-test";
  process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.LINKEDIN_CLIENT_ID = "linkedin-client-test";
  process.env.LINKEDIN_CLIENT_SECRET = "linkedin-secret-test";
  try {
    const response = mockResponse();
    health({ method: "GET", headers: {} }, response);
    assert.equal(response.body.socialStorageConfigured, true);
    assert.equal(response.body.socialProvidersConfigured.linkedin, true);
    assert.equal(response.body.socialProvidersConfigured.x, false);
    assert.equal(JSON.stringify(response.body).includes("linkedin-secret-test"), false);
    assert.equal(JSON.stringify(response.body).includes("turso-secret-test"), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});