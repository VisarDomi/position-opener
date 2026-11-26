import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppProfile, openShowcaseSession } from '$lib/server/app-config.js';

export const POST: RequestHandler = async () => {
    if (getAppProfile() !== 'showcase') {
        error(404, 'Not found');
    }

    try {
        return json(await openShowcaseSession());
    } catch (e) {
        console.error('[showcase] bootstrap refused:', e instanceof Error ? e.message : e);
        error(503, 'Showcase account unavailable');
    }
};
