// Real render tests, following the precedent ChartPanel.test.ts and
// T-1012-6's SimilarOpportunitiesPanel.test.ts already established:
// Svelte's own mount/flushSync/unmount under the existing jsdom vitest
// environment, not a new harness.
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { makeProvenance } from '../../../domain/provenance';
import type { ComparisonView } from '../domain/comparisonView';
import ComparisonPanel from './ComparisonPanel.svelte';
import type { ComparisonSeries } from './ComparisonPanel.svelte';

const PROVENANCE = makeProvenance({
	asOf: '2026-09-02T20:00:00.000Z',
	sourceId: 'src.mock',
	sourceLabel: 'Mock',
	timezone: 'UTC',
	liveness: 'historical'
});

function bars(closes: number[]): ComparisonSeries['bars'] {
	return closes.map((close, i) => ({
		time: `2026-01-${String(i + 1).padStart(2, '0')}`,
		open: close,
		high: close + 1,
		low: close - 1,
		close,
		volume: 100
	}));
}

function view(form: ComparisonView['form'], warnings: string[] = []): ComparisonView {
	return {
		runId: 'run_1',
		referenceSetupId: 'setup_1',
		form,
		candidateIds: ['A', 'B'],
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		provenance: PROVENANCE,
		warnings
	};
}

const REFERENCE: ComparisonSeries = {
	id: 'setup_1',
	label: 'Reference',
	bars: bars([100, 102, 105])
};
const CAND_A: ComparisonSeries = { id: 'A', label: 'A', bars: bars([50, 51, 53]) };
const CAND_B: ComparisonSeries = { id: 'B', label: 'B', bars: bars([200, 190, 210]) };

let target: HTMLElement;
let instance: unknown;

afterEach(() => {
	if (instance) {
		unmount(instance);
		instance = undefined;
	}
	target.remove();
});

function render(props: {
	view: ComparisonView;
	reference?: ComparisonSeries | null;
	candidates?: ComparisonSeries[];
}): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(ComparisonPanel, { target, props });
	flushSync();
	return target;
}

describe('ComparisonPanel', () => {
	it('renders an overlay with one line per series, the reference visually distinguished', () => {
		const el = render({
			view: view('overlay'),
			reference: REFERENCE,
			candidates: [CAND_A, CAND_B]
		});
		const lines = el.querySelectorAll('.overlay-chart .series-line');
		expect(lines).toHaveLength(3);
		expect(el.querySelectorAll('.overlay-chart .reference-line')).toHaveLength(1);
		expect(el.querySelectorAll('.legend .is-reference')).toHaveLength(1);
	});

	it('renders small multiples as a grid of separate mini charts, one per series', () => {
		const el = render({
			view: view('small_multiples'),
			reference: REFERENCE,
			candidates: [CAND_A, CAND_B]
		});
		const tiles = el.querySelectorAll('.multiples-grid figure');
		expect(tiles).toHaveLength(3);
		expect(el.querySelectorAll('.multiples-grid figure.is-reference')).toHaveLength(1);
	});

	it('renders synchronized charts as a stack, one row per series including the reference', () => {
		const el = render({
			view: view('synchronized_charts'),
			reference: REFERENCE,
			candidates: [CAND_A]
		});
		const rows = el.querySelectorAll('.synchronized-row');
		expect(rows).toHaveLength(2);
		expect(el.querySelectorAll('.synchronized-row.is-reference')).toHaveLength(1);
	});

	it('states the normalization settings actually applied, on screen', () => {
		const el = render({ view: view('overlay'), reference: REFERENCE, candidates: [CAND_A] });
		const text = el.querySelector('.normalization')?.textContent ?? '';
		expect(text).toContain('percent_change');
		expect(text).toContain('window_start');
	});

	it('states the market-data provenance', () => {
		const el = render({ view: view('overlay'), reference: REFERENCE, candidates: [CAND_A] });
		const text = el.textContent ?? '';
		expect(text).toContain('Mock');
		expect(text).toContain('historical');
	});

	it('surfaces the capping/warning text from the view (AC9)', () => {
		const el = render({
			view: view('overlay', ['Showing the first 6: A, B. Not shown: C.']),
			reference: REFERENCE,
			candidates: [CAND_A]
		});
		expect(el.textContent).toContain('Showing the first 6');
	});
});
