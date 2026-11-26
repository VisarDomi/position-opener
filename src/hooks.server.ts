import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getAppProfile } from '$lib/server/app-config.js';
import { ACCESS_COOKIE, findValidLink, readLinks } from '$lib/server/demo-access.js';

// Browsers cap cookie lifetimes at 400 days.
const MAX_COOKIE_SECONDS = 400 * 24 * 60 * 60;

const PRIVATE_HEADERS = {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow',
};

/**
 * The showcase opens only with an access link (scripts/demo-link.mjs). A valid
 * `?key=` becomes an HttpOnly cookie, and a redirect removes the key from the
 * address bar, so it does not stay in history, Referer headers or screenshots.
 * Every request checks the cookie against the store again, so a revoked link
 * stops working at once. The personal profile is gated by the reverse proxy.
 */
export const handle: Handle = async ({ event, resolve }) => {
    if (getAppProfile() !== 'showcase') return resolve(event);

    const links = readLinks(env.DEMO_ACCESS_FILE);
    const key = event.url.searchParams.get('key');

    if (key !== null) {
        const link = findValidLink(links, key);
        if (!link) return denied(event.url.pathname, true, event.cookies.serialize(ACCESS_COOKIE, '', cookieOptions(0)));

        const clean = new URL(event.url);
        clean.searchParams.delete('key');
        const seconds = link.expires
            ? Math.min(MAX_COOKIE_SECONDS, Math.floor((Date.parse(link.expires) - Date.now()) / 1000))
            : MAX_COOKIE_SECONDS;
        return new Response(null, {
            status: 303,
            headers: {
                ...PRIVATE_HEADERS,
                location: clean.pathname + clean.search,
                'set-cookie': event.cookies.serialize(ACCESS_COOKIE, key, cookieOptions(seconds)),
            },
        });
    }

    const cookie = event.cookies.get(ACCESS_COOKIE);
    if (cookie && findValidLink(links, cookie)) return resolve(event);

    const clear = cookie ? event.cookies.serialize(ACCESS_COOKIE, '', cookieOptions(0)) : undefined;
    return denied(event.url.pathname, Boolean(cookie), clear);
};

function cookieOptions(maxAge: number) {
    return { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge };
}

function denied(pathname: string, linkFailed: boolean, setCookie?: string): Response {
    const headers: Record<string, string> = { ...PRIVATE_HEADERS };
    if (setCookie) headers['set-cookie'] = setCookie;

    if (pathname.startsWith('/api/')) {
        headers['content-type'] = 'application/json';
        return new Response(JSON.stringify({ message: 'Private demo: an access link is required' }), { status: 401, headers });
    }

    headers['content-type'] = 'text/html; charset=utf-8';
    return new Response(landingPage(linkFailed), { status: linkFailed ? 403 : 200, headers });
}

function landingPage(linkFailed: boolean): string {
    const notice = linkFailed
        ? '<p class="notice">This link has expired or was revoked.</p>'
        : '';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Position Opener · private demo</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #131722; color: #d1d4dc;
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 32rem; padding: 2rem 1.5rem; }
  h1 { margin: 0 0 0.25rem; font-size: 1.6rem; color: #fff; }
  .eyebrow { font-size: 0.75rem; letter-spacing: 0.12em; color: #787b86; text-transform: uppercase; }
  .notice { padding: 0.75rem 1rem; border: 1px solid #ef5350; border-radius: 6px; color: #ef5350; }
  a { color: #2962ff; }
</style>
</head>
<body>
<main>
  <div class="eyebrow">Private demo</div>
  <h1>Position Opener</h1>
  <p>A trading web app for the iPhone, on Capital.com market data.</p>
  ${notice}
  <p>The live demo trades on a Capital.com demo account, so it opens only from a personal link.</p>
  <p>To get a link, email Visar Domi at <a href="mailto:visardomi4@gmail.com?subject=Position%20Opener%20demo">visardomi4@gmail.com</a>.</p>
  <p>The source code is public: <a href="https://github.com/VisarDomi/position-opener">github.com/VisarDomi/position-opener</a>.</p>
</main>
</body>
</html>`;
}
