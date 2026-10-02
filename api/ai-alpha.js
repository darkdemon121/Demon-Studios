import { createHash, timingSafeEqual } from "node:crypto";
import { rewriteWithOpenAI } from "../lib/openai.js";
import { requireMethod, setCors } from "../lib/stripe.js";

const MAX_SOURCE_LENGTH = 8000;
const MAX_REQUESTS_PER_DAY = 5;
const validTones = new Set(["balanced", "warm", "confident", "conversational", "thoughtful"]);
const validGoals = new Set(["engage", "educate", "promote"]);
const dailyUsage = new Map();

function allowedOrigin(origin) {
  return !origin || origin.startsWith("chrome-extension://") || origin === process.env.PUBLIC_BASE_URL;
}

function matchesTesterCode(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function consumeDailyUsage(testerCode, today = new Date().toISOString().slice(0, 10)) {
  const testerId = createHash("sha256").update(testerCode).digest("hex");
  const usage = dailyUsage.get(testerId);
  if (usage?.day === today && usage.count >= MAX_REQUESTS_PER_DAY) return false;
  dailyUsage.set(testerId, { day: today, count: usage?.day === today ? usage.count + 1 : 1 });
  if (dailyUsage.size > 5000) {
    for (const [id, entry] of dailyUsage) {
      if (entry.day !== today) dailyUsage.delete(id);
    }
  }
  return true;
}

export function createAlphaAiHandler({ fetchImpl = globalThis.fetch } = {}) {
  return async function handler(request, response) {
    if (setCors(request, response)) return;
    if (!requireMethod(request, response, "POST")) return;
    if (!allowedOrigin(request.headers.origin)) return response.status(403).json({ error: "Origin is not allowed." });
    response.setHeader("Cache-Control", "no-store");

    const expectedCode = process.env.VIBESHIFT_ALPHA_TEST_TOKEN;
    if (process.env.VIBESHIFT_ALPHA_AI_ENABLED !== "true" || !process.env.OPENAI_API_KEY || !expectedCode || expectedCode.length < 32) {
      return response.status(503).json({ error: "Alpha AI is not configured on the server yet." });
    }
    const providedCode = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!matchesTesterCode(providedCode, expectedCode)) {
      return response.status(401).json({ error: "Enter a valid Alpha tester access code." });
    }

    const { source, audience = "", tone = "balanced", goal = "engage" } = request.body || {};
    if (typeof source !== "string" || !source.trim() || source.length > MAX_SOURCE_LENGTH) {
      return response.status(400).json({ error: `Source text must be between 1 and ${MAX_SOURCE_LENGTH} characters.` });
    }
    if (typeof audience !== "string" || audience.length > 80 || !validTones.has(tone) || !validGoals.has(goal)) {
      return response.status(400).json({ error: "The selected brand voice settings are invalid." });
    }
    if (!consumeDailyUsage(providedCode)) return response.status(429).json({ error: "Today's five Alpha AI rewrites have been used." });

    try {
      const text = await rewriteWithOpenAI({ source, audience, tone, goal, fetchImpl });
      return response.status(200).json({ text });
    } catch {
      return response.status(502).json({ error: "Alpha AI is temporarily unavailable. Try again shortly." });
    }
  };
}

export default createAlphaAiHandler();