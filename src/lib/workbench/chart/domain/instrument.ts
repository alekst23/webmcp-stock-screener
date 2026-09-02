// The instrument a chart points at, and the comparison series drawn beside it.
//
// `InstrumentRef` is a value snapshot, not a handle: a captured setup keeps one
// long after the directory entry it came from may have changed, so it carries
// the display fields it needs rather than promising to look them up again.
//
// Domain layer: pure types and pure validation, no I/O.
import type { AssetType } from '../../../discovery/ports';
import { isInstrumentId } from '../../../surface/ids';

export type InstrumentAssetType = AssetType;

export interface InstrumentRef {
	// Canonical and opaque. Never a bare ticker: a ticker is reassigned over
	// time and collides across venues.
	instrumentId: string;
	// Display ticker. Identity, not identifier.
	symbol: string;
	// ISO 10383 MIC of the listing venue.
	exchange: string;
	assetType: InstrumentAssetType;
}

// Comparing two differently priced instruments on one scale is meaningless
// without a normalization, so the mode is part of the comparison, not a
// chart-wide afterthought.
export type NormalizationMode = 'none' | 'percent_change' | 'indexed_100' | 'z_score';

export type NormalizationAnchor = 'window_start' | 'anchor_bar';

export interface Normalization {
	mode: NormalizationMode;
	anchor: NormalizationAnchor;
}

export interface ComparisonRef {
	instrument: InstrumentRef;
	normalization: Normalization;
}

export const NORMALIZATION_MODES: Record<NormalizationMode, true> = {
	none: true,
	percent_change: true,
	indexed_100: true,
	z_score: true
};

export const NORMALIZATION_ANCHORS: Record<NormalizationAnchor, true> = {
	window_start: true,
	anchor_bar: true
};

const ASSET_TYPES: Record<InstrumentAssetType, true> = {
	equity: true,
	etf: true,
	adr: true,
	fund: true,
	index: true,
	future: true,
	fx: true,
	crypto: true
};

// Reported rather than assumed: a comparison added without a mode is drawn
// under this one and the result says so.
export const DEFAULT_NORMALIZATION: Normalization = { mode: 'none', anchor: 'window_start' };

export function isNormalizationMode(value: unknown): value is NormalizationMode {
	return typeof value === 'string' && value in NORMALIZATION_MODES;
}

export function isNormalizationAnchor(value: unknown): value is NormalizationAnchor {
	return typeof value === 'string' && value in NORMALIZATION_ANCHORS;
}

export function isInstrumentAssetType(value: unknown): value is InstrumentAssetType {
	return typeof value === 'string' && value in ASSET_TYPES;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `field` is the caller's path to the value ('instrument', 'comparisons[0]'),
// so a rejection names the offending field rather than a bare type complaint.
export function validateInstrumentRef(value: unknown, field: string): string[] {
	if (!isRecord(value)) {
		return [`${field}: expected an instrument reference object.`];
	}
	const issues: string[] = [];
	if (!isInstrumentId(value.instrumentId)) {
		issues.push(
			`${field}.instrumentId: "${String(value.instrumentId)}" is not an instrument ID. ` +
				'Resolve the ticker through instrument search first; a bare ticker is never accepted.'
		);
	}
	if (typeof value.symbol !== 'string' || value.symbol.length === 0) {
		issues.push(`${field}.symbol: expected a non-empty display symbol.`);
	}
	if (typeof value.exchange !== 'string' || value.exchange.length === 0) {
		issues.push(`${field}.exchange: expected a non-empty exchange identifier.`);
	}
	if (!isInstrumentAssetType(value.assetType)) {
		issues.push(
			`${field}.assetType: "${String(value.assetType)}" is not one of ` +
				`${Object.keys(ASSET_TYPES).join(', ')}.`
		);
	}
	return issues;
}

export function validateNormalization(value: unknown, field: string): string[] {
	if (!isRecord(value)) {
		return [`${field}: expected a normalization object.`];
	}
	const issues: string[] = [];
	if (!isNormalizationMode(value.mode)) {
		issues.push(
			`${field}.mode: "${String(value.mode)}" is not one of ` +
				`${Object.keys(NORMALIZATION_MODES).join(', ')}.`
		);
	}
	if (!isNormalizationAnchor(value.anchor)) {
		issues.push(
			`${field}.anchor: "${String(value.anchor)}" is not one of ` +
				`${Object.keys(NORMALIZATION_ANCHORS).join(', ')}.`
		);
	}
	return issues;
}

export function validateComparisons(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		return [`${field}: expected an array of comparison instruments.`];
	}
	const issues: string[] = [];
	const seen = new Set<string>();
	value.forEach((entry, index) => {
		const path = `${field}[${index}]`;
		if (!isRecord(entry)) {
			issues.push(`${path}: expected a comparison object.`);
			return;
		}
		issues.push(...validateInstrumentRef(entry.instrument, `${path}.instrument`));
		issues.push(...validateNormalization(entry.normalization, `${path}.normalization`));
		const id = isRecord(entry.instrument) ? entry.instrument.instrumentId : undefined;
		if (typeof id === 'string') {
			if (seen.has(id)) {
				issues.push(`${path}.instrument.instrumentId: "${id}" is already a comparison.`);
			}
			seen.add(id);
		}
	});
	return issues;
}

// Copies field by field so the result shares no structure with its input: a
// captured setup must not change when the chart it came from is edited.
export function copyInstrumentRef(ref: InstrumentRef): InstrumentRef {
	return {
		instrumentId: ref.instrumentId,
		symbol: ref.symbol,
		exchange: ref.exchange,
		assetType: ref.assetType
	};
}

export function copyNormalization(normalization: Normalization): Normalization {
	return { mode: normalization.mode, anchor: normalization.anchor };
}

export function copyComparison(comparison: ComparisonRef): ComparisonRef {
	return {
		instrument: copyInstrumentRef(comparison.instrument),
		normalization: copyNormalization(comparison.normalization)
	};
}

// Normalize-on-read: a malformed persisted entry is dropped, never thrown on.
export function normalizeInstrumentRef(value: unknown): InstrumentRef | null {
	if (validateInstrumentRef(value, 'instrument').length > 0) {
		return null;
	}
	return copyInstrumentRef(value as InstrumentRef);
}

export function normalizeNormalization(value: unknown): Normalization {
	if (validateNormalization(value, 'normalization').length > 0) {
		return copyNormalization(DEFAULT_NORMALIZATION);
	}
	return copyNormalization(value as Normalization);
}

export function normalizeComparisons(value: unknown): ComparisonRef[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: ComparisonRef[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (!isRecord(entry)) {
			continue;
		}
		const instrument = normalizeInstrumentRef(entry.instrument);
		if (!instrument || seen.has(instrument.instrumentId)) {
			continue;
		}
		seen.add(instrument.instrumentId);
		out.push({ instrument, normalization: normalizeNormalization(entry.normalization) });
	}
	return out;
}
