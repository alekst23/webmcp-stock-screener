// Bug fix (see git history): handleBroadcast used to discard
// propagateLinkedValue's `targets`, so broadcasting on a channel with zero
// linked panels looked identical to a real send -- the input cleared either
// way with no feedback. This proves the fix: onBroadcast's return value
// (whether anyone was actually reached) drives a visible "no linked
// recipients" state instead of a silent no-op.
import { describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { makePanel } from '../domain/panel';
import type { PanelKindDefinition } from '../registry/panelKindRegistry';
import PlaceholderPanelBody from './PlaceholderPanelBody.svelte';

function mountTarget(): HTMLDivElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	return target;
}

function kindDefinition(): PanelKindDefinition {
	return {
		kind: 'test_kind',
		defaultTitle: 'Test',
		defaultSize: { colSpan: 1, rowSpan: 1 },
		minSize: { colSpan: 1, rowSpan: 1 },
		defaultConfig: () => ({}),
		validateConfig: () => ({ ok: true, value: {} }),
		configSchema: { type: 'object', properties: {} },
		linkChannels: ['symbol'],
		bindingTypes: [],
		defaultRenderer: null,
		component: async () => ({})
	};
}

function submit(target: HTMLDivElement, value: string): void {
	const input = target.querySelector<HTMLInputElement>('.broadcast input');
	const form = target.querySelector<HTMLFormElement>('form.broadcast');
	expect(input, 'expected the broadcast input to render').not.toBeNull();
	expect(form, 'expected the broadcast form to render').not.toBeNull();
	input!.value = value;
	input!.dispatchEvent(new Event('input', { bubbles: true }));
	form!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

describe('PlaceholderPanelBody broadcast feedback', () => {
	it('shows a visible message and keeps the draft value when nothing was reached', () => {
		const panel = makePanel({
			id: 'panel_1',
			kind: 'test_kind',
			title: 'Panel',
			config: {},
			rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
		});
		const target = mountTarget();
		const instance = mount(PlaceholderPanelBody, {
			target,
			props: {
				panel,
				kindDefinition: kindDefinition(),
				onBroadcast: () => false
			}
		});

		submit(target, 'AAPL');
		flushSync();

		expect(
			target.querySelector('.broadcast-feedback')?.textContent,
			'expected a visible "no linked recipients" message, not a silent no-op'
		).toMatch(/no panel is linked/i);
		expect(
			target.querySelector<HTMLInputElement>('.broadcast input')?.value,
			'a no-op broadcast must not clear the draft as if it had succeeded'
		).toBe('AAPL');

		unmount(instance);
	});

	it('clears the draft value and shows no feedback message when the broadcast reaches a target', () => {
		const panel = makePanel({
			id: 'panel_1',
			kind: 'test_kind',
			title: 'Panel',
			config: {},
			rect: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
		});
		const target = mountTarget();
		const instance = mount(PlaceholderPanelBody, {
			target,
			props: {
				panel,
				kindDefinition: kindDefinition(),
				onBroadcast: () => true
			}
		});

		submit(target, 'AAPL');
		flushSync();

		expect(target.querySelector('.broadcast-feedback')).toBeNull();
		expect(target.querySelector<HTMLInputElement>('.broadcast input')?.value).toBe('');

		unmount(instance);
	});
});
