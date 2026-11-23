import type { Handle } from '@sveltejs/kit';
import { getAppProfile } from '$lib/server/app-config.js';
import { hasUsers, verifyCredentials } from '$lib/server/auth.js';

/**
 * Authentication gate. In the personal profile (the default) every route —
 * pages, /api/* proxies, static assets — requires HTTP Basic auth. In the
 * showcase profile the app is a deliberately public demo and is served
 * unauthenticated.
 */
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

    const header = event.request.headers.get('authorization') ?? '';
    const match = /^Basic\s+(.+)$/i.exec(header);

    if (match) {
        const decoded = Buffer.from(match[1], 'base64').toString('utf8');
        const sep = decoded.indexOf(':');

        if (sep > 0) {
            const username = decoded.slice(0, sep);
            const password = decoded.slice(sep + 1);

            if (verifyCredentials(username, password)) {
                event.locals.user = username;
                return resolve(event);
            }
        }
    }

    return new Response('Unauthorized', {
        status: 401,
        headers: {
            'WWW-Authenticate': 'Basic realm="Position Opener", charset="UTF-8"',
            'Content-Type': 'text/plain; charset=utf-8'
        }
    });
};

let loggedMisconfigured = false;
