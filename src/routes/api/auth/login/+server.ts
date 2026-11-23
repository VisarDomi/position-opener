import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyCredentials, setSessionCookie } from '$lib/server/auth.js';

export const POST: RequestHandler = async ({ request, cookies }) => {
    const body = await request.json().catch(() => ({}));

    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!verifyCredentials(username, password)) {
        // Small fixed delay on top of the scrypt cost to slow online guessing.
        await new Promise((r) => setTimeout(r, 300));
        error(401, 'Invalid username or password');
    }

    setSessionCookie(cookies, username);

    return json({ user: username });
};
