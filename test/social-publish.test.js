import assert from "node:assert/strict";
import test from "node:test";
import { createSocialPublishService } from "../lib/social-publish.js";

function makeStore({ connection, job = { alreadyPublished: false } } = {}) {
  const calls = [];
  return {
    calls,
    async getConnection() { calls.push("getConnection"); return connection || { access_token: "test-provider-token", provider_user_id: "123", expires_at: Date.now() + 60 * 60_000 }; },
    async startPublishJob(args) { calls.push(["start", args]); return job; },
    async finishPublishJob(id, result) { calls.push(["finish", id, result]); }
  };
}

test("LinkedIn text post uses the authenticated member and versioned Posts API", async () => {
  const store = makeStore();
  let request;
  const publish = createSocialPublishService({
    store,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, headers: { get: () => "urn:li:share:test-post" } };
    }
  });
  const result = await publish({ installationId: "install-1234567890", provider: "linkedin", content: "A useful LinkedIn post.", jobId: "job-1" });
  assert.equal(result.published, true);
  assert.equal(result.post_id, "urn:li:share:test-post");
  assert.equal(request.url, "https://api.linkedin.com/rest/posts");
  assert.equal(request.options.headers["Linkedin-Version"], "202609");
  assert.equal(JSON.parse(request.options.body).author, "urn:li:person:123");
});

test("X thread text creates sequential replies", async () => {
  const store = makeStore();
  const requests = [];
  const publish = createSocialPublishService({
    store,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return { ok: true, json: async () => ({ data: { id: `post-${requests.length}` } }) };
    }
  });
  const result = await publish({ installationId: "install-1234567890", provider: "x", content: "First post.\n\n1/2\n\n↓\n\nSecond post.\n\n2/2", jobId: "job-2" });
  assert.equal(result.post_id, "post-2");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].reply.in_reply_to_tweet_id, "post-1");
});

test("Instagram text-only scheduling refuses publication before provider calls", async () => {
  const store = makeStore({ connection: { access_token: "test-provider-token", provider_user_id: "123", expires_at: null } });
  let providerCalls = 0;
  const publish = createSocialPublishService({ store, fetchImpl: async () => { providerCalls += 1; } });
  await assert.rejects(
    publish({ installationId: "install-1234567890", provider: "instagram", content: "Caption only.", jobId: "job-3" }),
    error => error.statusCode === 422 && /public image URL/.test(error.message)
  );
  assert.equal(providerCalls, 0);
});

test("already-published job IDs never call the social provider again", async () => {
  const store = makeStore({ job: { alreadyPublished: true, resultId: "previous-post" } });
  let providerCalls = 0;
  const publish = createSocialPublishService({ store, fetchImpl: async () => { providerCalls += 1; } });
  const result = await publish({ installationId: "install-1234567890", provider: "x", content: "Do not duplicate.", jobId: "job-4" });
  assert.deepEqual(result, { published: true, duplicate: true, post_id: "previous-post" });
  assert.equal(providerCalls, 0);
});

test("an expiring X token is refreshed before publishing", async () => {
  const previous = { X_CLIENT_ID: process.env.X_CLIENT_ID, X_CLIENT_SECRET: process.env.X_CLIENT_SECRET };
  process.env.X_CLIENT_ID = "x-client";
  process.env.X_CLIENT_SECRET = "x-client-secret";
  const connection = {
    access_token: "old-token",
    refresh_token: "old-refresh",
    expires_at: Date.now() + 1000,
    provider_user_id: "123",
    display_name: "Test X",
    installation_id: "install-1234567890"
  };
  let persisted;
  const store = makeStore({ connection });
  store.saveConnection = async value => { persisted = value; };
  const requests = [];
  try {
    const publish = createSocialPublishService({
      store,
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        if (String(url).includes("oauth2/token")) {
          return { ok: true, json: async () => ({ access_token: "new-token", refresh_token: "new-refresh", expires_in: 3600 }) };
        }
        return { ok: true, json: async () => ({ data: { id: "posted-after-refresh" } }) };
      }
    });
    const result = await publish({ installationId: "install-1234567890", provider: "x", content: "Refresh first.", jobId: "job-refresh" });
    assert.equal(result.post_id, "posted-after-refresh");
    assert.equal(requests.length, 2);
    assert.equal(requests[1].options.headers.Authorization, "Bearer new-token");
    assert.equal(persisted.accessToken, "new-token");
  } finally {
    if (previous.X_CLIENT_ID === undefined) delete process.env.X_CLIENT_ID;
    else process.env.X_CLIENT_ID = previous.X_CLIENT_ID;
    if (previous.X_CLIENT_SECRET === undefined) delete process.env.X_CLIENT_SECRET;
    else process.env.X_CLIENT_SECRET = previous.X_CLIENT_SECRET;
  }
});