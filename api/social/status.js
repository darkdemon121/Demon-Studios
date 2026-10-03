import { requireMethod, setCors } from "../../lib/stripe.js";
import { installationCredentials, sendSocialError } from "../../lib/social-http.js";
import { socialStore } from "../../lib/social-store.js";

export default async function handler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "GET")) return;
  response.setHeader("Cache-Control", "no-store");
  try {
    const { installationId, installationSecret } = installationCredentials(request);
    const id = await socialStore.ensureInstallation(installationId, installationSecret);
    const accounts = await socialStore.listConnections(id);
    response.json({ accounts: accounts.map(account => ({
      provider: account.provider,
      display_name: account.display_name,
      expires_at: account.expires_at,
      connected_at: account.created_at
    })) });
  } catch (error) {
    sendSocialError(response, error, "Could not load connected accounts.");
  }
}