# Position Opener

Position Opener is a self-hosted trading PWA built around Capital.com market data and execution. It is optimized for mobile Safari and standalone iOS PWA use, with real-time charting, position planning, background-resume handling, and a custom chart orchestration layer on top of TradingView Lightweight Charts.

## Stack

- SvelteKit 2
- Svelte 5
- TypeScript
- TradingView Lightweight Charts
- IndexedDB for local candle cache and state restore
- Node adapter for self-hosted deployment

## What is interesting here

- iOS PWA resilience: the app handles resume, visibility gaps, and background wake-up edge cases that appear in real mobile usage.
- Functional core / imperative shell chart integration: Svelte reactivity captures intent, while a single RAF flush owns chart mutations.
- Structured runtime telemetry: chart, viewport, resume, and trading flows emit typed logs to make production-only timing bugs diagnosable.
- Local-first UX: the app keeps enough local state to restore quickly after reloads and intermittent mobile suspension.

The architectural rationale lives in [decisions.md](./decisions.md).

## Getting started

### Requirements

- Node.js 20+
- npm
- A Capital.com account

### Install

```bash
npm install
```

### Run in development

```bash
npm run dev
```

The Vite dev server binds to `0.0.0.0:23457`. If mkcert certificates exist under `~/.local/share/mkcert/pwa/`, HTTPS is enabled automatically for local iPhone/PWA testing.

### Build

```bash
npm run build
```

This project uses `@sveltejs/adapter-node`. For a production-style local run after build:

```bash
node build
```

## Authentication and local env

This repo does not ship live credentials.

### App access (unlock page + session)

In the personal profile every route — pages, `/api/*` proxies, static assets — requires authentication. The user store is the `AUTH_USERS` env var; passwords are stored as scrypt hashes, never plaintext:

```
AUTH_USERS=username:scrypt:N:r:p:salt_b64:hash_b64
```

Generate an entry with:

```bash
npm run auth:hash -- your-username
```

How you sign in:

- Browsers and PWAs: an unauthenticated visit redirects to the in-app `/unlock` page. Enter username + password once; you get a 10-year HttpOnly session cookie (`po_session`), re-issued while the app is in use, so it is effectively indefinite. iOS standalone PWAs handle this fine, unlike native HTTP Basic prompts, which they never display.
- `curl` and scripts: HTTP Basic auth headers still work.
- Rotating any `AUTH_USERS` password invalidates all issued sessions (the signing key derives from the `AUTH_USERS` value).
- **Fail closed:** in the personal profile with `AUTH_USERS` unset or malformed, the app refuses every request with 503 and logs the reason. It is never silently open.

Where the env var lives:

- **Local dev:** `.env` in the repo root (gitignored; see `.env.example`).
- **`node build` deployments:** the process env only — a production build does not read `.env` files, so put `AUTH_USERS` in the service's environment (e.g. systemd `EnvironmentFile`) and restart. Omitting it makes the app fail closed on purpose.

### Broker credentials

For local development, you can optionally create a `.env` from `.env.example` to prefill the login form:

```bash
cp .env.example .env
```

These values are for local development only: the app reads them only in dev, and they are empty in a production build. Do not commit `.env`, and do not use this `PUBLIC_*` autofill path as a public demo deployment strategy.

### Profiles

`APP_PROFILE` selects the deployment profile: `personal` (the default) or `showcase`. The showcase profile is public by design: it logs in to the demo API on the server with the `SHOWCASE_*` credentials, returns only the session tokens to the client, and allows demo mode only. In showcase mode `AUTH_USERS` is not consulted.

## iPhone / PWA testing

iOS standalone PWA behavior is a core design target for this project. For HTTPS-based local testing:

1. Generate a local certificate with `mkcert`.
2. Place the generated files at `~/.local/share/mkcert/pwa/key.pem` and `~/.local/share/mkcert/pwa/cert.pem`.
3. Start the dev server and open the app from your iPhone on the same network.
4. If you need the mkcert root CA, the app exposes it from `/api/cert` for manual installation on the test device. The route returns 404 when `NODE_ENV` is `production`.

## Current status

- Personal tool with HTTP Basic auth; multiple users are one `AUTH_USERS` entry away
- No automated tests
- Documentation focuses on design decisions and runtime observability
