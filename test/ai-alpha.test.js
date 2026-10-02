import assert from "node:assert/strict";
import test from "node:test";
import { createAlphaAiHandler } from "../api/ai-alpha.js";

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

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const baseRequest = {
  method: "POST",
  headers: {},
  body: { source: "A useful idea.", audience: "independent creators", tone: "warm", goal: "engage" }
};

test("Alpha AI CORS preflight allows the tester Authorization header", async () => {
  const handler = createAlphaAiHandler();
  const response = mockResponse();
  await handler({ method: "OPTIONS", headers: { origin: "chrome-extension://alpha-test" } }, response);
  assert.equal(response.statusCode, 204);
  assert.match(response.headers["Access-Control-Allow-Headers"], /Authorization/);
});

test("Alpha AI rejects missing tester code without calling OpenAI", async () => {
  const previous = {
    VIBESHIFT_ALPHA_AI_ENABLED: process.env.VIBESHIFT_ALPHA_AI_ENABLED,
    VIBESHIFT_ALPHA_TEST_TOKEN: process.env.VIBESHIFT_ALPHA_TEST_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY
  };
  process.env.VIBESHIFT_ALPHA_AI_ENABLED = "true";
  process.env.VIBESHIFT_ALPHA_TEST_TOKEN = "a".repeat(64);
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const handler = createAlphaAiHandler({ fetchImpl: async () => { throw new Error("must not call provider"); } });
    const response = mockResponse();
    await handler(baseRequest, response);
    assert.equal(response.statusCode, 401);
    assert.match(response.body.error, /tester access code/);
  } finally {
    restoreEnv(previous);
  }
});

test("Alpha AI accepts a valid tester code and returns the rewrite", async () => {
  const previous = {
    VIBESHIFT_ALPHA_AI_ENABLED: process.env.VIBESHIFT_ALPHA_AI_ENABLED,
    VIBESHIFT_ALPHA_TEST_TOKEN: process.env.VIBESHIFT_ALPHA_TEST_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY
  };
  const testerCode = "b".repeat(64);
  process.env.VIBESHIFT_ALPHA_AI_ENABLED = "true";
  process.env.VIBESHIFT_ALPHA_TEST_TOKEN = testerCode;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const handler = createAlphaAiHandler({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ output: [{ content: [{ type: "output_text", text: "A clearer Alpha draft." }] }] })
      })
    });
    const response = mockResponse();
    await handler({
      ...baseRequest,
      headers: { authorization: `Bearer ${testerCode}` }
    }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { text: "A clearer Alpha draft." });
  } finally {
    restoreEnv(previous);
  }
});

test("Alpha AI enforces five requests per tester code per day", async () => {
  const previous = {
    VIBESHIFT_ALPHA_AI_ENABLED: process.env.VIBESHIFT_ALPHA_AI_ENABLED,
    VIBESHIFT_ALPHA_TEST_TOKEN: process.env.VIBESHIFT_ALPHA_TEST_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY
  };
  const testerCode = "c".repeat(64);
  process.env.VIBESHIFT_ALPHA_AI_ENABLED = "true";
  process.env.VIBESHIFT_ALPHA_TEST_TOKEN = testerCode;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const handler = createAlphaAiHandler({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ output: [{ content: [{ type: "output_text", text: "Daily test rewrite." }] }] })
      })
    });
    for (let count = 0; count < 5; count += 1) {
      const response = mockResponse();
      await handler({ ...baseRequest, headers: { authorization: `Bearer ${testerCode}` } }, response);
      assert.equal(response.statusCode, 200);
    }
    const limitedResponse = mockResponse();
    await handler({ ...baseRequest, headers: { authorization: `Bearer ${testerCode}` } }, limitedResponse);
    assert.equal(limitedResponse.statusCode, 429);
  } finally {
    restoreEnv(previous);
  }
});