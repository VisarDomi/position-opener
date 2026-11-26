import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Access links for the showcase. Each link carries a random 256-bit key. The
 * store (DEMO_ACCESS_FILE, written by scripts/demo-link.mjs) keeps only the
 * SHA-256 of each key, so a copy of the file opens nothing. A fast hash is
 * enough: the keys are random, not passwords.
 */
export interface DemoLink {
    id: string;
    label: string;
    hash: string;
    created: string;
    expires: string | null;
    revoked: string | null;
}

export const ACCESS_COOKIE = '__Host-demo_access';

const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
}

/** A missing or unreadable store grants nothing. */
export function readLinks(path: string | undefined): DemoLink[] {
    if (!path) return [];
    try {
        const data = JSON.parse(readFileSync(path, 'utf8'));
        return Array.isArray(data.links) ? data.links : [];
    } catch (e) {
        console.error('[demo-access] cannot read the link store:', e instanceof Error ? e.message : e);
        return [];
    }
}

/** The link that `key` opens, or null when it is unknown, revoked or expired. */
export function findValidLink(links: DemoLink[], key: string, now = Date.now()): DemoLink | null {
    if (!KEY_PATTERN.test(key)) return null;
    const hash = Buffer.from(hashKey(key), 'hex');
    const link = links.find(l => {
        const stored = Buffer.from(l.hash, 'hex');
        return stored.length === hash.length && timingSafeEqual(stored, hash);
    });
    if (!link || link.revoked) return null;
    if (link.expires && !(Date.parse(link.expires) > now)) return null;
    return link;
}
