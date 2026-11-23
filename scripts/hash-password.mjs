#!/usr/bin/env node
/**
 * Generates an AUTH_USERS entry from a username + password prompt.
 *
 * Usage: npm run auth:hash -- <username>
 *
 * On a TTY the password is typed with echo hidden. Piped input is also
 * supported:  printf 'secret\nsecret\n' | node scripts/hash-password.mjs user
 *
 * Prints an entry of the form  username:scrypt:N:r:p:salt_b64:hash_b64
 * which goes into AUTH_USERS (comma-separated for multiple users).
 */
import { scryptSync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 32;

const username = process.argv[2];
if (!username || !/^[A-Za-z0-9._-]+$/.test(username)) {
    console.error('Usage: npm run auth:hash -- <username>  (letters, digits, ".", "_", "-")');
    process.exit(1);
}

let password, confirmation;

if (process.stdin.isTTY === true) {
    // Echo prompts but swallow the typed password.
    const muted = new Writable({
        write(chunk, encoding, callback) {
            if (!this.muted) process.stdout.write(chunk, encoding);
            callback();
        }
    });
    muted.muted = false;
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true });

    const ask = (query) => new Promise((resolve) => {
        muted.muted = false;                // let the prompt through
        rl.question(query, (answer) => {
            muted.muted = true;             // back to swallowing
            process.stdout.write('\n');    // the newline the terminal didn't echo
            resolve(answer);
        });
        muted.muted = true;                 // hide the typing
    });

    password = await ask('Password: ');
    confirmation = await ask('Repeat password: ');
    rl.close();
} else {
    // Piped input: read it whole up front. readline would emit both lines in
    // one synchronous burst and the second prompt's listener would miss it.
    const chunks = [];
    await new Promise((resolve) => {
        process.stdin.on('data', (c) => chunks.push(c));
        process.stdin.on('end', resolve);
    });
    const lines = Buffer.concat(chunks).toString('utf8').split('\n').map((l) => l.replace(/\r$/, ''));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    password = lines[0] ?? '';
    confirmation = lines[1] ?? '';
}

if (!password) {
    console.error('Password must not be empty.');
    process.exit(1);
}

if (password !== confirmation) {
    console.error('Passwords do not match.');
    process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, KEYLEN, { N, r, p });

console.log('');
console.log(`AUTH_USERS entry for "${username}":`);
console.log(`${username}:scrypt:${N}:${r}:${p}:${salt.toString('base64')}:${hash.toString('base64')}`);
console.log('');
console.log('Add it to AUTH_USERS (comma-separated for multiple users):');
console.log('  - local dev:  .env in the repo root  (gitignored)');
console.log('  - service:   ~/.config/position-opener.env, then scripts/restart');
