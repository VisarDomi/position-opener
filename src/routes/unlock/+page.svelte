<script lang="ts">
    import { browser } from '$app/environment';
    import { page } from '$app/stores';

    let username = $state(browser ? (localStorage.getItem('po_last_user') ?? '') : '');
    let password = $state('');
    let busy = $state(false);
    let failure = $state('');

    function safeRedirectTarget(raw: string | null): string {
        // Only same-site absolute paths, no protocol-relative or external URLs.
        if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
            return '/';
        }
        return raw;
    }

    async function handleUnlock(e: SubmitEvent) {
        e.preventDefault();
        if (busy) return;

        busy = true;
        failure = '';

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (!response.ok) {
                failure = 'Wrong username or password.';
                return;
            }

            localStorage.setItem('po_last_user', username);

            // Full page load so the app layout boots normally.
            window.location.replace(safeRedirectTarget($page.url.searchParams.get('redirect')));
        } catch {
            failure = 'Could not reach the server. Try again.';
        } finally {
            busy = false;
        }
    }
</script>

<svelte:head>
    <title>Unlock — Position Opener</title>
</svelte:head>

<div class="unlock-shell">
    <div class="unlock-card">
        <div class="eyebrow">PRIVATE APP</div>
        <h1>Position Opener</h1>
        <p class="lead">Sign in with your app user to continue.</p>

        <form onsubmit={handleUnlock}>
            <label class="field">
                <span>Username</span>
                <input
                    type="text"
                    bind:value={username}
                    autocomplete="username"
                    autocapitalize="none"
                    spellcheck="false"
                    placeholder="username"
                />
            </label>
            <label class="field">
                <span>Password</span>
                <input
                    type="password"
                    bind:value={password}
                    autocomplete="current-password"
                    placeholder="password"
                />
            </label>

            {#if failure}
                <p class="failure" role="alert">{failure}</p>
            {/if}

            <button type="submit" class="primary" disabled={busy || !username || !password}>
                {busy ? 'UNLOCKING…' : 'UNLOCK'}
            </button>
        </form>
    </div>
</div>

<style>
    .unlock-shell {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        background:
            radial-gradient(circle at top left, rgba(38, 166, 154, 0.16), transparent 28rem),
            linear-gradient(180deg, #050505 0%, #0b0b0b 100%);
    }

    .unlock-card {
        width: min(100%, 380px);
        background: rgba(26, 26, 26, 0.92);
        border: 1px solid #333;
        border-radius: 16px;
        padding: 1.5rem 1.25rem;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
    }

    .eyebrow {
        color: #888;
        font-size: 0.72rem;
        letter-spacing: 0.18em;
        font-weight: 700;
        margin-bottom: 0.5rem;
    }

    h1 {
        font-size: 1.6rem;
        line-height: 1;
        margin-bottom: 0.5rem;
    }

    .lead {
        color: #8d8d8d;
        font-size: 0.9rem;
        margin-bottom: 1.1rem;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        margin-bottom: 0.85rem;
    }

    .field span {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #8d8d8d;
        font-weight: 700;
    }

    .field input {
        width: 100%;
        padding: 0.9rem 0.95rem;
        background: #111;
        color: #fff;
        border: 1px solid #2f2f2f;
        border-radius: 10px;
        font-size: 1rem;
        min-width: 0;
    }

    .field input:focus {
        outline: none;
        border-color: #555;
    }

    .failure {
        color: #ef5350;
        font-size: 0.85rem;
        margin-bottom: 0.75rem;
    }

    .primary {
        width: 100%;
        border: none;
        cursor: pointer;
        font-weight: 800;
        border-radius: 10px;
        transition: transform 0.15s ease, opacity 0.15s ease;
        padding: 1rem 1.1rem;
        color: white;
        margin-top: 0.5rem;
        background: #26a69a;
    }

    .primary:hover {
        transform: translateY(-1px);
    }

    .primary:disabled {
        opacity: 0.5;
        cursor: default;
        transform: none;
    }
</style>
