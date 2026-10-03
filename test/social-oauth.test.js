import assert from "node:assert/strict";
import test from "node:test";
import { createSocialOAuthService } from "../lib/social-oauth.js";
import { setCors } from "../lib/stripe.js";

const envKeys = [
  "PUBLIC_BASE_URL",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "INSTAGRAM_CLIENT_ID",
  "INSTAGRAM_CLIENT_SECRET"
];

function saveEnv() {
  return Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setProviderEnv() {
  process.env.PUBLIC_BASE_URL = "https://demonstudios.vercel.app";
  process.env.LINKEDIN_CLIENT_ID = "linkedin-client";
  process.env.LINKEDIN_CLIENT_SECRET = "linkedin-secret-test";
  process.env.X_CLIENT_ID = "x-client";
  process.env.X_CLIENT_SECRET = "x-secret-test";
  process.env.INSTAGRAM_CLIENT_ID = "instagram-client";
  process.env.INSTAGRAM_CLIENT_SECRET = "instagram-secret-test";
}

test("social API CORS preflight permits the installation header", () => {
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    end() { this.ended = true; }
  };
  const handled = setCors({ method: "OPTIONS", headers: { origin: "chrome-extension://vibeshift-test" } }, response);
  assert.equal(handled, true);
  assert.equal(response.statusCode, 204);
  assert.match(response.headers["Access-Control-Allow-Headers"], /X-VibeShift-Installation/);
});

test("social OAuth creates provider consent URLs and stores CSRF state", async () => {
  const previous = saveEnv();
  setProviderEnv();
  const states = [];
  const store = {
    async ensureInstallation(id) { return id; },
    async createOAuthState(state) { states.push(state); }
  };
  try {
    const service = createSocialOAuthService({ store });
    const linkedin = await service.start({ provider: "linkedin", installationId: "install-1234567890", installationSecret: "s".repeat(43) });
    const linkedinUrl = new URL(linkedin.authorizeUrl);
    assert.equal(linkedinUrl.origin, "https://www.linkedin.com");
    assert.equal(linkedinUrl.searchParams.get("redirect_uri"), "https://demonstudios.vercel.app/api/social/callback/linkedin");
    assert.ok(linkedinUrl.searchParams.get("scope").includes("w_member_social"));
    assert.ok(states[0].state);

    const x = await service.start({ provider: "x", installationId: "install-1234567890", installationSecret: "s".repeat(43) });
    const xUrl = new URL(x.authorizeUrl);
    assert.equal(xUrl.origin, "https://x.com");
    assert.equal(xUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(xUrl.searchParams.get("code_challenge"));
    assert.ok(states[1].codeVerifier);

    const instagram = await service.start({ provider: "instagram", installationId: "install-1234567890", installationSecret: "s".repeat(43) });
    const instagramUrl = new URL(instagram.authorizeUrl);
    assert.equal(instagramUrl.origin, "https://www.instagram.com");
    assert.ok(instagramUrl.searchParams.get("scope").includes("instagram_business_content_publish"));
    assert.equal(states.length, 3);
  } finally {
    restoreEnv(previous);
  }
});

test("social OAuth fails closed when provider app credentials are missing", async () => {
  const previous = saveEnv();
  process.env.PUBLIC_BASE_URL = "https://demonstudios.vercel.app";
  delete process.env.LINKEDIN_CLIENT_ID;
  delete process.env.LINKEDIN_CLIENT_SECRET;
  try {
    const service = createSocialOAuthService({ store: { async ensureInstallation(id) { return id; } } });
    await assert.rejects(
      service.start({ provider: "linkedin", installationId: "install-1234567890", installationSecret: "s".repeat(43) }),
      error => error.statusCode === 503 && /not configured/.test(error.message)
    );
  } finally {
    restoreEnv(previous);
  }
});

test("social OAuth callback rejects unknown state without exchanging the code", async () => {
  const previous = saveEnv();
  setProviderEnv();
  let providerCalled = false;
  const store = { async consumeOAuthState() { return null; } };
  const response = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    type() { return this; },
    send(body) { this.body = body; return this; }
  };
  try {
    await createSocialOAuthService({ store, fetchImpl: async () => { providerCalled = true; } })
      .complete("x", { query: { code: "attacker-code", state: "wrong-state" } }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(providerCalled, false);
    assert.doesNotMatch(response.body, /attacker-code/);
  } finally {
    restoreEnv(previous);
  }
});

test("LinkedIn OAuth callback exchanges the code and stores only provider token material", async () => {
  const previous = saveEnv();
  setProviderEnv();
  const saved = [];
  const store = {
    async consumeOAuthState(state, provider) {
      assert.equal(state, "valid-state");
      assert.equal(provider, "linkedin");
      return { installationId: "install-1234567890", provider };
    },
    async saveConnection(connection) { saved.push(connection); }
  };
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes("accessToken")) return { ok: true, json: async () => ({ access_token: "provider-token", expires_in: 3600, scope: "w_member_social" }) };
    return { ok: true, json: async () => ({ sub: "member-123", name: "Test Member" }) };
  };
  const response = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    type() { return this; },
    send(body) { this.body = body; return this; }
  };
  try {
    await createSocialOAuthService({ store, fetchImpl }).complete("linkedin", { query: { code: "auth-code", state: "valid-state" } }, response);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Connected/);
    assert.equal(saved[0].installationId, "install-1234567890");
    assert.equal(saved[0].providerUserId, "member-123");
    assert.equal(saved[0].accessToken, "provider-token");
    assert.equal(calls.length, 2);
    assert.doesNotMatch(response.body, /provider-token|auth-code/);
  } finally {
    restoreEnv(previous);
  }
});