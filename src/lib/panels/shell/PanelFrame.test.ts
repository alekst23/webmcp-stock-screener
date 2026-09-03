// T-1010-7: proves the PanelFrame.svelte / panelController.ts prop-passing
// fix actually delivers per-instance data to a real (non-placeholder) panel
// body. Before this fix, `<Body />` was rendered with zero props -- a real
// body reading `panel.id` would have thrown "Cannot read properties of
// undefined". This mounts the real PanelFrame component (not a stand-in)
// against a fixture body that renders exactly PanelBodyProps's three
// fields, so a regression here (someone reverting the fix, or dropping a
// prop while refactoring) fails loudly.
import { describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import PanelFrame from './PanelFrame.svelte';
import PropSpyBody from './PropSpyBody.test-fixture.svelte';
import { makePanel } from '../domain/panel';
import type { PanelKindDefinition } from '../registry/panelKindRegistry';

function realBodyKindDefinition(): PanelKindDefinition {
	return {
		kind: 'test_real_kind',
		defaultTitle: 'Test',
		defaultSize: { colSpan: 1, rowSpan: 1 },
		minSize: { colSpan: 1, rowSpan: 1 },
		defaultConfig: () => ({}),
		validateConfig: () => ({ ok: true, value: {} }),
		configSchema: { type: 'object', properties: {} },
		linkChannels: ['symbol'],
		bindingTypes: [],
		defaultRenderer: null,
		component: async () => PropSpyBody
	};
}

describe('PanelFrame renders a real body with its per-instance props', () => {
	it('forwards panel, linkedValue, and onBroadcast to a resolved real component', async () => {
		const panel = makePanel({
			id: 'panel_42',
			kind: 'test_real_kind',
			title: 'My Panel',
			config: {},
			rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
		});
		const broadcastCalls: { channel: string; value: string }[] = [];

		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelFrame, {
			target,
			props: {
				panel,
				rect: panel.rect,
				kindDefinition: realBodyKindDefinition(),
				linkedValue: { channel: 'symbol', value: 'AAPL' },
				onToggleCollapse: () => {},
				onRemove: () => {},
				onBroadcast: (channel, value) => {
					broadcastCalls.push({ channel, value });
					return true;
				}
			}
		});

		// resolvePanelBody's dynamic `component()` load resolves across a few
		// microtask hops (component() -> resolvePanelBody's own await ->
		// its .then() callback assigning $state); draining the microtask
		// queue with a macrotask boundary is more robust than guessing how
		// many Promise.resolve() hops are needed.
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		const panelIdEl = target.querySelector('[data-testid="panel-id"]');
		expect(
			panelIdEl?.textContent,
			'expected the real body to receive `panel` and render its id -- before the fix, <Body /> ' +
				'took no props at all and this would be empty or throw'
		).toBe('panel_42');
		expect(target.querySelector('[data-testid="panel-title"]')?.textContent).toBe('My Panel');
		expect(
			target.querySelector('[data-testid="linked-value"]')?.textContent,
			'expected the real body to receive `linkedValue`'
		).toBe('AAPL');

		const broadcastButton = target.querySelector<HTMLButtonElement>(
			'[data-testid="prop-spy"] button'
		);
		broadcastButton?.click();
		flushSync();
		expect(
			broadcastCalls,
			'expected the real body to receive a working `onBroadcast` callback'
		).toEqual([{ channel: 'symbol', value: 'AAPL' }]);

		unmount(instance);
	});
});
