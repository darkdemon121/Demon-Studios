# Demon Studios website

A standalone, static company website for Demon Studios, by Taylor C. It is separate from the VibeShift project and can be deployed as a static site on Vercel.

## Deploy to Vercel

1. Put the contents of this folder at the root of its own GitHub repository. The repository root must contain `index.html`, `styles.css`, and `script.js`.
2. In Vercel, choose **Add New Project** and import that repository. If you put the site inside a subfolder of a larger repository, set **Root Directory** to that subfolder (for example, `DemonStudios`).
3. Set the framework preset to **Other**. Leave the build command and output directory empty; this is a plain HTML, CSS, and JavaScript site.
4. Deploy. Vercel will provide a public `*.vercel.app` URL; add a custom domain later if desired.

If Vercel shows a 404 or a blank page, first confirm its Root Directory is the folder containing `index.html`, then redeploy.

The hero image and web fonts load from external providers. The support contact uses a `mailto:` link. The license text is a draft and needs legal review before being treated as binding terms.

## VibeShift billing API

The Vercel project also serves the VibeShift Stripe API from `/api`. Add these environment variables in the Vercel project settings for Preview and Production; never commit real values:

- `STRIPE_SECRET_KEY`: a newly rotated restricted key for the matching Stripe sandbox/live mode.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the webhook endpoint `https://demonstudios.vercel.app/api/webhooks/stripe`.
- `STRIPE_PRICE_MONTHLY`: the VibeShift monthly Price ID.
- `STRIPE_PRICE_LIFETIME`: the VibeShift one-time Price ID.
- `PUBLIC_BASE_URL`: `https://demonstudios.vercel.app`.
- `STRIPE_BILLING_ENABLED`: leave `false` until Stripe clears account verification and payout setup; switch to `true` only when live charges are approved.

Subscribe the webhook to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. The API verifies access against Stripe on demand, so it does not depend on serverless local-file persistence. After deployment, verify `https://demonstudios.vercel.app/api/health`; billing, prices, and webhook flags should be configured, and `billingEnabled` should remain false until live payments and payouts are approved.

## VibeShift AI Rewrite

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` (`gpt-4.1-mini` by default) in Vercel Preview and Production. Never place the key in client code. The `POST /api/ai-rewrite` route enforces a paid Stripe Checkout entitlement in Production, limits source text to 8,000 characters, limits each session to 20 requests per hour per running function instance, uses a 25-second upstream timeout, and does not persist prompts or outputs. It supports `task: "draft"` for theme-based starter drafts, with instructions not to invent facts or first-person claims. Configure OpenAI project spend limits and alerts; the in-memory rate limit is instance-local, not a global quota.

For a private Preview-only test before billing is enabled, set `AI_ALLOW_UNPAID=true` in the Preview environment only. The route ignores this switch in Production. Set it false or remove it from Production. The VibeShift extension visibly discloses that AI Rewrite sends its draft and selected audience/tone/goal to OpenAI. The public privacy page is `/privacy`.

### VibeShift Alpha tester AI

Alpha uses the separate `POST /api/ai-alpha` route and does not require Stripe. To enable it for a private test, set `VIBESHIFT_ALPHA_AI_ENABLED=true`, `VIBESHIFT_ALPHA_TEST_TOKEN` to a random secret of at least 32 characters, and `OPENAI_API_KEY` in Vercel. Share the tester token privately, separate from the ZIP. The route limits source text to 8,000 characters and five requests per token per UTC day per running function instance. The in-memory limit is not global; keep the tester token private and configure an OpenAI spend limit. Set `VIBESHIFT_ALPHA_AI_ENABLED=false` or remove the token to disable Alpha AI.

## Social account publishing

VibeShift uses anonymous per-installation credentials, not user passwords or a VibeShift account. OAuth access and refresh tokens are encrypted with AES-256-GCM in the Turso database before storage. Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `SOCIAL_TOKEN_ENCRYPTION_KEY` in Vercel. Configure `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`, `X_CLIENT_ID` and `X_CLIENT_SECRET`, and `INSTAGRAM_CLIENT_ID` and `INSTAGRAM_CLIENT_SECRET`; register callbacks at `/api/social/callback/linkedin`, `/api/social/callback/x`, and `/api/social/callback/instagram` on the production origin.

### Social publishing environment variables

The social API stores OAuth credentials encrypted in Turso. Configure `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `SOCIAL_TOKEN_ENCRYPTION_KEY` in Vercel. Generate the encryption key from 32 cryptographically random bytes, base64-encoded; retain a secure backup because losing it makes stored provider tokens unusable. Never commit these values.

Register callback URLs on each provider app: `https://demonstudios.vercel.app/api/social/callback/linkedin`, `https://demonstudios.vercel.app/api/social/callback/x`, and `https://demonstudios.vercel.app/api/social/callback/instagram`. Set the matching client ID/secret variables listed in `.env.example`. The apps need member-posting permission approvals before real users can publish. The extension has no VibeShift account; it creates an installation key locally. OAuth tokens are encrypted in Turso. X/LinkedIn text posts and X threads are supported. Instagram requires an eligible professional account and a public HTTPS image URL. Scheduled publishing is driven by Chrome alarms, so Chrome must be running/available when a scheduled item becomes due.

Provider approval is separate from VibeShift implementation. LinkedIn requires the app to have `w_member_social`; X requires OAuth 2.0 user auth with `tweet.write`, `tweet.read`, `users.read`, and `offline.access`; Instagram requires eligible professional accounts and `instagram_business_content_publish`. LinkedIn and X text publishing are supported. Instagram's API requires public image/video media, so text-only carousel drafts return `media_required` and are not published. Scheduled auto-publishing currently runs from Chrome alarms; Chrome must be available at the scheduled time. The extension never reports a local reminder as a successful post.
