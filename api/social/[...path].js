import { requireMethod, setCors } from "../../lib/stripe.js";
import { installationCredentials, sendSocialError } from "../../lib/social-http.js";
import { createSocialOAuthService, socialProviders } from "../../lib/social-oauth.js";
import { createSocialPublishService } from "../../lib/social-publish.js";
import { socialStore } from "../../lib/social-store.js";

const oauth = createSocialOAuthService();
const publish = createSocialPublishService();

function routePath(request) {
  if (Array.isArray(request.query?.path)) return request.query.path.join("/");
  if (typeof request.query?.path === "string") return request.query.path;
  return new URL(request.url, "https://demonstudios.vercel.app").pathname.replace(/^\/api\/social\/?/, "");
}

export default async function handler(request, response) {
  if (setCors(request, response)) return;
  response.setHeader("Cache-Control", "no-store");
  const path = routePath(request);

  if (path === "connect") {
    if (!requireMethod(request, response, "POST")) return;
    try {
      const { provider } = request.body || {};
      if (!socialProviders.includes(provider)) return response.status(400).json({ error: "Unsupported social platform." });
      const { installationId, installationSecret } = installationCredentials(request);
      const id = await socialStore.ensureInstallation(installationId, installationSecret);
      return response.json(await oauth.start({ provider, installationId: id, installationSecret }));
    } catch (error) {
      return sendSocialError(response, error, "Could not start social account connection.");
    }
  }

  if (path === "status") {
    if (!requireMethod(request, response, "GET")) return;
    try {
      const { installationId, installationSecret } = installationCredentials(request);
      const id = await socialStore.ensureInstallation(installationId, installationSecret);
      const accounts = await socialStore.listConnections(id);
      return response.json({ accounts: accounts.map(account => ({
        provider: account.provider,
        display_name: account.display_name,
        expires_at: account.expires_at,
        connected_at: account.created_at
      })) });
    } catch (error) {
      return sendSocialError(response, error, "Could not load connected accounts.");
    }
  }

  if (path === "disconnect") {
    if (!requireMethod(request, response, "POST")) return;
    try {
      const { provider } = request.body || {};
      if (!socialProviders.includes(provider)) return response.status(400).json({ error: "Unsupported social platform." });
      const { installationId, installationSecret } = installationCredentials(request);
      const id = await socialStore.authenticateInstallation(installationId, installationSecret);
      await socialStore.deleteConnection(id, provider);
      return response.json({ disconnected: provider });
    } catch (error) {
      return sendSocialError(response, error, "Could not disconnect this account.");
    }
  }

  if (path === "publish") {
    if (!requireMethod(request, response, "POST")) return;
    try {
      const { installationId, installationSecret } = installationCredentials(request);
      const id = await socialStore.authenticateInstallation(installationId, installationSecret);
      const { provider, content, media_url: mediaUrl = null, job_id: jobId } = request.body || {};
      return response.json(await publish({ installationId: id, provider, content, mediaUrl, jobId }));
    } catch (error) {
      return sendSocialError(response, error, "The scheduled post could not be published.");
    }
  }

  const callbackMatch = /^callback\/(linkedin|x|instagram)$/.exec(path);
  if (callbackMatch) {
    if (!requireMethod(request, response, "GET")) return;
    return oauth.complete(callbackMatch[1], request, response);
  }

  return response.status(404).json({ error: "Social API route not found." });
}