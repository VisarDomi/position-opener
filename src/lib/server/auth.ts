import { env } from '$env/dynamic/private';
import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * AUTH_USERS holds comma-separated credential entries:
 *
 *     username:scrypt:N:r:p:salt_b64:hash_b64
 *
 * Usernames are matched against [A-Za-z0-9._-]. Passwords are stored as scrypt
 * hashes (no plaintext at rest) so a leaked env file does not leak passwords.
 * Generate an entry with `npm run auth:hash -- <username>`.
 *
 * Multiple entries = multiple users; no code change needed to add one.
 */

const SCRYPT_KEYLEN = 32;
const MAX_CACHED_CREDENTIALS = 256;

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

interface StoredUser {
    N: number;
    r: number;
    p: number;
    salt: Buffer;
    hash: Buffer;
}

let warnedAboutEntries = false;

function parseEntry(raw: string, line: number): { name: string; hash: StoredUser } | null {
    const parts = raw.trim().split(':');
    if (parts.length !== 7 || parts[1] !== 'scrypt') {
        return malformed(raw, line);
    }

    const [name, , nStr, rStr, pStr, saltB64, hashB64] = parts;
    if (!USERNAME_PATTERN.test(name)) {
        return malformed(raw, line);
    }

    const N = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);

    // Same bounds as node's own scrypt validation, so bad entries fail loudly at
    // parse time instead of throwing inside every request.
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)
        || N < 16 || N > 2 ** 22 || r < 1 || r > 2 ** 22 || p < 1 || p > 2 ** 22) {
        return malformed(raw, line);
    }

    let salt: Buffer, hash: Buffer;
    try {
        salt = Buffer.from(saltB64, 'base64');
        hash = Buffer.from(hashB64, 'base64');
    } catch {
        return malformed(raw, line);
    }

    if (hash.length !== SCRYPT_KEYLEN || salt.length === 0) {
        return malformed(raw, line);
    }

    return { name, hash: { N, r, p, salt, hash } };
}

function malformed(raw: string, line: number): null {
    if (!warnedAboutEntries) {
        warnedAboutEntries = true;
        console.warn(`[auth] AUTH_USERS entry #${line + 1} is malformed and was skipped. Expected username:scrypt:N:r:p:salt_b64:hash_b64.`);
    }
    return null;
}

function loadUsers(): Map<string, StoredUser> {
    const users = new Map<string, StoredUser>();

    const raw = (env.AUTH_USERS ?? '').trim();
    if (!raw) return users;

    raw.split(',').forEach((entry, line) => {
        if (!entry.trim()) return;
        const parsed = parseEntry(entry, line);
        if (parsed) users.set(parsed.name, parsed.hash);
    });

    return users;
}

/**
 * True when AUTH_USERS holds at least one valid entry. Used by the hooks to
 * fail closed when authentication is required but not configured.
 */
export function hasUsers(): boolean {
    return loadUsers().size > 0;
}

// Recently verified `username\0password` pairs. The browser resends the same
// Basic-auth header with every request (including every static asset), so
// without this cache scrypt would run on all of them.
const verifiedCache = new Map<string, true>();

function cacheKey(username: string, password: string): string {
    return `${username}\0${password}`;
}

function cacheVerified(key: string): void {
    if (verifiedCache.size >= MAX_CACHED_CREDENTIALS) {
        // FIFO eviction; Map preserves insertion order.
        const oldest = verifiedCache.keys().next().value as string;
        verifiedCache.delete(oldest);
    }
    verifiedCache.set(key, true);
}

function matchesPassword(stored: StoredUser, password: string): boolean {
    const candidate = scryptSync(password, stored.salt, SCRYPT_KEYLEN, { N: stored.N, r: stored.r, p: stored.p });
    return candidate.length === stored.hash.length && timingSafeEqual(candidate, stored.hash);
}

export function verifyCredentials(username: string, password: string): boolean {
    if (!username || !password) return false;

    const key = cacheKey(username, password);
    if (verifiedCache.has(key)) return true;

    const stored = loadUsers().get(username);
    if (!stored || !matchesPassword(stored, password)) return false;

    cacheVerified(key);
    return true;
}

/**
 * Sessions: HttpOnly `po_session` cookie, valid for 10 years and re-issued
 * after 30 days of use (sliding renewal) — effectively indefinite for a
 * personal PWA that is opened at least monthly.
 *
 * The token is `username:expiry:HMAC(username:expiry, key)` with the key
 * derived from the raw AUTH_USERS value. That means no separate secret to
 * manage, tokens stay valid across service restarts, and rotating any user's
 * password invalidates every issued session.
 */
export const SESSION_COOKIE_NAME = 'po_session';
export const SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sessionKey(): Buffer {
    return createHash('sha256').update(env.AUTH_USERS ?? '').digest();
}

export interface SessionInfo {
    username: string;
    expiry: number;
}

/** True when the session is old enough that the cookie should be re-issued. */
export function needsSessionRefresh(session: SessionInfo, now: number = Date.now()): boolean {
    const issuedAt = session.expiry - SESSION_TTL_MS;
    return now - issuedAt > SESSION_REFRESH_AGE_MS;
}

import type { Cookies } from '@sveltejs/kit';

/** Sets (or refreshes) the session cookie. Use at login and on sliding renewal. */
export function setSessionCookie(cookies: Cookies, username: string, now: number = Date.now()): void {
    cookies.set(SESSION_COOKIE_NAME, createSessionToken(username, now), {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS / 1000
    });
}

export function createSessionToken(username: string, now: number = Date.now()): string {
    const expiry = now + SESSION_TTL_MS;
    const mac = createHmac('sha256', sessionKey()).update(`${username}:${expiry}`).digest('base64url');
    return `${username}:${expiry}:${mac}`;
}

export function verifySessionToken(token: string, now: number = Date.now()): SessionInfo | null {
    const parts = token.split(':');
    if (parts.length !== 3) return null;

    const [username, expiryStr, mac] = parts;
    if (!USERNAME_PATTERN.test(username)) return null;

    const expiry = Number(expiryStr);
    if (!Number.isInteger(expiry) || expiry < now) return null;

    const expected = createHmac('sha256', sessionKey()).update(`${username}:${expiry}`).digest();
    const received = Buffer.from(mac, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

    return { username, expiry };
}
