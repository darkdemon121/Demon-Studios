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
