// Manages access links for the showcase (demo.position-opener.veron3.space).
// It runs on the server that hosts the showcase; scripts/demo-link runs it there over SSH.
//
//   node demo-link.mjs new <label> [--days N]   print a new link (no --days: no expiry)
//   node demo-link.mjs list                     list all links
//   node demo-link.mjs revoke <id>              stop a link at once
//
// The store keeps the SHA-256 of each key, never the key: a lost link cannot be
// shown again, only replaced. DEMO_ACCESS_FILE and DEMO_URL override the defaults.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const STORE = process.env.DEMO_ACCESS_FILE || join(homedir(), 'position-opener-showcase-access', 'links.json');
const DEMO_URL = process.env.DEMO_URL || 'https://demo.position-opener.veron3.space';

function load() {
    try {
        return JSON.parse(readFileSync(STORE, 'utf8'));
    } catch (e) {
        if (e.code === 'ENOENT') return { links: [] };
        throw e;
    }
}

function save(store) {
    mkdirSync(dirname(STORE), { recursive: true, mode: 0o700 });
    const tmp = `${STORE}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, STORE);
}

function status(link) {
    if (link.revoked) return 'revoked';
    if (link.expires && Date.parse(link.expires) <= Date.now()) return 'expired';
    return 'active';
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

if (command === 'new') {
    const daysAt = args.indexOf('--days');
    let days = null;
    if (daysAt !== -1) {
        days = Number(args[daysAt + 1]);
        if (!(days > 0)) fail('--days needs a positive number');
        args.splice(daysAt, 2);
    }
    const label = args.join(' ').trim();
    if (!label) fail('Usage: new <label> [--days N]');

    const key = randomBytes(32).toString('base64url');
    const now = new Date();
    const link = {
        id: randomBytes(4).toString('hex'),
        label,
        hash: createHash('sha256').update(key).digest('hex'),
        created: now.toISOString(),
        expires: days ? new Date(now.getTime() + days * 86_400_000).toISOString() : null,
        revoked: null,
    };
    const store = load();
    store.links.push(link);
    save(store);
    console.log(`${DEMO_URL}/?key=${key}`);
    console.error(`id ${link.id} · "${label}" · ${link.expires ? `expires ${link.expires.slice(0, 10)}` : 'no expiry'}`);
} else if (command === 'list') {
    const { links } = load();
    if (links.length === 0) console.log('No links.');
    for (const l of links) {
        console.log([l.id, status(l).padEnd(7), l.created.slice(0, 10), l.expires ? `until ${l.expires.slice(0, 10)}` : 'no expiry ', l.label].join('  '));
    }
} else if (command === 'revoke') {
    const store = load();
    const link = store.links.find(l => l.id === args[0]);
    if (!link) fail(`No link with id ${args[0]}. Run "list" to see the ids.`);
    link.revoked ??= new Date().toISOString();
    save(store);
    console.log(`Revoked ${link.id} ("${link.label}").`);
} else {
    fail('Usage: demo-link.mjs new <label> [--days N] | list | revoke <id>');
}
