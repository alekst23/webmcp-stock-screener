// Real render tests, following the precedent already established by
// src/lib/workbench/chart/components/ChartPanel.test.ts's use of Svelte's own
// mount/flushSync/unmount under the existing jsdom vitest environment -- not
// a new test harness.
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { makeProvenance } from '../../../domain/provenance';
import { makeFeatureWeightSet } from '../../domain/contract';
import type { SimilarityCandidate, SimilarityRun } from '../../domain/contract';
import SimilarOpportunitiesPanel from './SimilarOpportunitiesPanel.svelte';

const PROVENANCE = makeProvenance({
	asOf: '2026-09-02T20:00:00.000Z',
	sourceId: 'src.panel.mock',
	sourceLabel: 'Mock Panel',
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted',
	liveness: 'end_of_day'
});

function candidate(id: string, score: number): SimilarityCandidate {
	return {
		candidateId: id,
		instrument: {
			instrumentId: `inst:XNAS:${id}`,
			symbol: id,
			exchange: 'XNAS',
			assetType: 'equity'
		},
		window: { start: '2026-01-01', end: '2026-01-10', timeframe: '1d' },
		score,
		perFamilySimilarity: { price_shape: 0.9, volume: 0.5 },
		unavailableFamilies: ['relative_strength']
	};
}

function run(candidates: SimilarityCandidate[], warnings: string[] = []): SimilarityRun {
	return {
		runId: 'run_1',
		referenceSetupId: 'setup_1',
		scope: 'cross_instrument',
		weights: makeFeatureWeightSet(),
		normalization: { mode: 'percent_change', anchor: 'window_start' },
		provenance: PROVENANCE,
		candidates,
		warnings
	};
}

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
	run?: SimilarityRun | null;
	selectedCandidateId?: string | null;
	onSelectCandidate?: (id: string) => void;
}): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(SimilarOpportunitiesPanel, { target, props });
	flushSync();
	return target;
}

describe('SimilarOpportunitiesPanel', () => {
	it('mounts safely with no props at all (the live container passes none today)', () => {
		const el = render({});
		expect(el.querySelector('[data-state="unbound"]')?.textContent).toContain('No similarity run');
	});

	it('shows an explicit empty-run state, distinct from unbound, carrying the run warning', () => {
		const el = render({ run: run([], ['No candidates cleared the minimum score.']) });
		const empty = el.querySelector('[data-state="empty-run"]');
		expect(empty, 'expected an empty-run state distinguishable from "unbound"').toBeTruthy();
		expect(empty?.textContent).toContain('No candidates cleared the minimum score.');
		expect(el.querySelector('[data-state="unbound"]')).toBeNull();
	});

	it('renders candidates ranked by score with feature context, never a bare score', () => {
		const el = render({ run: run([candidate('LOW', 0.2), candidate('HIGH', 0.9)]) });
		const rows = el.querySelectorAll('.candidate');
		expect(rows).toHaveLength(2);
		expect(rows[0]?.querySelector('.symbol')?.textContent).toBe('HIGH');
		expect(rows[0]?.querySelector('.score')?.textContent).toBe('90%');
		expect(
			rows[0]?.querySelectorAll('.family-chip').length,
			'every candidate must show feature-family context alongside its score'
		).toBeGreaterThan(0);
	});

	it('shows unavailable families distinctly, not as a zero-valued family chip', () => {
		const el = render({ run: run([candidate('A', 0.5)]) });
		const unavailable = el.querySelector('.family-chip.unavailable');
		expect(unavailable?.textContent).toContain('relative strength');
		expect(unavailable?.textContent).toContain('unavailable');
	});

	it('displays market-data provenance and normalization in the panel body', () => {
		const el = render({ run: run([candidate('A', 0.5)]) });
		const text = el.textContent ?? '';
		expect(text).toContain('percent_change');
		expect(text).toContain('Mock Panel');
		expect(text).toContain('end_of_day');
	});

	it('calls onSelectCandidate with the clicked candidate id, and reflects selection via aria-pressed', () => {
		const selected: string[] = [];
		const el = render({
			run: run([candidate('A', 0.5), candidate('B', 0.7)]),
			selectedCandidateId: 'B',
			onSelectCandidate: (id) => selected.push(id)
		});
		const buttons = el.querySelectorAll('.candidate');
		const selectedButton = [...buttons].find(
			(b) => b.querySelector('.symbol')?.textContent === 'B'
		);
		expect(
			selectedButton?.getAttribute('aria-pressed'),
			'the selected candidate must be marked pressed'
		).toBe('true');
		const otherButton = [...buttons].find((b) => b.querySelector('.symbol')?.textContent === 'A');
		(otherButton as HTMLButtonElement).click();
		expect(selected, 'clicking a candidate must report its id via onSelectCandidate').toEqual([
			'A'
		]);
	});
});
