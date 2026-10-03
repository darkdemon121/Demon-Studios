import { createSocialOAuthService } from "../../../lib/social-oauth.js";

export default function handler(request, response) {
  return createSocialOAuthService().complete("x", request, response);
}