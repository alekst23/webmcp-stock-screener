// T-0027-2: end-to-end drop tests against the real, mounted PanelContainer
// (createDefaultPanelShellRuntime()'s real deps, same pattern
// richDefaultLayout.test.ts uses) -- proves the DOM wiring (dragover/drop
// handlers, panel-frame hit-testing via data-panel-id, drop-cell geometry)
// actually drives panelController.ts's createChartFromDrop/
// bindPanelSourceFromDrop, not just the controller functions in isolation
// (see panelController.dropOnCanvas.test.ts for those).
import { beforeEach, describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import PanelContainer from './PanelContainer.svelte';
import { createDefaultPanelShellRuntime } from './registerPanelTools';
import { createPanel, readPanelState } from '../application';
import { PANEL_SOURCE_DRAG_MIME, serializePanelSourceDrag } from '../domain/dragSource';
import type { PanelSourceRef } from '../domain/panel';

const INSTRUMENT_SOURCE: PanelSourceRef = {
	type: 'instrument',
	ref: {
		instrument: {
			instrument_id: 'inst:XNAS:AAPL',
			symbol: 'AAPL',
			exchange: 'XUNK',
			asset_type: 'equity'
		}
	}
};

class FakeDataTransfer {
	private readonly store = new Map<string, string>();
	dropEffect = 'none';
	effectAllowed = 'none';
	setData(format: string, data: string): void {
		this.store.set(format, data);
	}
	getData(format: string): string {
		return this.store.get(format) ?? '';
	}
	get types(): string[] {
		return [...this.store.keys()];
	}
}

function dragEvent(
	type: string,
	dataTransfer: FakeDataTransfer,
	point = { clientX: 0, clientY: 0 }
) {
	const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
	Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
	Object.defineProperty(event, 'clientX', { value: point.clientX });
	Object.defineProperty(event, 'clientY', { value: point.clientY });
	return event;
}

function instrumentDragTransfer(): FakeDataTransfer {
	const dataTransfer = new FakeDataTransfer();
	dataTransfer.setData(PANEL_SOURCE_DRAG_MIME, serializePanelSourceDrag(INSTRUMENT_SOURCE));
	return dataTransfer;
}

beforeEach(() => {
	localStorage.clear();
});

describe('PanelContainer drop handling (T-0027-2)', () => {
	it('AC1: dropping on an empty cell creates a chart panel there, bound to the dropped instrument', () => {
		const { deps, observer } = createDefaultPanelShellRuntime();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelContainer, { target, props: { deps, observer } });
		flushSync();

		const containerEl = target.querySelector<HTMLElement>('.panel-container')!;
		containerEl.getBoundingClientRect = () =>
			({ left: 0, top: 0, width: 600, height: 400 }) as DOMRect;

		const before = readPanelState(deps.repository.get(deps.workspaceId)!).panels.length;

		// The seeded filter_builder panel occupies columns 0-1, all rows
		// (DEFAULT_SEED_PANELS). 600/6 = 100px/col -- x=350 is column 3,
		// well clear of it.
		containerEl.dispatchEvent(
			dragEvent('drop', instrumentDragTransfer(), { clientX: 350, clientY: 50 })
		);
		flushSync();

		const panels = readPanelState(deps.repository.get(deps.workspaceId)!).panels;
		expect(panels.length, 'expected exactly one new panel to have been created').toBe(before + 1);
		const created = panels.find((p) => p.kind === 'chart' && p.rect.col === 3 && p.rect.row === 0);
		expect(
			created,
			`expected a chart panel at (3, 0), got ${JSON.stringify(panels)}`
		).toBeDefined();
		expect(created?.source?.type).toBe('instrument');

		unmount(instance);
	});

	it('AC2/AC5: dropping on an existing chart panel rebinds it instead of creating a new one', () => {
		const { deps, observer } = createDefaultPanelShellRuntime();
		const created = createPanel(deps, {
			context: { actor: 'agent' },
			kind: 'chart',
			rect: { col: 3, row: 0, colSpan: 3, rowSpan: 2 }
		});
		const panelId = created.affectedIds[0]!;

		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelContainer, { target, props: { deps, observer } });
		flushSync();

		const before = readPanelState(deps.repository.get(deps.workspaceId)!).panels.length;
		const panelEl = target.querySelector<HTMLElement>(`[data-panel-id="${panelId}"]`)!;
		panelEl.dispatchEvent(dragEvent('drop', instrumentDragTransfer()));
		flushSync();

		const panels = readPanelState(deps.repository.get(deps.workspaceId)!).panels;
		expect(panels.length, 'rebinding must not create a second panel').toBe(before);
		const panel = panels.find((p) => p.id === panelId)!;
		expect(panel.source?.type).toBe('instrument');

		unmount(instance);
	});

	it('AC3: dropping on a panel that never accepts an instrument source changes nothing', () => {
		const { deps, observer } = createDefaultPanelShellRuntime();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelContainer, { target, props: { deps, observer } });
		flushSync();

		// The seeded filter_builder panel: bindingTypes is [] (T-0027-1),
		// never accepts any source.
		const before = readPanelState(deps.repository.get(deps.workspaceId)!).panels;
		const filterBuilderId = before.find((p) => p.kind === 'filter_builder')!.id;
		const panelEl = target.querySelector<HTMLElement>(`[data-panel-id="${filterBuilderId}"]`)!;

		panelEl.dispatchEvent(dragEvent('drop', instrumentDragTransfer()));
		flushSync();

		const after = readPanelState(deps.repository.get(deps.workspaceId)!).panels;
		expect(after, 'a rejected drop must change nothing').toEqual(before);

		unmount(instance);
	});
});
