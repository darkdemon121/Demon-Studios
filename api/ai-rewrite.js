import { sessionEntitlement } from "./entitlement.js";
import { getStripe, requireMethod, setCors } from "../lib/stripe.js";
import { rewriteWithOpenAI } from "../lib/openai.js";

const SESSION_PATTERN = /^cs_(test|live)_[A-Za-z0-9_]+$/;
const MAX_SOURCE_LENGTH = 8000;
const MAX_REQUESTS_PER_HOUR = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateLimits = new Map();
const validTones = new Set(["balanced", "warm", "confident", "conversational", "thoughtful"]);
const validGoals = new Set(["engage", "educate", "promote"]);

function takeRateLimit(key, now = Date.now()) {
  let entry = rateLimits.get(key);
  if (!entry || now - entry.startedAt >= RATE_WINDOW_MS) {
    entry = { startedAt: now, count: 0 };
    rateLimits.set(key, entry);
  }
  if (entry.count >= MAX_REQUESTS_PER_HOUR) return false;
  entry.count += 1;
  if (rateLimits.size > 5000) {
    for (const [existingKey, value] of rateLimits) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateLimits.delete(existingKey);
    }
  }
  return true;
}

function allowedOrigin(origin) {
  return !origin || origin.startsWith("chrome-extension://") || origin === process.env.PUBLIC_BASE_URL;
}

export function createAiRewriteHandler({ stripeFactory = getStripe, fetchImpl = globalThis.fetch } = {}) {
  return async function handler(request, response) {
    if (setCors(request, response)) return;
    if (!requireMethod(request, response, "POST")) return;
    if (!allowedOrigin(request.headers.origin)) return response.status(403).json({ error: "Origin is not allowed." });
    response.setHeader("Cache-Control", "no-store");

    const { source, audience = "", tone = "balanced", goal = "engage", task = "rewrite", session_id: sessionId } = request.body || {};
    if (typeof source !== "string" || !source.trim() || source.length > MAX_SOURCE_LENGTH) {
      return response.status(400).json({ error: `Source text must be between 1 and ${MAX_SOURCE_LENGTH} characters.` });
    }
    if (typeof audience !== "string" || audience.length > 80 || !validTones.has(tone) || !validGoals.has(goal) || !["rewrite", "draft"].includes(task)) {
      return response.status(400).json({ error: "The selected brand voice settings are invalid." });
    }

    const testBypass = process.env.AI_ALLOW_UNPAID === "true"
      && process.env.VERCEL_ENV !== "production";
    if (!testBypass) {
      if (typeof sessionId !== "string" || !SESSION_PATTERN.test(sessionId)) {
        return response.status(401).json({ error: "AI Rewrite requires an active VibeShift plan." });
      }
      try {
        const entitlement = await sessionEntitlement(stripeFactory(), sessionId);
        if (!entitlement.paid) return response.status(403).json({ error: "AI Rewrite requires an active VibeShift plan." });
      } catch {
        return response.status(503).json({ error: "Could not verify your VibeShift plan. Try again shortly." });
      }
    }

    const rateKey = testBypass ? `test:${request.headers["x-forwarded-for"] || "local"}` : sessionId;
    if (!takeRateLimit(rateKey)) return response.status(429).json({ error: "AI Rewrite rate limit reached. Try again later." });
    if (!process.env.OPENAI_API_KEY) return response.status(503).json({ error: "AI Rewrite is not configured on the server yet." });

    try {
      const text = await rewriteWithOpenAI({ source, audience, tone, goal, task, fetchImpl });
      return response.status(200).json({ text });
    } catch {
      return response.status(502).json({ error: "AI Rewrite is temporarily unavailable. Try again shortly." });
    }
  };
}

export default createAiRewriteHandler();