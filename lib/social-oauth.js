import { createHash, randomBytes } from "node:crypto";
import { socialStore } from "./social-store.js";

const providers = {
  linkedin: {
    label: "LinkedIn",
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    scopes: ["openid", "profile", "w_member_social"],
    redirectPath: "/api/social/callback/linkedin"
  },
  x: {
    label: "X",
    clientIdEnv: "X_CLIENT_ID",
    clientSecretEnv: "X_CLIENT_SECRET",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    redirectPath: "/api/social/callback/x",
    pkce: true
  },
  instagram: {
    label: "Instagram",
    clientIdEnv: "INSTAGRAM_CLIENT_ID",
    clientSecretEnv: "INSTAGRAM_CLIENT_SECRET",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    redirectPath: "/api/social/callback/instagram"
  }
};

function safeError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function baseUrl() {
  const value = process.env.PUBLIC_BASE_URL;
  if (!value) throw safeError("Social connections are not configured on the server.", 503);
  return value.replace(/\/$/, "");
}

function providerConfig(provider) {
  const config = providers[provider];
  if (!config) throw safeError("This social platform is not supported.");
  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];
  if (!clientId || !clientSecret) throw safeError(`${config.label} connection is not configured yet.`, 503);
  return { ...config, clientId, clientSecret, redirectUri: `${baseUrl()}${config.redirectPath}` };
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createSocialOAuthService({ store = socialStore, fetchImpl = globalThis.fetch } = {}) {
  async function start({ provider, installationId, installationSecret }) {
    await store.ensureInstallation(installationId, installationSecret);
    const config = providerConfig(provider);
    const state = randomToken();
    const codeVerifier = config.pkce ? randomToken(48) : null;
    await store.createOAuthState({ state, installationId, provider, codeVerifier });
    let authorizeUrl;
    if (provider === "linkedin") {
      const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        state,
        scope: config.scopes.join(" ")
      });
      authorizeUrl = url.toString();
    } else if (provider === "x") {
      const url = new URL("https://x.com/i/oauth2/authorize");
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: config.scopes.join(" "),
        state,
        code_challenge: pkceChallenge(codeVerifier),
        code_challenge_method: "S256"
      });
      authorizeUrl = url.toString();
    } else {
      const url = new URL("https://www.instagram.com/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: config.scopes.join(","),
        state
      });
      authorizeUrl = url.toString();
    }
    return { authorizeUrl };
  }

  async function exchangeCode(provider, config, code, transaction) {
    let tokenResponse;
    if (provider === "linkedin") {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri
      });
      tokenResponse = await fetchImpl("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15000)
      });
    } else if (provider === "x") {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        code_verifier: transaction.codeVerifier,
        client_id: config.clientId
      });
      tokenResponse = await fetchImpl("https://api.x.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`
        },
        body,
        signal: AbortSignal.timeout(15000)
      });
    } else {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
        code
      });
      tokenResponse = await fetchImpl("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15000)
      });
    }
    if (!tokenResponse.ok) throw safeError("The social platform could not complete authorization.", 502);
    let token = await tokenResponse.json();

    if (provider === "instagram" && token.access_token) {
      const longUrl = new URL("https://graph.instagram.com/access_token");
      longUrl.search = new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: config.clientSecret,
        access_token: token.access_token
      });
      const longResponse = await fetchImpl(longUrl, { signal: AbortSignal.timeout(15000) });
      if (!longResponse.ok) throw safeError("Instagram could not exchange this for a long-lived token.", 502);
      token = await longResponse.json();
    }

    if (!token.access_token) throw safeError("The social platform returned an invalid authorization response.", 502);
    return token;
  }

  async function fetchProfile(provider, accessToken) {
    let url;
    if (provider === "linkedin") url = "https://api.linkedin.com/v2/userinfo";
    else if (provider === "x") url = "https://api.x.com/2/users/me?user.fields=name,username";
    else url = "https://graph.instagram.com/me?fields=id,username";
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw safeError("The social account profile could not be read.", 502);
    const result = await response.json();
    const profile = provider === "x" ? result.data : result;
    const id = profile?.sub || profile?.id;
    const displayName = profile?.name || profile?.username || profile?.preferred_username || "Connected account";
    if (!id) throw safeError("The social platform did not return an account identifier.", 502);
    return { id: String(id), displayName: String(displayName).slice(0, 120) };
  }

  async function complete(provider, request, response) {
    response.setHeader("Cache-Control", "no-store");
    const { code, state, error } = request.query || {};
    if (error) return callbackPage(response, false, provider);
    if (typeof code !== "string" || typeof state !== "string") return callbackPage(response, false, provider);
    try {
      const transaction = await store.consumeOAuthState(state, provider);
      if (!transaction) return callbackPage(response, false, provider);
      const config = providerConfig(provider);
      const token = await exchangeCode(provider, config, code, transaction);
      const profile = await fetchProfile(provider, token.access_token);
      const scope = Array.isArray(token.scope) ? token.scope.join(" ") : (token.scope || "");
      await store.saveConnection({
        installationId: transaction.installationId,
        provider,
        providerUserId: profile.id,
        displayName: profile.displayName,
        accessToken: token.access_token,
        refreshToken: token.refresh_token || null,
        expiresAt: token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : null,
        scope
      });
      return callbackPage(response, true, provider, profile.displayName);
    } catch {
      return callbackPage(response, false, provider);
    }
  }

  return { start, complete };
}

function callbackPage(response, success, provider, displayName = "") {
  const label = providers[provider]?.label || "social platform";
  const message = success
    ? `${label} is connected${displayName ? ` as ${displayName}` : ""}. Return to VibeShift to finish setup.`
    : `Could not connect ${label}. Return to VibeShift and try again.`;
  const color = success ? "#164b38" : "#8d3e31";
  response.status(success ? 200 : 400).type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VibeShift connection</title><main style="max-width:520px;margin:12vh auto;padding:28px;font:16px Segoe UI,sans-serif;color:#18211d"><h1 style="color:${color}">${success ? "Connected" : "Connection not completed"}</h1><p>${message.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character])}</p></main></html>`);
}

export const socialProviders = Object.freeze(Object.keys(providers));