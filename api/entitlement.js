import { errorResponse, getStripe, requireMethod, setCors } from "../lib/stripe.js";

const sessionPattern = /^cs_(test|live)_[A-Za-z0-9_]+$/;

async function paymentIsReversed(stripe, paymentIntent) {
  const intent = typeof paymentIntent === "string"
    ? await stripe.paymentIntents.retrieve(paymentIntent, { expand: ["latest_charge"] })
    : paymentIntent;
  const charge = typeof intent?.latest_charge === "string"
    ? await stripe.charges.retrieve(intent.latest_charge)
    : intent?.latest_charge;
  if (!charge) return false;
  if (charge.refunded || charge.amount_refunded >= charge.amount) return true;
  if (!charge.disputed) return false;
  const disputes = await stripe.disputes.list({ charge: charge.id, limit: 100 });
  return disputes.data.some(dispute => dispute.status !== "won");
}

export default async function handler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "GET")) return;
  const sessionId = request.query.session_id;
  if (typeof sessionId !== "string" || !sessionPattern.test(sessionId)) {
    return response.status(400).json({ error: "A valid Stripe Checkout session ID is required." });
  }
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent.latest_charge", "subscription"]
    });
    if (session.mode === "payment") {
      const paid = session.payment_status === "paid" && !(await paymentIsReversed(stripe, session.payment_intent));
      return response.status(200).json({ paid, plan: paid ? "lifetime" : null });
    }
    const subscription = typeof session.subscription === "string"
      ? await stripe.subscriptions.retrieve(session.subscription)
      : session.subscription;
    const paid = session.payment_status === "paid" && ["active", "trialing"].includes(subscription?.status);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ paid, plan: paid ? "subscription" : null });
  } catch (error) {
    errorResponse(response, error, "Could not verify the completed purchase with Stripe.");
  }
}