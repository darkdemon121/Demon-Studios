import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/social/[...path].js";
import { socialStore } from "../lib/social-store.js";

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

test("social catch-all supports extension CORS preflight", async () => {
  const response = mockResponse();
  await handler({ method: "OPTIONS", url: "/api/social/status", headers: { origin: "chrome-extension://vibeshift-test" } }, response);
  assert.equal(response.statusCode, 204);
  assert.match(response.headers["Access-Control-Allow-Headers"], /X-VibeShift-Installation/);
});

test("social connect route enforces POST", async () => {
  const response = mockResponse();
  await handler({ method: "GET", url: "/api/social/connect", headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.body.error, "Method not allowed.");
});

test("unknown social route returns 404", async () => {
  const response = mockResponse();
  await handler({ method: "GET", url: "/api/social/not-a-route", headers: {} }, response);
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "Social API route not found.");
});

test("social catch-all supports localhost development preflight", async () => {
  const response = mockResponse();
  await handler({ method: "OPTIONS", url: "/api/social/status", headers: { origin: "http://127.0.0.1:4310" } }, response);
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:4310");
});

test("social status registers a new installation before listing accounts", async () => {
  const originalEnsureInstallation = socialStore.ensureInstallation;
  const originalListConnections = socialStore.listConnections;
  let registered;
  socialStore.ensureInstallation = async (installationId, installationSecret) => {
    registered = { installationId, installationSecret };
    return installationId;
  };
  socialStore.listConnections = async () => [];
  try {
    const response = mockResponse();
    await handler({
      method: "GET",
      url: "/api/social/status?installation_id=abcdefghijklmnop",
      headers: {
        authorization: `Bearer ${"s".repeat(32)}`,
        "x-vibeshift-installation": "abcdefghijklmnop"
      }
    }, response);
    assert.deepEqual(registered, { installationId: "abcdefghijklmnop", installationSecret: "s".repeat(32) });
    assert.deepEqual(response.body, { accounts: [] });
  } finally {
    socialStore.ensureInstallation = originalEnsureInstallation;
    socialStore.listConnections = originalListConnections;
  }
});