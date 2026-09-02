import { describe, expect, it } from 'vitest';
import {
	DEFAULT_ALERT_NOISE_THRESHOLD,
	PREVIEW_FIRINGS_LIST_CAP,
	summarizePreview,
	type AlertFiringEvent
} from './alertPreview';

const WINDOW = { start: '2026-06-01', end: '2026-08-31' };

function firing(instrumentId: string, firedAt: string): AlertFiringEvent {
	return { instrumentId, firedAt };
}

describe('summarizePreview', () => {
	it('reports zero firings plainly, not as an error (AC7)', () => {
		const report = summarizePreview({
			window: WINDOW,
			evaluation: { firings: [], evaluatedDays: 60, warnings: [] }
		});
		expect(report.firingCount).toBe(0);
		expect(report.firingRate).toBe(0);
		expect(report.noisy).toBe(false);
		expect(report.instruments).toEqual([]);
	});

	it('counts firings and computes the firing rate per evaluated day', () => {
		const report = summarizePreview({
			window: WINDOW,
			evaluation: {
				firings: [firing('inst:A', '2026-06-01'), firing('inst:B', '2026-06-02')],
				evaluatedDays: 4,
				warnings: []
			}
		});
		expect(report.firingCount).toBe(2);
		expect(report.firingRate).toBe(0.5);
	});

	it('lists unique, sorted instruments that fired', () => {
		const report = summarizePreview({
			window: WINDOW,
			evaluation: {
				firings: [
					firing('inst:B', '2026-06-01'),
					firing('inst:A', '2026-06-01'),
					firing('inst:B', '2026-06-02')
				],
				evaluatedDays: 10,
				warnings: []
			}
		});
		expect(report.instruments).toEqual(['inst:A', 'inst:B']);
	});

	it('warns and reports zero rate when there are no evaluable trading days', () => {
		const report = summarizePreview({
			window: WINDOW,
			evaluation: { firings: [], evaluatedDays: 0, warnings: [] }
		});
		expect(report.firingRate).toBe(0);
		expect(report.warnings).toContain('The window had no evaluable trading days.');
	});

	it('flags a preview as noisy when the firing rate exceeds the threshold, naming the rate (AC6)', () => {
		const report = summarizePreview({
			window: WINDOW,
			evaluation: {
				firings: Array.from({ length: 20 }, (_, i) => firing(`inst:${i}`, '2026-06-01')),
				evaluatedDays: 5,
				warnings: []
			},
			noiseThreshold: 1
		});
		expect(report.firingRate).toBe(4);
		expect(report.noisy).toBe(true);
		expect(report.noiseThreshold).toBe(1);
	});

	it('is not noisy at exactly the threshold', () => {
		const report = summarizePreview({
			window: WINDOW,
			evaluation: {
				firings: Array.from({ length: 5 }, (_, i) => firing(`inst:${i}`, '2026-06-01')),
				evaluatedDays: 5,
				warnings: []
			},
			noiseThreshold: 1
		});
		expect(report.firingRate).toBe(1);
		expect(report.noisy).toBe(false);
	});

	it('uses the default noise threshold when none is supplied', () => {
		const report = summarizePreview({
			window: WINDOW,
			evaluation: { firings: [firing('inst:A', '2026-06-01')], evaluatedDays: 1, warnings: [] }
		});
		expect(report.noiseThreshold).toBe(DEFAULT_ALERT_NOISE_THRESHOLD);
	});

	it('caps the returned firings list and reports the truncation', () => {
		const many = Array.from({ length: PREVIEW_FIRINGS_LIST_CAP + 25 }, (_, i) =>
			firing(`inst:${i}`, '2026-06-01')
		);
		const report = summarizePreview({
			window: WINDOW,
			evaluation: { firings: many, evaluatedDays: 1, warnings: [] }
		});
		expect(report.firings).toHaveLength(PREVIEW_FIRINGS_LIST_CAP);
		expect(report.firingsTruncated).toBe(true);
		expect(report.warnings.some((w) => w.includes('Showing the first'))).toBe(true);
		// The full count is still what drove the (very noisy) rate.
		expect(report.firingCount).toBe(PREVIEW_FIRINGS_LIST_CAP + 25);
	});

	it('carries the port warnings through untouched', () => {
		const report = summarizePreview({
			window: WINDOW,
			evaluation: {
				firings: [],
				evaluatedDays: 10,
				warnings: ['no historical data source configured']
			}
		});
		expect(report.warnings).toContain('no historical data source configured');
	});
});
