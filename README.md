# Position Opener

Position Opener is a self-hosted trading PWA built around Capital.com market data and execution. It is optimized for mobile Safari and standalone iOS PWA use, with real-time charting, position planning, background-resume handling, and a custom chart orchestration layer on top of TradingView Lightweight Charts.

**Live demo:** private, by personal link. [demo.position-opener.veron3.space](https://demo.position-opener.veron3.space) says how to ask for one. With a link it signs in to a Capital.com demo account by itself. Best on an iPhone.

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

### App access

- `position-opener.veron3.space` — personal instance. The app has no authentication code for it: the Caddy `import authelia` snippet runs Authelia forward-auth in front of the site, as for the rest of veron3.space, and a valid Authelia SSO session is required to reach any route.
- `demo.position-opener.veron3.space` — showcase profile, open only through an access link (below). Without a valid link every page shows a short "private demo" page with a contact address, and every `/api/*` route answers 401.

Local dev (`npm run dev`) is unauthenticated by design; bind it to a trusted network. The broker-write proxies (`/api/positions`, `/api/accounts`, `/api/preferences`) derive their target URL from the request's `environment` field alone — they can only ever reach the two Capital.com hosts, so the gate in front decides *who* may call them, and the code decides *where* they can go.

### Broker credentials

For local development, you can optionally create a `.env` from `.env.example` to prefill the login form:

```bash
cp .env.example .env
```

These values are for local development only: the app reads them only in dev, and they are empty in a production build. Do not commit `.env`, and do not use this `PUBLIC_*` autofill path as a public demo deployment strategy.

### Profiles

`APP_PROFILE` selects the deployment profile: `personal` (the default) or `showcase`. The showcase profile logs in to the demo API on the server with the `SHOWCASE_*` credentials and returns only the session tokens to the client; it allows demo mode only.

The showcase trades on one demo account, **Visi** (`SHOWCASE_ACCOUNT_NAME`). The login's other demo accounts, "Arena 01" … "Arena 09", belong to [Trader](https://github.com/VisarDomi/trader), which shares the login. After login the server switches the session to Visi with `PUT /session` and checks it with `GET /session`; if Visi is missing or the switch does not stick, the showcase refuses to start rather than use another account. The client lists only Visi, and `/api/accounts` refuses any other account id.

## Demo links

Each person gets their own link: `https://demo.position-opener.veron3.space/?key=…`. The key is 32 random bytes. The server stores only its SHA-256 with a label, a creation date, an optional expiry and a revocation date, in `DEMO_ACCESS_FILE` (`/home/erdal/position-opener-showcase-access/links.json` on the server, mode 600; set in `/etc/veron3-apps/position-opener-showcase-1.env`). Opening the link sets an HttpOnly cookie and redirects to the same page without the key, so the key does not stay in the address bar, history or Referer headers. Each request checks the cookie against the store, so revoking a link closes it at once. A link is not single-use: email scanners and link previews may open it first.

Run from this repository on the PC (it runs `scripts/demo-link.mjs` on the server over SSH):

```bash
scripts/demo-link new "BuildQ" --days 30   # prints the link; omit --days for no expiry
scripts/demo-link list                     # id, status, created, expiry, label
scripts/demo-link revoke <id>              # the link stops working at once
```

A lost link cannot be shown again (only its hash is stored): revoke it and make a new one.

## iPhone / PWA testing

iOS standalone PWA behavior is a core design target for this project. For HTTPS-based local testing:

1. Generate a local certificate with `mkcert`.
2. Place the generated files at `~/.local/share/mkcert/pwa/key.pem` and `~/.local/share/mkcert/pwa/cert.pem`.
3. Start the dev server and open the app from your iPhone on the same network.
4. If you need the mkcert root CA, the app exposes it from `/api/cert` for manual installation on the test device. The route returns 404 when `NODE_ENV` is `production`.

## Current status

- Personal tool gated by Authelia at the reverse proxy; other users are an Authelia account away
- Unit tests (`npm test`) cover only the showcase access links and the Visi account lock; the trading app has none
- Documentation focuses on design decisions and runtime observability
