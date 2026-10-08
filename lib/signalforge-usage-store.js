import { connect } from "@tursodatabase/serverless";

export function createSignalForgeUsageStore({ url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN, connectFactory = connect } = {}) {
  let client;
  let initialized;

  function db() {
    if (!url || !authToken) {
      const error = new Error("SignalForge billing storage is not configured.");
      error.statusCode = 503;
      throw error;
    }
    client ||= connectFactory({ url, authToken });
    return client;
  }

  async function ensureSchema() {
    if (initialized) return initialized;
    initialized = db().batch([
      "CREATE TABLE IF NOT EXISTS signalforge_usage (customer_id TEXT NOT NULL, period_start INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (customer_id, period_start))",
      "CREATE TABLE IF NOT EXISTS signalforge_webhook_events (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at INTEGER NOT NULL)"
    ]);
    try { await initialized; } catch (error) { initialized = undefined; throw error; }
  }

  async function getUsage(customerId, periodStart) {
    await ensureSchema();
    const statement = db().prepare("SELECT used FROM signalforge_usage WHERE customer_id = ? AND period_start = ?");
    const row = await statement.get([customerId, periodStart]);
    return Number(row?.used || 0);
  }

  async function consume(customerId, periodStart, count, monthlyLimit) {
    await ensureSchema();
    const insert = db().prepare("INSERT INTO signalforge_usage (customer_id, period_start, used, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(customer_id, period_start) DO NOTHING");
    await insert.run([customerId, periodStart, Date.now()]);
    const update = db().prepare("UPDATE signalforge_usage SET used = used + ?, updated_at = ? WHERE customer_id = ? AND period_start = ? AND used + ? <= ?");
    const result = await update.run([count, Date.now(), customerId, periodStart, count, monthlyLimit]);
    if (Number(result.rowsAffected || 0) !== 1) {
      const error = new Error("Monthly SignalForge render quota reached.");
      error.statusCode = 429;
      throw error;
    }
    return getUsage(customerId, periodStart);
  }

  async function recordWebhookEvent(eventId, eventType) {
    await ensureSchema();
    const statement = db().prepare("INSERT INTO signalforge_webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?) ON CONFLICT(event_id) DO NOTHING");
    const result = await statement.run([eventId, eventType, Date.now()]);
    return Number(result.rowsAffected || 0) === 1;
  }

  return { getUsage, consume, recordWebhookEvent };
}

export const signalForgeUsageStore = createSignalForgeUsageStore();