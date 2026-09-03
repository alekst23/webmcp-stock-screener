<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { workspaceStore } from '$lib/workspace/store';
	import { activityStore } from '$lib/workspace/activity';
	import { createApiEngine } from '$lib/workspace/apiEngine';
	import { resolveApiBaseUrl } from '$lib/workspace/apiConfig';
	import { startBridgeSession } from '$lib/webmcp/session';
	import { buildTools } from '$lib/webmcp/tools';
	import {
		buildWebmcpStatus,
		formatAgentToolsContext,
		type WebmcpBridgeState,
		type WebmcpStatus
	} from '$lib/webmcp/status';

	const apiConfig = { baseUrl: resolveApiBaseUrl(env.PUBLIC_API_BASE_URL) };

	// The root page is intentionally a WebMCP-only host while we diagnose agent
	// discovery. Tools still mutate the shared workspace and record activity,
	// but no visible UI affordance can be mistaken for the intended interface.
	const engine = createApiEngine(workspaceStore, apiConfig);

	let webmcpStatus = $state<WebmcpStatus | null>(null);
	let bridgeState = $state<WebmcpBridgeState>('connecting');
	let availableNames = $state<string[]>([]);

	onMount(() => {
		webmcpStatus = buildWebmcpStatus(buildTools(engine));

		return startBridgeSession(
			engine,
			activityStore,
			(state) => (bridgeState = state),
			(names) => (availableNames = names)
		);
	});
</script>

<svelte:head>
	<title>MarketPane WebMCP Host</title>
</svelte:head>

{#if webmcpStatus}
	{@html `<!-- ${formatAgentToolsContext(webmcpStatus, bridgeState)} Live registered count: ${availableNames.length}. This route intentionally renders no chart, ticker, toolbar, snapshot, or activity UI components. -->`}
{/if}

<main aria-label="MarketPane WebMCP host" data-testid="webmcp-only-host"></main>
