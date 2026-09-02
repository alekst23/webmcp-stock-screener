// Putting a comparison instrument on the same axis as the primary series.
//
// Two instruments at $30 and $900 drawn on one price axis tell you nothing: the
// cheaper one is a flat line along the bottom. The chart's answer is the
// comparison's own `Normalization`, and the drawing problem it creates is that
// a normalized series is no longer in price units, so it cannot share the price
// axis it was supposed to share.
//
// This module resolves that by normalizing BOTH series under the comparison's
// mode and then mapping the comparison back through the primary's own
// normalization. The result is in the primary's price units, so one price axis
// stays correct for both curves and the comparison's shape is the shape of its
// relative move. `normalized` is kept alongside for a readout that wants to
// state the comparison in the mode's own units.
//
// Pure functions over plain numbers; nothing here touches the DOM.
import type { Normalization, NormalizationMode } from '../domain/instrument';

export type SeriesValue = number | null;

export interface ProjectedSeries {
	mode: NormalizationMode;
	anchorIndex: number;
	// In the primary series' price units, index-aligned with the primary bars.
	values: SeriesValue[];
	// In the mode's own units (percent, index points, standard deviations).
	normalized: SeriesValue[];
	// What the comparison's own numbers mean, for a legend that must not imply
	// the comparison is trading at the primary's prices.
	unitLabel: string;
}

const UNIT_LABELS: Record<NormalizationMode, string> = {
	none: 'price',
	percent_change: '% change',
	indexed_100: 'indexed to 100',
	z_score: 'standard deviations'
};

function at(values: readonly SeriesValue[], index: number): number | null {
	const value = values[index];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// The first usable value at or after the anchor. An anchor that lands on a
// warm-up hole would otherwise make every rebased value null.
function anchorValue(values: readonly SeriesValue[], anchorIndex: number): number | null {
	for (let index = Math.max(0, anchorIndex); index < values.length; index += 1) {
		const value = at(values, index);
		if (value !== null && value !== 0) {
			return value;
		}
	}
	return null;
}

interface Moments {
	mean: number;
	deviation: number;
}

function moments(values: readonly SeriesValue[]): Moments | null {
	const usable = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	if (usable.length === 0) {
		return null;
	}
	const mean = usable.reduce((total, v) => total + v, 0) / usable.length;
	const variance = usable.reduce((total, v) => total + (v - mean) ** 2, 0) / usable.length;
	const deviation = Math.sqrt(variance);
	// A flat series has no spread to standardize by; every point is its own
	// mean, so it standardizes to zero rather than to a division by zero.
	return { mean, deviation: deviation === 0 ? 1 : deviation };
}

export function normalizeSeries(
	values: readonly SeriesValue[],
	mode: NormalizationMode,
	anchorIndex: number
): SeriesValue[] {
	if (mode === 'none') {
		return [...values];
	}
	if (mode === 'z_score') {
		const stats = moments(values);
		return stats === null
			? values.map(() => null)
			: values.map((value) =>
					typeof value === 'number' && Number.isFinite(value)
						? (value - stats.mean) / stats.deviation
						: null
				);
	}
	const base = anchorValue(values, anchorIndex);
	if (base === null) {
		return values.map(() => null);
	}
	// indexed_100 states the anchor as 100; percent_change states it as 0.
	const offset = mode === 'indexed_100' ? 0 : -100;
	return values.map((value) =>
		typeof value === 'number' && Number.isFinite(value) ? (value / base) * 100 + offset : null
	);
}

// `window_start` is the first bar of the window; `anchor_bar` is the bar the
// caller nominated, defaulting to the first when it named none.
export function resolveAnchorIndex(normalization: Normalization, anchorBarIndex?: number): number {
	if (normalization.anchor === 'anchor_bar' && typeof anchorBarIndex === 'number') {
		return Math.max(0, anchorBarIndex);
	}
	return 0;
}

// Maps the comparison into the primary's price units under the comparison's
// mode. `none` overlays raw prices, which is only meaningful for two similarly
// priced instruments -- the caller asked for it, so it is drawn as asked.
export function projectComparison(
	primary: readonly SeriesValue[],
	comparison: readonly SeriesValue[],
	normalization: Normalization,
	anchorBarIndex?: number
): ProjectedSeries {
	const anchorIndex = resolveAnchorIndex(normalization, anchorBarIndex);
	const mode = normalization.mode;
	const normalized = normalizeSeries(comparison, mode, anchorIndex);
	return {
		mode,
		anchorIndex,
		values: projectOntoPrimary(primary, comparison, mode, anchorIndex),
		normalized,
		unitLabel: UNIT_LABELS[mode]
	};
}

function projectOntoPrimary(
	primary: readonly SeriesValue[],
	comparison: readonly SeriesValue[],
	mode: NormalizationMode,
	anchorIndex: number
): SeriesValue[] {
	if (mode === 'none') {
		return [...comparison];
	}
	if (mode === 'z_score') {
		const stats = moments(primary);
		const zs = normalizeSeries(comparison, 'z_score', anchorIndex);
		return stats === null
			? zs.map(() => null)
			: zs.map((z) => (z === null ? null : stats.mean + stats.deviation * z));
	}
	// percent_change and indexed_100 are the same curve once mapped onto the
	// price axis -- both rebase at the anchor -- and differ only in the units
	// their own readout is stated in.
	const primaryBase = anchorValue(primary, anchorIndex);
	const comparisonBase = anchorValue(comparison, anchorIndex);
	if (primaryBase === null || comparisonBase === null) {
		return comparison.map(() => null);
	}
	return comparison.map((value) =>
		typeof value === 'number' && Number.isFinite(value)
			? (value / comparisonBase) * primaryBase
			: null
	);
}
