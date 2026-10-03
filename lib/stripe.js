import Stripe from "stripe";
import { randomInt } from "node:crypto";

let stripeClient;

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error("Stripe is not configured on this deployment.");
    error.statusCode = 503;
    throw error;
  }
  stripeClient ||= new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-09-30.endive"
  });
  return stripeClient;
}

export function setCors(request, response) {
  const origin = request.headers.origin;
  if (!origin || origin === "null" || origin.startsWith("chrome-extension://") || origin === process.env.PUBLIC_BASE_URL) {
    response.setHeader("Access-Control-Allow-Origin", origin || "*");
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature, Authorization, X-VibeShift-Installation");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return true;
  }
  return false;
}

export function requireMethod(request, response, method) {
  if (request.method === method) return true;
  response.setHeader("Allow", method);
  response.status(405).json({ error: "Method not allowed." });
  return false;
}

export function errorResponse(response, error, fallback) {
  const status = error.statusCode || 502;
  response.status(status).json({ error: status === 503 ? error.message : fallback });
}

export function makeIntegrationIdentifier() {
  return `vibeshift_${Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join("")}`;
}
