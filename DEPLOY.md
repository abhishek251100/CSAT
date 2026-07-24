# Deploying to Vercel — single domain

The web app and the API ship as **one Vercel project** from this one repo. The
Vite build serves the SPA on the CDN, and the Hono API runs as a serverless
function at `apps/web/api/[[...route]].ts`, mounted at `/api/*` on the **same
domain**. Because everything is same-origin, auth cookies "just work" and there
is exactly **one** Google redirect URI to register.

```
https://<your-app>.vercel.app/            -> SPA (apps/web/dist)   [static, CDN]
https://<your-app>.vercel.app/api/*        -> Hono function         [serverless]
      /api            status banner
      /api/health     liveness
      /api/trpc/*     tRPC
      /api/auth/*     better-auth (Google + break-glass)

The function entry is `apps/web/api/[[...route]].js` (filesystem catch-all). It
re-exports the esbuild bundle from `server/build.mjs`. Do **not** rewrite
`/api/*` onto a bare `/api` destination — that can drop the path Hono needs for
`/api/auth/callback/google`.
```

The frontend calls the API with **relative** URLs in production (`VITE_API_URL`
is empty), so it always targets its own origin.

---

## 1. Create the Vercel project

Import this repo in Vercel, then set:

| Setting              | Value                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- |
| **Root Directory**   | `apps/web`                                                                                |
| **Framework Preset** | Vite (auto-detected)                                                                      |
| **Build Command**    | `vite build && node server/build.mjs` (from `apps/web/vercel.json`)                       |
| **Output Directory** | `dist` (from `apps/web/vercel.json`)                                                      |
| **Install Command**  | leave default — Vercel runs `pnpm install` at the repo root and links the whole workspace |
| **Node.js Version**  | 22.x (matches `engines.node >=22.13`)                                                     |

Vercel reads `packageManager` (`pnpm@10.34.5`) from the root `package.json` and
uses pnpm automatically. The catch-all at `apps/web/api/[[...route]].js` is the
serverless function for every `/api` path; `apps/web/vercel.json` only adds the
SPA fallback rewrite so client-side routes like `/actionables` resolve to
`index.html` while `/api/*` stays on the function.

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)

Set these for **Production** (and Preview, if you use preview deploys). All API
variables are read by the serverless function from `process.env`; a missing
required one makes every `/api/*` call fail loudly at cold start rather than
running half-configured.

| Variable                | Value                                           | Notes                                                                 |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`          | your Neon `postgres://…` string                 | required                                                              |
| `BETTER_AUTH_SECRET`    | 32+ random chars                                | required — rotating it logs everyone out                              |
| `BETTER_AUTH_URL`       | `https://<your-app>.vercel.app`                 | required — must equal the domain you visit; builds the OAuth callback |
| `WEB_ORIGIN`            | `https://<your-app>.vercel.app`                 | required — better-auth trusted origin (CSRF); same value as above     |
| `ALLOWED_EMAIL_DOMAINS` | `thestarterlabs.com` (comma-separated for more) | required — the domain wall for Google sign-in                         |
| `SUPERADMIN_EMAIL`      | break-glass admin email                         | required                                                              |
| `SUPERADMIN_PASSWORD`   | break-glass password (12+ chars)                | required                                                              |
| `GOOGLE_CLIENT_ID`      | Google OAuth client id                          | optional — omit to disable Google, break-glass still works            |
| `GOOGLE_CLIENT_SECRET`  | Google OAuth client secret                      | optional                                                              |
| `VITE_API_URL`          | **empty string** (`""`)                         | build-time; empty = same-origin. **Do not** set it to a URL.          |
| `NODE_ENV`              | `production`                                    | Vercel sets this automatically                                        |

> `VITE_API_URL` is a **build-time** var (Vite inlines it). Leave it empty so the
> browser uses relative `/api/...` URLs. If you ever set it to a full URL you'd
> switch back to a split-origin setup and reintroduce CORS + a second redirect URI.

## 3. Google Cloud Console (only if using Google SSO)

Add **one** Authorized redirect URI to your OAuth client:

```
https://<your-app>.vercel.app/api/auth/callback/google
```

(Authorized JavaScript origins: `https://<your-app>.vercel.app`.) This is the
same `redirect_uri_mismatch` fix as local dev, just with the production domain.

> Preview deployments get their own URLs, so Google SSO will not match on a
> preview unless you also register that preview URL. Break-glass sign-in works on
> any deployment.

## 4. Database migrations

The app reads the existing Neon schema; it does not migrate on boot. Apply
migrations from your machine against the same `DATABASE_URL` before/at release
(`pnpm --filter @zoo/db db:migrate`, per the repo's migration workflow).

## 5. Deploy

Push to the connected branch (or `vercel --prod`). After it's live, verify:

```
GET https://<your-app>.vercel.app/api          -> 200 JSON banner (google enabled/disabled)
GET https://<your-app>.vercel.app/api/health   -> 200 {"status":"ok"}
GET https://<your-app>.vercel.app/             -> the SPA
```

Then open `/sign-in`, confirm the Google button appears (or the break-glass form
if Google is disabled), and sign in.

---

## Notes / trade-offs

- **Why one project, not two:** same-origin means no CORS, no cross-site cookie
  config, and a single redirect URI — the simplest correct setup for this auth.
- **Runtime:** the function runs on Vercel's Node.js runtime. The DB layer uses
  the Neon **HTTP** driver (`@neondatabase/serverless`), which is built for
  serverless — no connection pool to manage, no cold-start pool exhaustion.
- **The Hono app is unchanged** across hosts. `apps/api/src/server.ts` is the
  local Node entry; `apps/web/server/handler.ts` (bundled, re-exported from
  `apps/web/api/[[...route]].js`) is the Vercel entry. Both call the same
  `createApp(env)` — swapping hosts replaces the entry file, not the app
  (SPEC.md §16 #6).
- **Demo data** (`demo:seed`/`demo:purge`) is a CLI you run from your machine
  against `DATABASE_URL`; it is not part of the deployment and refuses to run
  under `NODE_ENV=production`.
