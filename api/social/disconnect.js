import { requireMethod, setCors } from "../../lib/stripe.js";
import { installationCredentials, sendSocialError } from "../../lib/social-http.js";
import { socialStore } from "../../lib/social-store.js";
import { socialProviders } from "../../lib/social-oauth.js";

export default async function handler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "POST")) return;
  response.setHeader("Cache-Control", "no-store");
  try {
    const { provider } = request.body || {};
    if (!socialProviders.includes(provider)) return response.status(400).json({ error: "Unsupported social platform." });
    const { installationId, installationSecret } = installationCredentials(request);
    const id = await socialStore.authenticateInstallation(installationId, installationSecret);
    await socialStore.deleteConnection(id, provider);
    response.json({ disconnected: provider });
  } catch (error) {
    sendSocialError(response, error, "Could not disconnect this account.");
  }
}