import { describe, expect, it } from 'vitest';
import { findValidLink, hashKey, readLinks, type DemoLink } from './demo-access.js';

const KEY = 'a'.repeat(43);
const NOW = Date.parse('2026-11-26T12:00:00Z');

function link(overrides: Partial<DemoLink> = {}): DemoLink {
    return { id: '1', label: 'cv', hash: hashKey(KEY), created: '2026-11-01T00:00:00Z', expires: null, revoked: null, ...overrides };
}

describe('findValidLink', () => {
    it('opens a known key with no expiry', () => {
        expect(findValidLink([link()], KEY, NOW)?.label).toBe('cv');
    });

    it('opens a key before its expiry and not after', () => {
        expect(findValidLink([link({ expires: '2026-11-27T00:00:00Z' })], KEY, NOW)).not.toBeNull();
        expect(findValidLink([link({ expires: '2026-11-26T00:00:00Z' })], KEY, NOW)).toBeNull();
    });

    it('refuses a revoked key, an unknown key and a malformed key', () => {
        expect(findValidLink([link({ revoked: '2026-11-20T00:00:00Z' })], KEY, NOW)).toBeNull();
        expect(findValidLink([link()], 'b'.repeat(43), NOW)).toBeNull();
        expect(findValidLink([link()], 'short', NOW)).toBeNull();
    });

    it('grants nothing when the store is missing', () => {
        expect(readLinks(undefined)).toEqual([]);
        expect(readLinks('/nonexistent/links.json')).toEqual([]);
    });
});
