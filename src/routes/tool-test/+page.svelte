<script lang="ts">
	import { onMount } from 'svelte';

	// Deliberately standalone: this page imports nothing from $lib/webmcp. The
	// app's bridge installs its own `document.modelContext` accessor when the
	// browser supplies none, which makes it impossible to tell from the app
	// pages whether a real browser implementation was ever there. This page
	// touches only what the browser exposes, so "no tool showed up in the
	// agent" has exactly one explanation left: the browser side.

	interface ModelContextLike {
		registerTool?: (tool: unknown, options?: unknown) => Promise<unknown>;
		provideContext?: (context: unknown) => Promise<unknown> | unknown;
		getTools?: (options?: unknown) => Promise<unknown>;
		executeTool?: (tool: unknown, input?: unknown, options?: unknown) => Promise<unknown>;
		addEventListener?: EventTarget['addEventListener'];
	}

	const TOOL_NAME = 'set_text_box';

	let entryPoint = $state('(probing…)');
	let methods = $state<string[]>([]);
	let registered = $state(false);
	let registerError = $state('');
	let textValue = $state('');
	let calls = $state<string[]>([]);
	let mc: ModelContextLike | undefined;

	function note(line: string): void {
		calls = [...calls, `${new Date().toLocaleTimeString()}  ${line}`];
	}

	// Three candidates because implementations disagree: the draft spec puts
	// it on `document`, earlier Chrome builds and some extensions put it on
	// `navigator`, and a few page-world shims land on `window`.
	function findModelContext(): { source: string; context: ModelContextLike } | null {
		const candidates: [string, unknown][] = [
			['document.modelContext', (document as unknown as Record<string, unknown>).modelContext],
			['navigator.modelContext', (navigator as unknown as Record<string, unknown>).modelContext],
			['window.modelContext', (window as unknown as Record<string, unknown>).modelContext]
		];
		for (const [source, context] of candidates) {
			if (context && typeof context === 'object') {
				return { source, context: context as ModelContextLike };
			}
		}
		return null;
	}

	function describeMethods(context: ModelContextLike): string[] {
		const names = new Set<string>();
		for (
			let obj: object | null = context;
			obj && obj !== Object.prototype;
			obj = Object.getPrototypeOf(obj)
		) {
			for (const key of Object.getOwnPropertyNames(obj)) {
				if (typeof (context as unknown as Record<string, unknown>)[key] === 'function') {
					names.add(key);
				}
			}
		}
		return [...names].sort();
	}

	// The one tool. Shape follows the draft spec's ModelContextTool: name,
	// title, description, inputSchema (JSON Schema), execute.
	const tool = {
		name: TOOL_NAME,
		title: 'Set text box',
		description:
			'Writes a line of text into the text box on this page so the human can see it. ' +
			'Use it to confirm the page can be driven by an agent.',
		inputSchema: {
			type: 'object',
			properties: {
				text: {
					type: 'string',
					description: 'The text to put in the box.'
				}
			},
			required: ['text']
		},
		annotations: {
			readOnlyHint: false
		},
		async execute(input: unknown) {
			const text = String((input as { text?: unknown } | undefined)?.text ?? '');
			textValue = text;
			note(`${TOOL_NAME}(${JSON.stringify({ text })})`);
			// MCP's content-block shape rather than a bare string: the spec
			// stringifies whatever comes back, and every client that predates
			// that wording expects these blocks.
			return {
				content: [{ type: 'text', text: `Text box now reads: ${text}` }]
			};
		}
	};

	async function registerWith(context: ModelContextLike): Promise<void> {
		if (typeof context.registerTool === 'function') {
			await context.registerTool(tool);
			return;
		}
		// Pre-registerTool implementations replaced the whole tool list in one
		// call instead of registering individually.
		if (typeof context.provideContext === 'function') {
			await context.provideContext({ tools: [tool] });
			return;
		}
		throw new Error(`No registerTool() or provideContext() on ${entryPoint}`);
	}

	async function attach(found: { source: string; context: ModelContextLike }): Promise<void> {
		mc = found.context;
		entryPoint = found.source;
		methods = describeMethods(found.context);
		try {
			await registerWith(found.context);
			registered = true;
			note(`registered "${TOOL_NAME}" on ${found.source}`);
		} catch (error) {
			registerError = error instanceof Error ? error.message : String(error);
			note(`registration failed: ${registerError}`);
		}
	}

	onMount(() => {
		let cancelled = false;
		// An extension or flag-gated bootstrap can install the bridge after this
		// script runs, so a single check at mount reports "unsupported" on a
		// browser that supports it a moment later.
		const deadline = Date.now() + 5000;
		const poll = async (): Promise<void> => {
			if (cancelled) {
				return;
			}
			const found = findModelContext();
			if (found) {
				await attach(found);
				return;
			}
			if (Date.now() > deadline) {
				entryPoint = 'none found';
				note('no modelContext on document, navigator, or window after 5s');
				return;
			}
			setTimeout(() => void poll(), 250);
		};
		void poll();
		return () => {
			cancelled = true;
		};
	});

	// Proves the round trip without an agent: goes through the browser's own
	// executeTool if it has one, so a green result here means the tool is
	// genuinely reachable through the bridge and not just closed over locally.
	let selfTest = $state('');
	async function runSelfTest(): Promise<void> {
		selfTest = '';
		const stamp = `hello from the self-test at ${new Date().toLocaleTimeString()}`;
		try {
			if (mc && typeof mc.executeTool === 'function') {
				const result = await mc.executeTool(TOOL_NAME, { text: stamp });
				selfTest = `executeTool ok → ${JSON.stringify(result)}`;
				return;
			}
			await tool.execute({ text: stamp });
			selfTest = 'no executeTool() on this bridge — called execute() directly instead';
		} catch (error) {
			selfTest = `failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	async function listTools(): Promise<void> {
		selfTest = '';
		try {
			if (!mc || typeof mc.getTools !== 'function') {
				selfTest = 'no getTools() on this bridge';
				return;
			}
			selfTest = `getTools → ${JSON.stringify(await mc.getTools())}`;
		} catch (error) {
			selfTest = `getTools failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
</script>

<svelte:head>
	<title>WebMCP one-tool test</title>
</svelte:head>

<main>
	<h1>WebMCP one-tool test</h1>
	<p class="lede">
		A single tool, <code>{TOOL_NAME}</code>, that writes text into the box below. Nothing else on
		this page registers anything, and no app code runs here.
	</p>

	<section>
		<h2>The text box</h2>
		<input
			type="text"
			bind:value={textValue}
			placeholder="Ask the agent to call set_text_box…"
			aria-label="Text set by the agent"
		/>
		<div class="row">
			<button onclick={runSelfTest}>Self-test (call the tool)</button>
			<button onclick={listTools}>List registered tools</button>
		</div>
		{#if selfTest}
			<pre>{selfTest}</pre>
		{/if}
	</section>

	<section>
		<h2>Bridge</h2>
		<dl>
			<dt>Entry point</dt>
			<dd><code>{entryPoint}</code></dd>
			<dt>Methods on it</dt>
			<dd><code>{methods.length ? methods.join(', ') : '—'}</code></dd>
			<dt>Tool registered</dt>
			<dd class:ok={registered} class:bad={!registered && entryPoint === 'none found'}>
				{registered ? 'yes' : registerError || 'not yet'}
			</dd>
		</dl>
	</section>

	<section>
		<h2>Activity</h2>
		{#if calls.length}
			<ul>
				{#each calls as line}
					<li><code>{line}</code></li>
				{/each}
			</ul>
		{:else}
			<p class="muted">Nothing yet.</p>
		{/if}
	</section>
</main>

<style>
	main {
		max-width: 46rem;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
		display: grid;
		gap: 1.75rem;
	}

	.lede {
		color: var(--text-secondary, #666);
		margin: 0;
	}

	section {
		border: 1px solid var(--border-subtle, #ddd);
		border-radius: 8px;
		padding: 1rem 1.25rem;
	}

	h2 {
		margin: 0 0 0.75rem;
		font-size: 1rem;
	}

	input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		font-size: 1rem;
		font-family: inherit;
		color: inherit;
		background: var(--bg-panel, #fff);
		border: 1px solid var(--border-strong, #999);
		border-radius: 6px;
	}

	.row {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	button {
		font: inherit;
		padding: 0.4rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong, #999);
		background: var(--bg-panel, #fff);
		color: inherit;
		cursor: pointer;
	}

	dl {
		margin: 0;
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.35rem 1rem;
	}

	dt {
		color: var(--text-secondary, #666);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.ok {
		color: var(--positive, #1a7f37);
	}

	.bad {
		color: var(--negative, #b3261e);
	}

	.muted {
		color: var(--text-secondary, #666);
		margin: 0;
	}

	pre {
		margin: 0.75rem 0 0;
		padding: 0.6rem;
		background: var(--bg-app, #f6f6f6);
		border-radius: 6px;
		overflow-x: auto;
		font-size: 0.85rem;
	}

	ul {
		margin: 0;
		padding-left: 1.1rem;
	}
</style>
