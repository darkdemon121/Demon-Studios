import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/social/[...path].js";

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