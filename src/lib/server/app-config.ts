import { env } from '$env/dynamic/private';
import * as API from '$lib/shared/constants/api.js';
import { SHOWCASE_ACCOUNT_NAME } from '$lib/shared/constants/auth.js';
import type { AppProfile } from '$lib/shared/types/app.js';
import type { SessionTokens } from '$lib/shared/types/auth.js';

export interface ShowcaseCredentials {
    apiKey: string;
    identifier: string;
    password: string;
}

function normalizeProfile(value: string | undefined): AppProfile {
    return value === 'showcase' ? 'showcase' : 'personal';
}

export function getAppProfile(): AppProfile {
    return normalizeProfile(env.APP_PROFILE);
}

export function getPublicAppConfig() {
    return {
        appProfile: getAppProfile(),
    };
}

export function getShowcaseCredentials(): ShowcaseCredentials {
    if (getAppProfile() !== 'showcase') {
        throw new Error('Showcase credentials requested outside showcase profile');
    }

    const apiKey = env.SHOWCASE_API_KEY ?? '';
    const identifier = env.SHOWCASE_IDENTIFIER ?? '';
    const password = env.SHOWCASE_PASSWORD ?? '';

    if (!apiKey || !identifier || !password) {
        throw new Error('Showcase credentials are not configured');
    }

    return { apiKey, identifier, password };
}

// The id of the showcase account, known after the first successful session.
// /api/accounts refuses every switch while it is null or differs.
let showcaseAccountId: string | null = null;

export function getShowcaseAccountId(): string | null {
    return showcaseAccountId;
}

function readTokens(headers: Headers): SessionTokens | null {
    const cst = headers.get(API.CST_KEY);
    const sec = headers.get(API.X_SECURITY_TOKEN_KEY);
    return cst && sec ? { [API.CST_KEY]: cst, [API.X_SECURITY_TOKEN_KEY]: sec } : null;
}

/**
 * Logs in to the demo API and puts the session on the account named
 * SHOWCASE_ACCOUNT_NAME. The login lands on the login's preferred account, which
 * can be one of Trader's Arena accounts, so the switch is checked with
 * GET /session. Any failure throws: the showcase never hands out a session on
 * another account.
 */
export async function openShowcaseSession(
    credentials: ShowcaseCredentials = getShowcaseCredentials(),
    fetchFn: typeof fetch = fetch,
): Promise<SessionTokens> {
    const sessionUrl = `${API.DEMO_BASE_URL}${API.SESSION_ENDPOINT}`;

    const login = await fetchFn(sessionUrl, {
        method: API.POST_METHOD,
        headers: {
            [API.CONTENT_TYPE_KEY]: API.APPLICATION_JSON_CONTENT_TYPE,
            [API.X_CAP_API_KEY_KEY]: credentials.apiKey,
        },
        body: JSON.stringify({
            [API.IDENTIFIER_KEY]: credentials.identifier,
            [API.PASSWORD_KEY]: credentials.password,
        }),
    });
    if (!login.ok) throw new Error(`Showcase login failed (${login.status})`);

    let tokens = readTokens(login.headers);
    if (!tokens) throw new Error('Showcase login returned no session tokens');

    const body = await login.json() as {
        currentAccountId?: string;
        accounts?: { accountId: string; accountName: string }[];
    };
    const account = body.accounts?.find(a => a.accountName === SHOWCASE_ACCOUNT_NAME);
    if (!account) throw new Error(`Showcase account "${SHOWCASE_ACCOUNT_NAME}" not found`);

    if (body.currentAccountId !== account.accountId) {
        const put = await fetchFn(sessionUrl, {
            method: API.PUT_METHOD,
            headers: { [API.CONTENT_TYPE_KEY]: API.APPLICATION_JSON_CONTENT_TYPE, ...tokens },
            body: JSON.stringify({ accountId: account.accountId }),
        });
        if (!put.ok) throw new Error(`Showcase account switch failed (${put.status})`);
        tokens = readTokens(put.headers) ?? tokens;
    }

    const check = await fetchFn(sessionUrl, { method: API.GET_METHOD, headers: { ...tokens } });
    if (!check.ok) throw new Error(`Showcase session check failed (${check.status})`);
    const session = await check.json() as { accountId?: string };
    if (session.accountId !== account.accountId) {
        throw new Error(`Showcase session is on ${session.accountId}, not "${SHOWCASE_ACCOUNT_NAME}"`);
    }

    showcaseAccountId = account.accountId;
    return tokens;
}
