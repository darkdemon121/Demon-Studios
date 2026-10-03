import { createSocialOAuthService } from "../../../lib/social-oauth.js";

export default function handler(request, response) {
  return createSocialOAuthService().complete("instagram", request, response);
}