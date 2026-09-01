<script lang="ts">
	import { onMount } from 'svelte';
	import { registerSpikeTool, spikePing, type SpikePingResponse } from '$lib/webmcp/spike';

	// T-0001-2 platform spike page: registers the throwaway `spikePing` tool
	// on load (AC1) so a real agent in a WebMCP-capable browser can discover
	// and invoke it (AC2). Not linked from the app's normal navigation --
	// reached directly at /spike per the runbook in
	// docs/plan/EPIC-0001/T-0001-2-live-verification-runbook.md. Superseded
	// once T-0001-5 registers the real tool surface.

	let webmcpSupported = $state(false);
	let toolRegistered = $state(false);
	let manualResult = $state<{ ok: boolean; text: string } | null>(null);

	onMount(async () => {
		webmcpSupported = 'modelContext' in document && !!document.modelContext;
		toolRegistered = await registerSpikeTool(document.modelContext);
	});

	async function runManualCheck(): Promise<void> {
		manualResult = null;
		try {
			const data: SpikePingResponse = await spikePing();
			manualResult = { ok: true, text: JSON.stringify(data, null, 2) };
		} catch (e) {
			manualResult = { ok: false, text: e instanceof Error ? e.message : String(e) };
		}
	}
</script>

<main>
	<h1>T-0001-2 platform spike</h1>
	<p>
		Temporary page. Registers one throwaway WebMCP tool, <code>spikePing</code>, that calls the
		local FastAPI backend (<code>http://localhost:8000/api/spike/ping</code>) over a real HTTP
		request. See the runbook at
		<code>docs/plan/EPIC-0001/T-0001-2-live-verification-runbook.md</code> for how to drive this with
		a real agent in a WebMCP-capable browser.
	</p>

	<section>
		<h2>Status</h2>
		<ul>
			<li>
				WebMCP supported in this browser (<code>document.modelContext</code>):
				<strong>{webmcpSupported ? 'yes' : 'no'}</strong>
			</li>
			<li>
				<code>spikePing</code> tool registered: <strong>{toolRegistered ? 'yes' : 'no'}</strong>
			</li>
		</ul>
	</section>

	<section>
		<h2>Manual check (no agent required)</h2>
		<p>Calls the same code the tool's <code>execute()</code> runs, directly from this page.</p>
		<button onclick={runManualCheck}>Call spikePing() directly</button>
		{#if manualResult}
			<pre class:error={!manualResult.ok}>{manualResult.text}</pre>
		{/if}
	</section>
</main>

<style>
	main {
		max-width: 720px;
		margin: 2rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
	pre {
		white-space: pre-wrap;
		background: #f5f5f5;
		padding: 0.5rem;
		font-size: 0.85em;
	}
	pre.error {
		background: #fee;
	}
</style>
