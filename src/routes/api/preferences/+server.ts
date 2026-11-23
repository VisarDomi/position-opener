import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as API from '$lib/shared/constants/api.js';
import { getBrokerBaseUrl, areValidSessionTokens } from '$lib/shared/utils/helpers.js';

export const PUT: RequestHandler = async ({ request }) => {
    const body = await request.json();

    const environment = body.environment;
    const sessionTokens = body.sessionTokens;
    const leverages = body.leverages;
    const hedgingMode = body.hedgingMode;

    // The broker URL is derived from the environment discriminator, never from
    // the request body, so this endpoint cannot be aimed at any other host.
    const baseUrl = getBrokerBaseUrl(environment);
    if (!baseUrl) {
        error(400, "Missing or invalid environment");
    }

    if (!areValidSessionTokens(sessionTokens)) {
        error(400, "Missing or invalid session tokens");
    }

    const targetUrl = `${baseUrl}${API.PREFERENCES_ENDPOINT}`;

    try {
        const response = await fetch(targetUrl, {
            method: API.PUT_METHOD,
            headers: {
                [API.CONTENT_TYPE_KEY]: API.APPLICATION_JSON_CONTENT_TYPE,
                [API.X_SECURITY_TOKEN_KEY]: sessionTokens[API.X_SECURITY_TOKEN_KEY],
                [API.CST_KEY]: sessionTokens[API.CST_KEY],
            },
            body: JSON.stringify({
                leverages,
                hedgingMode
            })
        });

        if (!response.ok) {
            error(response.status, "Broker rejected preferences update");
        }

        const status = await response.json();
        return json(status);

    } catch (e) {
        if (isHttpError(e)) throw e;
        console.error(e);
        error(502, "Broker request failed");
    }
};
