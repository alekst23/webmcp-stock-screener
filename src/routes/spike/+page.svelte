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
		margin: 0 auto;
		padding: var(--space-lg) var(--space-lg) var(--space-xl);
	}
	h1 {
		font-size: var(--font-size-xl);
		margin: 0 0 var(--space-sm);
	}
	h2 {
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--text-secondary);
		margin: 0 0 var(--space-sm);
	}
	p {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	section {
		margin-top: var(--space-lg);
		padding: var(--space-md);
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	ul {
		margin: 0;
		padding-left: var(--space-lg);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	button {
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: 0.35rem 0.65rem;
		background: var(--bg-elevated);
		color: var(--text-primary);
		font: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
	}
	button:hover {
		background: var(--bg-hover);
		border-color: var(--accent);
	}
	pre {
		white-space: pre-wrap;
		background: var(--bg-app);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		padding: var(--space-sm);
		font-size: 0.85em;
		margin: var(--space-sm) 0 0;
	}
	pre.error {
		background: var(--error-bg);
		border-color: var(--error);
		color: var(--error);
	}
</style>
