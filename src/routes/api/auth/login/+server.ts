import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
    verifyCredentials,
    createSessionToken,
    SESSION_COOKIE_NAME,
    SESSION_TTL_MS
} from '$lib/server/auth.js';

export const POST: RequestHandler = async ({ request, cookies }) => {
    const body = await request.json().catch(() => ({}));

    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!verifyCredentials(username, password)) {
        // Small fixed delay on top of the scrypt cost to slow online guessing.
        await new Promise((r) => setTimeout(r, 300));
        error(401, 'Invalid username or password');
    }

    cookies.set(SESSION_COOKIE_NAME, createSessionToken(username), {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS / 1000
    });

    return json({ user: username });
};
