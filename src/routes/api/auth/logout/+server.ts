import type { RequestHandler } from './$types';
import { SESSION_COOKIE_NAME } from '$lib/server/auth.js';

export const POST: RequestHandler = async ({ cookies }) => {
    cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
    return new Response(null, { status: 204 });
};
