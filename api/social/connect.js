import { requireMethod, setCors } from "../../lib/stripe.js";
import { installationCredentials, sendSocialError } from "../../lib/social-http.js";
import { createSocialOAuthService, socialProviders } from "../../lib/social-oauth.js";
import { socialStore } from "../../lib/social-store.js";

const oauth = createSocialOAuthService();

export default async function handler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "POST")) return;
  response.setHeader("Cache-Control", "no-store");
  try {
    const { provider } = request.body || {};
    if (!socialProviders.includes(provider)) return response.status(400).json({ error: "Unsupported social platform." });
    const { installationId, installationSecret } = installationCredentials(request);
    const identity = await socialStore.ensureInstallation(installationId, installationSecret);
    response.json(await oauth.start({ provider, installationId: identity, installationSecret }));
  } catch (error) {
    sendSocialError(response, error, "Could not start social account connection.");
  }
}