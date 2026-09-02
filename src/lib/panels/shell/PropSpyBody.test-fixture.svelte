<script lang="ts">
	// Test-only fixture for PanelFrame.test.ts: a minimal "real" panel body
	// that renders exactly the three props PanelBodyProps promises
	// (panel/linkedValue/onBroadcast), so a test can assert PanelFrame.svelte
	// actually forwards them to <Body ... /> rather than mounting it with no
	// props at all (the gap T-1010-7 fixed). Named with a `.test-fixture`
	// infix, not `.test`, so vitest's `src/**/*.test.ts` include glob never
	// tries to run this file as a test suite.
	import type { PanelBodyProps } from './panelController';

	let { panel, linkedValue, onBroadcast }: PanelBodyProps = $props();
</script>

<div data-testid="prop-spy">
	<span data-testid="panel-id">{panel.id}</span>
	<span data-testid="panel-title">{panel.title}</span>
	<span data-testid="linked-value">{linkedValue ? String(linkedValue.value) : ''}</span>
	<button type="button" onclick={() => onBroadcast('symbol', 'AAPL')}>broadcast</button>
</div>
