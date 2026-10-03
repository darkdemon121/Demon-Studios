import { socialStore } from "./social-store.js";

const X_POST_LIMIT = 280;
const LINKEDIN_POST_LIMIT = 3000;

function socialError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertPublicHttpsUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw socialError("Instagram publishing needs a valid public image URL."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") || host === "localhost" || host.endsWith(".local") || /^\d+(\.\d+){3}$/.test(host) || host.includes(":")) {
    throw socialError("Instagram media must be hosted at a public HTTPS URL.");
  }
  return url.toString();
}

async function refreshConnectionIfNeeded(connection, provider, store, fetchImpl) {
  if (!connection.expires_at || connection.expires_at > Date.now() + 5 * 60_000) return connection;
  let response;
  if (provider === "x" && connection.refresh_token && process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET) {
    response = await fetchImpl("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
        client_id: process.env.X_CLIENT_ID
      }),
      signal: AbortSignal.timeout(15000)
    });
  } else if (provider === "linkedin" && connection.refresh_token && process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    response = await fetchImpl("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
      }),
      signal: AbortSignal.timeout(15000)
    });
  } else if (provider === "instagram" && connection.expires_at > Date.now() && connection.expires_at < Date.now() + 7 * 24 * 60 * 60_000) {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.search = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: connection.access_token });
    response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
  } else {
    throw socialError(`${provider} authorization expired. Reconnect the account.`, 401);
  }
  if (!response.ok) throw socialError(`${provider} authorization expired. Reconnect the account.`, 401);
  const refreshed = await response.json();
  if (!refreshed.access_token) throw socialError(`${provider} authorization expired. Reconnect the account.`, 401);
  const nextConnection = {
    ...connection,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || connection.refresh_token,
    expires_at: refreshed.expires_in ? Date.now() + Number(refreshed.expires_in) * 1000 : connection.expires_at
  };
  await store.saveConnection({
    installationId: connection.installation_id,
    provider,
    providerUserId: connection.provider_user_id,
    displayName: connection.display_name,
    accessToken: nextConnection.access_token,
    refreshToken: nextConnection.refresh_token,
    expiresAt: nextConnection.expires_at,
    scope: connection.scope
  });
  return nextConnection;
}

async function postX(connection, content, fetchImpl) {
  const parts = content.split(/\n\n↓\n\n/).map(part => part.replace(/\n\n\d+\/\d+$/, "").trim()).filter(Boolean);
  if (!parts.length) throw socialError("Add text before publishing to X.");
  if (parts.some(part => [...part].length > X_POST_LIMIT)) throw socialError("Each X post must fit within 280 characters.");
  let replyTo;
  let lastId;
  for (const text of parts) {
    const response = await fetchImpl("https://api.x.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${connection.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw socialError("X did not accept the post. Reconnect the account or review the draft.", response.status === 401 ? 401 : 502);
    const payload = await response.json();
    if (!payload.data?.id) throw socialError("X returned no post ID.", 502);
    replyTo = payload.data.id;
    lastId = payload.data.id;
  }
  return lastId;
}

async function postLinkedIn(connection, content, fetchImpl) {
  const commentary = content.trim();
  if (!commentary) throw socialError("Add text before publishing to LinkedIn.");
  if ([...commentary].length > LINKEDIN_POST_LIMIT) throw socialError("LinkedIn text posts must be 3,000 characters or fewer.");
  const version = process.env.LINKEDIN_VERSION || "202609";
  const response = await fetchImpl("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.access_token}`,
      "Content-Type": "application/json",
      "Linkedin-Version": version,
      "X-Restli-Protocol-Version": "2.0.0"
    },
    body: JSON.stringify({
      author: `urn:li:person:${connection.provider_user_id}`,
      commentary,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw socialError("LinkedIn did not accept the post. The app may need w_member_social approval or reconnection.", response.status === 401 ? 401 : 502);
  return response.headers.get("x-restli-id") || "published";
}

async function postInstagram(connection, content, mediaUrl, fetchImpl) {
  if (!mediaUrl) throw socialError("Instagram publishing needs a public image URL. Text-only drafts cannot be published via Instagram's API.", 422);
  const imageUrl = assertPublicHttpsUrl(mediaUrl);
  const version = process.env.INSTAGRAM_GRAPH_VERSION || "v25.0";
  const base = `https://graph.instagram.com/${version}/${encodeURIComponent(connection.provider_user_id)}`;
  const createResponse = await fetchImpl(`${base}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ image_url: imageUrl, caption: content.trim(), access_token: connection.access_token }),
    signal: AbortSignal.timeout(25000)
  });
  const container = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok || !container.id) throw socialError("Instagram could not prepare this image post. Confirm the account is professional and has publishing access.", 502);

  const publishResponse = await fetchImpl(`${base}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: container.id, access_token: connection.access_token }),
    signal: AbortSignal.timeout(25000)
  });
  const published = await publishResponse.json().catch(() => ({}));
  if (!publishResponse.ok || !published.id) throw socialError("Instagram could not publish the prepared image post.", 502);
  return published.id;
}

export function createSocialPublishService({ store = socialStore, fetchImpl = globalThis.fetch } = {}) {
  return async function publish({ installationId, provider, content, mediaUrl = null, jobId }) {
    if (!installationId || !provider || !content || !jobId) throw socialError("A scheduled post, platform, and job ID are required.");
    if (!["linkedin", "x", "instagram"].includes(provider)) throw socialError("Unsupported social platform.");
    let connection = await store.getConnection(installationId, provider);
    if (!connection) throw socialError(`${provider} is not connected to this VibeShift installation.`, 409);
    connection = await refreshConnectionIfNeeded(connection, provider, store, fetchImpl);

    const job = await store.startPublishJob({
      id: jobId,
      installationId,
      provider,
      content,
      scheduledAt: Date.now()
    });
    if (job.alreadyPublished) return { published: true, duplicate: true, post_id: job.resultId };

    try {
      const postId = provider === "x"
        ? await postX(connection, content, fetchImpl)
        : provider === "linkedin"
          ? await postLinkedIn(connection, content, fetchImpl)
          : await postInstagram(connection, content, mediaUrl, fetchImpl);
      await store.finishPublishJob(jobId, { status: "published", resultId: postId });
      return { published: true, duplicate: false, post_id: postId };
    } catch (error) {
      await store.finishPublishJob(jobId, { status: "failed", error: error.statusCode === 401 ? "reconnect_required" : "publish_failed" });
      throw error;
    }
  };
}