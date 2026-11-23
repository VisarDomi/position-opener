import type { Handle } from '@sveltejs/kit';
import { error, json, redirect, isHttpError } from '@sveltejs/kit';
import { getAppProfile } from '$lib/server/app-config.js';
import {
    hasUsers,
    verifyCredentials,
    verifySessionToken,
    SESSION_COOKIE_NAME
} from '$lib/server/auth.js';

/**
 * Authentication gate. In the personal profile (the default) every route —
 * pages, /api/* proxies, static assets — requires authentication. In the
 * showcase profile the app is a deliberately public demo and is served
 * unauthenticated.
 *
 * Two credential transports are accepted:
 *   1. the `po_session` cookie set by POST /api/auth/login (browsers, PWAs)
 *   2. HTTP Basic auth headers (curl, scripts)
 *
 * Unauthenticated page navigations are redirected to the in-app /unlock page
 * instead of being challenged with 401: iOS standalone PWAs do not show the
 * native Basic-auth prompt, they just render the 401 body.
 */

// Assets needed to render the unlock page and to install/run the PWA shell.
// /_app/* is the production build; /@vite/*, /src/* and /node_modules/* are
// the dev server's equivalents (the local service runs vite dev).
const STATIC_PATH_PREFIXES = ['/_app/', '/@vite/', '/src/', '/node_modules/', '/apple-touch-icon'];
const STATIC_PATHS = ['/favicon.ico', '/manifest.json', '/sw.js', '/robots.txt'];

function isStaticAsset(pathname: string): boolean {
    return STATIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))
        || STATIC_PATHS.includes(pathname);
}

function parseBasicHeader(header: string): { username: string; password: string } | null {
    const match = /^Basic\s+(.+)$/i.exec(header);
    if (!match) return null;

    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep <= 0) return null;

    return { username: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

function unauthorizedApi(): Response {
    // Deliberately no WWW-Authenticate: a Basic challenge inside an iOS
    // standalone PWA never shows a prompt, it just breaks the request.
    return json({ message: 'Unauthorized' }, { status: 401 });
}

let loggedMisconfigured = false;

export const handle: Handle = async ({ event, resolve }) => {
    if (getAppProfile() === 'showcase') {
        return resolve(event);
    }

    if (!hasUsers()) {
        // Fail closed: refuse to serve rather than run unauthenticated.
        if (!loggedMisconfigured) {
            loggedMisconfigured = true;
            console.error(
                '[auth] AUTH_USERS is not set or has no valid entries — refusing to serve any request. ' +
                'Generate an entry with `npm run auth:hash -- <username>` and configure AUTH_USERS ' +
                '(or set APP_PROFILE=showcase to run the public demo profile).'
            );
        }
        return new Response('Authentication not configured on this host', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }

    const { pathname, search } = event.url;
    const isUnlockPage = pathname === '/unlock' || pathname.startsWith('/unlock/');

    let user: string | undefined;

    const token = event.cookies.get(SESSION_COOKIE_NAME);
    if (token) {
        user = verifySessionToken(token) ?? undefined;
    }

    if (!user) {
        const basic = parseBasicHeader(event.request.headers.get('authorization') ?? '');
        if (basic && verifyCredentials(basic.username, basic.password)) {
            user = basic.username;
        }
    }

    if (user) {
        if (isUnlockPage) {
            redirect(302, '/');
        }
        event.locals.user = user;
        return resolve(event);
    }

    if (isUnlockPage || pathname.startsWith('/api/auth/') || isStaticAsset(pathname)) {
        return resolve(event);
    }

    if (pathname.startsWith('/api/')) {
        return unauthorizedApi();
    }

    redirect(302, `/unlock?redirect=${encodeURIComponent(pathname + search)}`);
};
