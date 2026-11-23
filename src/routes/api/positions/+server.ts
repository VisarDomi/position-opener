import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as API from '$lib/shared/constants/api.js';
import { getBrokerBaseUrl, areValidSessionTokens } from '$lib/shared/utils/helpers.js';

// Deal IDs are opaque broker identifiers. Anything outside this set would let a
// caller steer the request path (traversal, query or fragment injection).
const DEAL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const PUT: RequestHandler = async ({ request }) => {
    const body = await request.json();

    const environment = body.environment;
    const sessionTokens = body.sessionTokens;
    const dealId = body.dealId;
    const updateData = body.data;

    // The broker URL is derived from the environment discriminator, never from
    // the request body, so this endpoint cannot be aimed at any other host.
    const baseUrl = getBrokerBaseUrl(environment);
    if (!baseUrl) {
        error(400, "Missing or invalid environment");
    }

    if (!areValidSessionTokens(sessionTokens)) {
        error(400, "Missing or invalid session tokens");
    }

    if (typeof dealId !== 'string' || !DEAL_ID_PATTERN.test(dealId)) {
        error(400, "Missing or invalid deal ID");
    }

    if (!updateData) {
        error(400, "Missing required parameters");
    }

    const targetUrl = `${baseUrl}${API.POSITIONS_ENDPOINT}/${dealId}`;

    try {
        const response = await fetch(targetUrl, {
            method: API.PUT_METHOD,
            headers: {
                [API.CONTENT_TYPE_KEY]: API.APPLICATION_JSON_CONTENT_TYPE,
                [API.X_SECURITY_TOKEN_KEY]: sessionTokens[API.X_SECURITY_TOKEN_KEY],
                [API.CST_KEY]: sessionTokens[API.CST_KEY],
            },
            body: JSON.stringify(updateData)
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));

            error(response.status, errBody.errorCode || "Broker rejected position update");
        }

        const result = await response.json();
        return json(result);

    } catch (e) {
        if (isHttpError(e)) throw e;
        console.error(e);
        error(502, "Broker request failed");
    }
};
