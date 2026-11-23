<script lang="ts">
    import { page } from '$app/stores';
    import { appEngine } from '$lib/core/engine/AppEngine.svelte.js';

    let { children } = $props();

    // The unlock page is the gate itself: the engine never boots there (see
    // +layout.svelte), so it must render without waiting for the engine.
    const isUnlock = $derived($page.route?.id === '/unlock');
</script>

{#if !isUnlock && (appEngine.status === 'BOOTING' || appEngine.status === 'AUTH_CHECK' || appEngine.status === 'LOADING')}
    <div style="display: flex; justify-content: center; align-items: center; height: 100vh; background-color: black; color: #d1d4dc;">
        <div style="text-align: center;">
            <p style="margin-bottom: 1rem; font-weight: bold; font-size: 1.2rem;">INITIALIZING</p>
            <p style="color: #666; font-size: 0.9rem;">{appEngine.status}...</p>
        </div>
    </div>
{:else}
    {@render children()}
{/if}