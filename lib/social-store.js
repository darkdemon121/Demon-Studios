import { createHash, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";
import { connect } from "@tursodatabase/serverless";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
let database;
let schemaReady;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encryptionKey() {
  const key = Buffer.from(process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32) {
    const error = new Error("Social token encryption is not configured.");
    error.statusCode = 503;
    throw error;
  }
  return key;
}

export function encryptSocialSecret(value, key = encryptionKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString("base64url")).join(".");
}

export function decryptSocialSecret(value, key = encryptionKey()) {
  const [ivPart, tagPart, ciphertextPart] = value.split(".");
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error("Stored social credential has an invalid format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function createSocialStore({ url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN, connectFactory = connect } = {}) {
  let client;
  let initialized;

  function db() {
    if (!url || !authToken) {
      const error = new Error("Social account storage is not configured.");
      error.statusCode = 503;
      throw error;
    }
    client ||= connectFactory({ url, authToken });
    return client;
  }

  async function prepare(sql) {
    return db().prepare(sql);
  }

  async function ensureSchema() {
    if (initialized) return initialized;
    initialized = (async () => {
      const statements = [
        "CREATE TABLE IF NOT EXISTS social_installations (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS social_oauth_states (state_hash TEXT PRIMARY KEY, installation_id TEXT NOT NULL, provider TEXT NOT NULL, code_verifier TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS social_connections (installation_id TEXT NOT NULL, provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, display_name TEXT NOT NULL, access_token_enc TEXT NOT NULL, refresh_token_enc TEXT, expires_at INTEGER, scope TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (installation_id, provider))",
        "CREATE TABLE IF NOT EXISTS social_publish_jobs (id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, provider TEXT NOT NULL, content TEXT NOT NULL, scheduled_at INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, result_id TEXT, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
      ];
      await db().batch(statements);
    })();
    try { await initialized; } catch (error) { initialized = undefined; throw error; }
  }

  async function ensureInstallation(installationId, installationSecret) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(installationId || "") || !/^[A-Za-z0-9_-]{32,128}$/.test(installationSecret || "")) {
      const error = new Error("A valid VibeShift installation credential is required.");
      error.statusCode = 400;
      throw error;
    }
    await ensureSchema();
    const secretHash = sha256(installationSecret);
    const insert = await prepare("INSERT INTO social_installations (id, secret_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING");
    await insert.run([installationId, secretHash, Date.now()]);
    const select = await prepare("SELECT secret_hash FROM social_installations WHERE id = ?");
    const row = await select.get([installationId]);
    if (!row || !safeEqual(row.secret_hash, secretHash)) {
      const error = new Error("This VibeShift installation key is not valid.");
      error.statusCode = 401;
      throw error;
    }
    return installationId;
  }

  async function authenticateInstallation(installationId, installationSecret) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(installationId || "") || !/^[A-Za-z0-9_-]{32,128}$/.test(installationSecret || "")) {
      const error = new Error("A valid VibeShift installation credential is required.");
      error.statusCode = 401;
      throw error;
    }
    await ensureSchema();
    const query = await prepare("SELECT secret_hash FROM social_installations WHERE id = ?");
    const row = await query.get([installationId]);
    if (!row || !safeEqual(row.secret_hash, sha256(installationSecret))) {
      const error = new Error("This VibeShift installation key is not valid.");
      error.statusCode = 401;
      throw error;
    }
    return installationId;
  }

  async function createOAuthState({ state, installationId, provider, codeVerifier = null }) {
    await ensureSchema();
    const now = Date.now();
    const statement = await prepare("INSERT INTO social_oauth_states (state_hash, installation_id, provider, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)");
    await statement.run([
      sha256(state),
      installationId,
      provider,
      codeVerifier ? encryptSocialSecret(codeVerifier) : null,
      now,
      now + OAUTH_STATE_TTL_MS
    ]);
  }

  async function consumeOAuthState(state, provider) {
    await ensureSchema();
    const hash = sha256(state || "");
    const select = await prepare("SELECT * FROM social_oauth_states WHERE state_hash = ? AND provider = ?");
    const row = await select.get([hash, provider]);
    if (!row) return null;
    const remove = await prepare("DELETE FROM social_oauth_states WHERE state_hash = ?");
    await remove.run([hash]);
    if (row.expires_at < Date.now()) return null;
    return {
      installationId: row.installation_id,
      provider: row.provider,
      codeVerifier: row.code_verifier ? decryptSocialSecret(row.code_verifier) : null
    };
  }

  async function saveConnection({ installationId, provider, providerUserId, displayName, accessToken, refreshToken, expiresAt, scope }) {
    await ensureSchema();
    const now = Date.now();
    const statement = await prepare(`INSERT INTO social_connections
      (installation_id, provider, provider_user_id, display_name, access_token_enc, refresh_token_enc, expires_at, scope, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(installation_id, provider) DO UPDATE SET
      provider_user_id=excluded.provider_user_id,
      display_name=excluded.display_name,
      access_token_enc=excluded.access_token_enc,
      refresh_token_enc=excluded.refresh_token_enc,
      expires_at=excluded.expires_at,
      scope=excluded.scope,
      updated_at=excluded.updated_at`);
    await statement.run([
      installationId,
      provider,
      providerUserId,
      displayName,
      encryptSocialSecret(accessToken),
      refreshToken ? encryptSocialSecret(refreshToken) : null,
      expiresAt || null,
      scope || "",
      now,
      now
    ]);
  }

  async function listConnections(installationId) {
    await ensureSchema();
    const query = await prepare("SELECT provider, provider_user_id, display_name, expires_at, scope, created_at FROM social_connections WHERE installation_id = ?");
    const result = await query.all([installationId]);
    return result.rows || [];
  }

  async function getConnection(installationId, provider) {
    await ensureSchema();
    const query = await prepare("SELECT * FROM social_connections WHERE installation_id = ? AND provider = ?");
    const row = await query.get([installationId, provider]);
    if (!row) return null;
    return {
      ...row,
      access_token: decryptSocialSecret(row.access_token_enc),
      refresh_token: row.refresh_token_enc ? decryptSocialSecret(row.refresh_token_enc) : null
    };
  }

  async function deleteConnection(installationId, provider) {
    await ensureSchema();
    const query = await prepare("DELETE FROM social_connections WHERE installation_id = ? AND provider = ?");
    return query.run([installationId, provider]);
  }

  async function queuePublishJob({ id, installationId, provider, content, scheduledAt }) {
    await ensureSchema();
    const now = Date.now();
    const statement = await prepare("INSERT INTO social_publish_jobs (id, installation_id, provider, content, scheduled_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)");
    await statement.run([id, installationId, provider, content, scheduledAt, now, now]);
  }

  async function startPublishJob({ id, installationId, provider, content, scheduledAt }) {
    await ensureSchema();
    const now = Date.now();
    const find = await prepare("SELECT id, installation_id, provider, status, result_id, attempts FROM social_publish_jobs WHERE id = ?");
    const existing = await find.get([id]);
    if (existing) {
      if (existing.installation_id !== installationId || existing.provider !== provider) {
        const error = new Error("This publish job identifier is already in use.");
        error.statusCode = 409;
        throw error;
      }
      if (existing.status === "published") return { alreadyPublished: true, resultId: existing.result_id };
      if (existing.status === "publishing") {
        const error = new Error("This post is already being published.");
        error.statusCode = 409;
        throw error;
      }
      const retry = await prepare("UPDATE social_publish_jobs SET status = 'publishing', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE id = ?");
      await retry.run([now, id]);
      return { alreadyPublished: false };
    }
    const insert = await prepare("INSERT INTO social_publish_jobs (id, installation_id, provider, content, scheduled_at, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'publishing', 1, ?, ?)");
    try {
      await insert.run([id, installationId, provider, content, scheduledAt || now, now, now]);
      return { alreadyPublished: false };
    } catch {
      const raced = await find.get([id]);
      if (raced?.status === "published") return { alreadyPublished: true, resultId: raced.result_id };
      const error = new Error("This post is already being published.");
      error.statusCode = 409;
      throw error;
    }
  }

  async function finishPublishJob(id, { status, resultId = null, error = null }) {
    await ensureSchema();
    const statement = await prepare("UPDATE social_publish_jobs SET status = ?, result_id = ?, last_error = ?, updated_at = ? WHERE id = ?");
    await statement.run([status, resultId, error, Date.now(), id]);
  }

  return {
    ensureSchema,
    ensureInstallation,
    authenticateInstallation,
    createOAuthState,
    consumeOAuthState,
    saveConnection,
    listConnections,
    getConnection,
    deleteConnection,
    queuePublishJob,
    startPublishJob,
    finishPublishJob
  };
}

export const socialStore = createSocialStore();