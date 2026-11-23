import type { URL_TYPE } from "$lib/shared/types/url.js";
import { DEFAULT_ERROR } from "$lib/shared/constants/error.js";
import { DEMO_TYPE, REAL_TYPE } from "$lib/shared/constants/auth.js";
import { DEMO_BASE_URL, REAL_BASE_URL, CST_KEY, X_SECURITY_TOKEN_KEY } from "$lib/shared/constants/api.js";
import type { SessionTokens } from "$lib/shared/types/auth.js";

export function getBaseUrl(type: URL_TYPE): string {
    switch (type) {
        case DEMO_TYPE:
            return DEMO_BASE_URL;
        case REAL_TYPE:
            return REAL_BASE_URL;
        default:
            throw new Error(DEFAULT_ERROR);
    }
}

/**
 * Resolves the broker base URL for untrusted request input. Returns null unless
 * the value is exactly DEMO_TYPE or REAL_TYPE, so a caller can never steer a
 * server-side fetch to any other host.
 */
export function getBrokerBaseUrl(environment: unknown): string | null {
    if (environment !== DEMO_TYPE && environment !== REAL_TYPE) return null;
    return getBaseUrl(environment);
}

/**
 * Type guard for untrusted session-token payloads: both broker tokens must be
 * present, non-empty strings before they are sent as headers.
 */
export function areValidSessionTokens(tokens: unknown): tokens is SessionTokens {
    if (typeof tokens !== 'object' || tokens === null) return false;
    const t = tokens as Record<string, unknown>;
    return typeof t[CST_KEY] === 'string' && t[CST_KEY].length > 0
        && typeof t[X_SECURITY_TOKEN_KEY] === 'string' && t[X_SECURITY_TOKEN_KEY].length > 0;
}