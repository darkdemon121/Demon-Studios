import { requireMethod, setCors } from "../../lib/stripe.js";
import { installationCredentials, sendSocialError } from "../../lib/social-http.js";
import { socialStore } from "../../lib/social-store.js";
import { createSocialPublishService } from "../../lib/social-publish.js";

const publish = createSocialPublishService();

export default async function handler(request, response) {
  if (setCors(request, response)) return;
  if (!requireMethod(request, response, "POST")) return;
  response.setHeader("Cache-Control", "no-store");
  try {
    const { installationId, installationSecret } = installationCredentials(request);
    const id = await socialStore.authenticateInstallation(installationId, installationSecret);
    const { provider, content, media_url: mediaUrl = null, job_id: jobId } = request.body || {};
    const result = await publish({ installationId: id, provider, content, mediaUrl, jobId });
    response.json(result);
  } catch (error) {
    sendSocialError(response, error, "The scheduled post could not be published.");
  }
}