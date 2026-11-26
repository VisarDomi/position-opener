import { describe, expect, it } from 'vitest';
import { getShowcaseAccountId, openShowcaseSession } from './app-config.js';

const CREDENTIALS = { apiKey: 'k', identifier: 'i', password: 'p' };
const VISI = '242302980896141598';
const ARENA = '271762681270448414';

interface Call { method: string; body?: string }

/** A fake Capital.com: the login lands on `current`; PUT /session moves it unless `putStatus` fails. */
function fakeBroker(opts: { accounts?: { accountId: string; accountName: string }[]; putStatus?: number; sticks?: boolean }) {
    const calls: Call[] = [];
    let current = ARENA;
    const accounts = opts.accounts ?? [
        { accountId: VISI, accountName: 'Visi' },
        { accountId: ARENA, accountName: 'Arena 02' },
    ];
    const tokens = { cst: 'c', 'x-security-token': 's' };

    const fetchFn = (async (_url: string, init: RequestInit) => {
        const method = init.method ?? 'GET';
        calls.push({ method, body: init.body as string | undefined });
        if (method === 'POST') {
            return new Response(JSON.stringify({ currentAccountId: current, accounts }), { headers: tokens });
        }
        if (method === 'PUT') {
            const status = opts.putStatus ?? 200;
            if (status === 200 && opts.sticks !== false) current = JSON.parse(init.body as string).accountId;
            return new Response('{}', { status, headers: tokens });
        }
        return new Response(JSON.stringify({ accountId: current }));
    }) as typeof fetch;

    return { fetchFn, calls };
}

describe('openShowcaseSession', () => {
    it('switches the session from the preferred Arena account to Visi', async () => {
        const broker = fakeBroker({});
        const tokens = await openShowcaseSession(CREDENTIALS, broker.fetchFn);

        expect(tokens).toEqual({ cst: 'c', 'x-security-token': 's' });
        expect(broker.calls.map(c => c.method)).toEqual(['POST', 'PUT', 'GET']);
        expect(JSON.parse(broker.calls[1].body!)).toEqual({ accountId: VISI });
        expect(getShowcaseAccountId()).toBe(VISI);
    });

    it('refuses when no account is named Visi, and never switches', async () => {
        const broker = fakeBroker({ accounts: [{ accountId: ARENA, accountName: 'Arena 02' }] });
        await expect(openShowcaseSession(CREDENTIALS, broker.fetchFn)).rejects.toThrow(/not found/);
        expect(broker.calls.map(c => c.method)).toEqual(['POST']);
    });

    it('refuses when the broker rejects the switch', async () => {
        const broker = fakeBroker({ putStatus: 500 });
        await expect(openShowcaseSession(CREDENTIALS, broker.fetchFn)).rejects.toThrow(/switch failed/);
    });

    it('refuses when the session is still on another account after the switch', async () => {
        const broker = fakeBroker({ sticks: false });
        await expect(openShowcaseSession(CREDENTIALS, broker.fetchFn)).rejects.toThrow(/not "Visi"/);
    });
});
