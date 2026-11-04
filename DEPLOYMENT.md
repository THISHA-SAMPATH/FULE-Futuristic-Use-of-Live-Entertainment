# FULE deployment guide

This guide deploys the React app to Vercel and the Express + Socket.IO API to Render. It does not create an actual deployment; configure the provider accounts and domains first.

## 1. Deploy the API to Render

1. Push this repository to GitHub and create a Render Blueprint from its root `render.yaml` (or create a Web Service with the backend settings below).
2. Keep the Render service root at the repository root: the backend imports the shared incident schema from `shared/`. The blueprint installs/starts the backend with `npm --prefix backend` and uses `/api/health` as the health check. It attaches `/var/data` so SQLite incidents, guardian invite hashes, and the audit log persist across service restarts. A persistent disk requires a paid Render plan.
3. In the service environment, set:
   - `FRONTEND_ORIGIN=https://<your-vercel-domain>` (one exact origin, no path or trailing slash).
   - `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_REDIRECT_URI=https://<your-render-service>.onrender.com/auth/twitch/callback`.
   - `OPENAI_API_KEY` if live synthesis is desired; deterministic fallback works without it.
   - `DEMO_MODE=false`, `FULE_DATA_DIR=/var/data` (the blueprint sets these).
4. Do not set `FULE_DEMO_GUARDIAN_INVITE` in production. Create a real guardian invite from the Render shell with `npm run create:guardian -- <guardian-id>` and deliver the printed code privately. The demo invite is for local demo use only.
5. Confirm `https://<your-render-service>.onrender.com/api/health` returns `{ "status": "ok" }`.

## 2. Configure Twitch OAuth and embeds

In the [Twitch Developer Console](https://dev.twitch.tv/console/apps), use a Confidential app. Add the exact Render callback URL above as the OAuth Redirect URL. Configure the requested product scopes during login: `user:read:chat`, `channel:read:redemptions`, `channel:manage:redemptions`, and `clips:edit`.

The embed's `parent` parameter comes from `window.location.hostname`; no fixed domain is compiled into the frontend. Twitch requires the served hostname to match the `parent` value. Test from the actual Vercel custom domain, not a preview URL that is not configured for your Twitch app.

## 3. Deploy the frontend to Vercel

1. Import the GitHub repository into Vercel and set **Root Directory** to `frontend`. In the Root Directory settings, enable **Include source files outside of the Root Directory in the Build Step** because the frontend imports the shared incident schema from `shared/`.
2. Use `npm run build` as the build command and `dist` as the output directory. `frontend/vercel.json` provides SPA fallback routing.
3. Add these Vercel environment variables for Production:
   - `VITE_API_URL=https://<your-render-service>.onrender.com`
   - `VITE_DEMO_MODE=false`
   - `VITE_TWITCH_CHANNEL=<authorized-test-channel>`
4. Redeploy after changing Vite environment values. Build-time `VITE_` values are public; never put Twitch secrets, invite codes, or API keys there.

## 4. Set final CORS and test

After Vercel gives you its final domain, set the Render `FRONTEND_ORIGIN` to that exact HTTPS origin and redeploy the API. Express and Socket.IO both allow that origin with credentials. In production the Twitch login session cookie is `Secure` and `SameSite=None` so the Vercel app can call the separate Render API. OAuth state remains an HttpOnly, SameSite=Lax cookie for the Twitch callback.

Verify the health endpoint, load the Vercel page, complete Connect Twitch, verify a guardian invite, and trigger/acknowledge a test SOS. Confirm the guardian history survives a Render restart. Keep `DEMO_MODE=false` and `VITE_DEMO_MODE=false` on every public deployment. The sample invite and seeded feed are demo-only, and FULE is a hackathon prototype, not an emergency service.

## Railway alternative

For Railway, deploy `backend/` as the service root with `npm ci` / `npm start`, attach a persistent volume at `/data`, and set `FULE_DATA_DIR=/data`, `PORT` from Railway's runtime, `FRONTEND_ORIGIN`, OAuth settings, and `DEMO_MODE=false`. Deploy `frontend/` to Vercel with the Railway HTTPS service URL as `VITE_API_URL`. Add the exact callback URL from the Railway domain to Twitch. Keep a persistent volume attached: SQLite data on an ephemeral container filesystem will not survive replacement.
