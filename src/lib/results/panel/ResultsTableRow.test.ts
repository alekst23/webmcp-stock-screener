// T-0027-2: proves a results row is draggable and carries the exact
// PanelSourceRef panels/domain/dragSource.ts's PANEL_SOURCE_DRAG_MIME wire
// format expects, built by resultRowDrag.ts's own resultRowToPanelSource.
import { describe, expect, it } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import type { ProjectedRow } from '../domain/projection';
import { PANEL_SOURCE_DRAG_MIME, parsePanelSourceDrag } from '../../panels/domain/dragSource';
import { resultRowToPanelSource } from './resultRowDrag';
import ResultsTableRow from './ResultsTableRow.svelte';

// jsdom does not implement DataTransfer (nor DragEvent's `dataTransfer`
// constructor option) -- this is the minimal subset ResultsTableRow.svelte's
// handleDragStart actually calls (setData, effectAllowed).
class FakeDataTransfer {
	private readonly store = new Map<string, string>();
	effectAllowed = 'none';
	setData(format: string, data: string): void {
		this.store.set(format, data);
	}
	getData(format: string): string {
		return this.store.get(format) ?? '';
	}
}

function row(): ProjectedRow {
	return {
		resultId: 'result_1',
		instrumentId: 'inst:XNAS:AAPL',
		ticker: 'AAPL',
		rank: 1,
		compositeScore: 0.9,
		columns: {},
		groupValue: null
	};
}

function mountRow(r: ProjectedRow) {
	const target = document.createElement('table');
	document.body.appendChild(target);
	const tbody = document.createElement('tbody');
	target.appendChild(tbody);
	const instance = mount(ResultsTableRow, {
		target: tbody,
		props: {
			row: r,
			columns: [],
			formattingRules: [],
			selected: false,
			onToggle: () => {},
			onExplain: () => {}
		}
	});
	flushSync();
	return { target, instance };
}

describe('ResultsTableRow drag source (T-0027-2)', () => {
	it('is draggable', () => {
		const { target, instance } = mountRow(row());
		const tr = target.querySelector('tr.row');
		expect(tr?.getAttribute('draggable')).toBe('true');
		unmount(instance);
	});

	it("carries the row's PanelSourceRef on the panel-source drag MIME type when dragged", () => {
		const r = row();
		const { target, instance } = mountRow(r);
		const tr = target.querySelector('tr.row')!;

		const dataTransfer = new FakeDataTransfer();
		const event = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent;
		Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
		tr.dispatchEvent(event);

		const raw = dataTransfer.getData(PANEL_SOURCE_DRAG_MIME);
		expect(
			raw.length,
			'expected a non-empty payload on the panel-source drag MIME type'
		).toBeGreaterThan(0);
		expect(parsePanelSourceDrag(raw)).toEqual(resultRowToPanelSource(r));
		expect(dataTransfer.effectAllowed).toBe('copy');
		unmount(instance);
	});
});
