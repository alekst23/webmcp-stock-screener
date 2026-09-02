import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../../catalog/registry';
import type { RangeCondition, StudyOutputCondition } from '../../../screener/conditions';
import type {
	CapturedAnnotation,
	CapturedChartSetup,
	CapturedStudy
} from '../../chart/domain/capturedSetup';
import { makeProvenance } from '../../domain/provenance';
import { createIdSequencer } from '../../domain/ids';
import {
	DRAFT_PRICE_TOLERANCE,
	MAX_DRAFT_CONDITIONS,
	deriveDraftConditions
} from './deriveFilters';

const provenance = makeProvenance({
	asOf: '2026-01-01T00:00:00.000Z',
	sourceId: 'src.prices.eodhd',
	sourceLabel: 'EODHD',
	liveness: 'end_of_day',
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted'
});

function study(overrides: Partial<CapturedStudy> = {}): CapturedStudy {
	return {
		studyId: 'study_1',
		catalogItemId: 'study.sma',
		params: { length: 20 },
		pane: 'price_overlay',
		order: 0,
		enabled: true,
		...overrides
	};
}

function priceLevel(
	price: number,
	overrides: Partial<CapturedAnnotation> = {}
): CapturedAnnotation {
	return {
		annotationId: 'annotation_1',
		kind: 'price_level',
		anchors: { kind: 'price_level', price },
		priceAdjustment: 'adjusted',
		...overrides
	};
}

function setup(overrides: Partial<CapturedChartSetup> = {}): CapturedChartSetup {
	return {
		setupId: 'setup_1',
		capturedAt: '2026-01-01T00:00:00.000Z',
		workspaceRevision: 1,
		sourcePanelId: 'panel_1',
		instrument: {
			instrumentId: 'inst:XNAS:AAPL',
			symbol: 'AAPL',
			exchange: 'XNAS',
			assetType: 'equity'
		},
		window: {
			start: '2025-07-01T00:00:00.000Z',
			end: '2026-01-01T00:00:00.000Z',
			timeframe: '1d',
			session: 'regular',
			barCount: 128
		},
		candleType: 'candlestick',
		scale: 'linear',
		priceAdjustment: 'adjusted',
		normalization: { mode: 'none', anchor: 'window_start' },
		studies: [],
		comparisons: [],
		annotations: [],
		provenance,
		...overrides
	};
}

describe('deriveDraftConditions -- studies', () => {
	it('derives one study_output condition per enabled study, traceable to it', () => {
		const result = deriveDraftConditions(
			setup({ studies: [study()] }),
			builtinCatalogRegistry,
			createIdSequencer()
		);
		expect(result.tree.kind).toBe('group');
		const [node] = result.tree.kind === 'group' ? result.tree.children : [];
		expect(node?.kind).toBe('condition');
		const condition = node?.kind === 'condition' ? (node.condition as StudyOutputCondition) : null;
		expect(condition).toMatchObject({
			type: 'study_output',
			studyId: 'study.sma',
			outputName: 'sma',
			predicate: 'rising'
		});
		expect(condition?.params).toEqual({ length: 20 });
		expect(result.provenance).toHaveLength(1);
		expect(result.provenance[0]?.characteristic).toBe('study');
		expect(result.provenance[0]?.explanation).toContain('Simple moving average');
		expect(result.warnings).toEqual([]);
	});

	it('ignores a disabled study -- it did not characterize the setup', () => {
		const result = deriveDraftConditions(
			setup({ studies: [study({ enabled: false })] }),
			builtinCatalogRegistry,
			createIdSequencer()
		);
		expect(result.tree.kind === 'group' ? result.tree.children : []).toHaveLength(0);
	});

	it('AC7: an unavailable study is derived disabled, with a warning naming it and why', () => {
		const result = deriveDraftConditions(
			setup({ studies: [study({ catalogItemId: 'study.rsi', params: { length: 14 } })] }),
			builtinCatalogRegistry,
			createIdSequencer()
		);
		const [node] = result.tree.kind === 'group' ? result.tree.children : [];
		expect(node?.enabled).toBe(false);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('study.rsi');
		expect(result.warnings[0]).toMatch(/calculation engine|engine/i);
	});

	it("orders derived study conditions by the chart's own study order", () => {
		const result = deriveDraftConditions(
			setup({
				studies: [
					study({ studyId: 'study_2', catalogItemId: 'study.ema', order: 1 }),
					study({ studyId: 'study_1', catalogItemId: 'study.sma', order: 0 })
				]
			}),
			builtinCatalogRegistry,
			createIdSequencer()
		);
		const children = result.tree.kind === 'group' ? result.tree.children : [];
		const studyIds = children.map((c) =>
			c.kind === 'condition' ? (c.condition as StudyOutputCondition).studyId : ''
		);
		expect(studyIds).toEqual(['study.sma', 'study.ema']);
	});
});

describe('deriveDraftConditions -- annotations', () => {
	it('derives a tolerance-banded range condition from a price_level annotation', () => {
		const result = deriveDraftConditions(
			setup({ annotations: [priceLevel(100)] }),
			builtinCatalogRegistry,
			createIdSequencer()
		);
		const [node] = result.tree.kind === 'group' ? result.tree.children : [];
		const condition = node?.kind === 'condition' ? (node.condition as RangeCondition) : null;
		expect(condition?.type).toBe('range');
		expect(condition?.fieldId).toBe('field.price.close');
		expect(condition?.lower).toBeCloseTo(100 * (1 - DRAFT_PRICE_TOLERANCE));
		expect(condition?.upper).toBeCloseTo(100 * (1 + DRAFT_PRICE_TOLERANCE));
		expect(condition?.lowerInclusive).toBe(true);
		expect(condition?.upperInclusive).toBe(true);
		expect(result.provenance[0]?.characteristic).toBe('annotation.price_level');
	});

	it("spans a trendline's two endpoints, not just one", () => {
		const trendline: CapturedAnnotation = {
			annotationId: 'annotation_1',
			kind: 'trendline',
			anchors: {
				kind: 'trendline',
				from: { time: '2025-08-01T00:00:00.000Z', price: 90 },
				to: { time: '2025-12-01T00:00:00.000Z', price: 110 }
			},
			priceAdjustment: 'adjusted'
		};
		const result = deriveDraftConditions(
			setup({ annotations: [trendline] }),
			builtinCatalogRegistry,
			createIdSequencer()
		);
		const [node] = result.tree.kind === 'group' ? result.tree.children : [];
		const condition = node?.kind === 'condition' ? (node.condition as RangeCondition) : null;
		expect(condition?.lower).toBeCloseTo(90 * (1 - DRAFT_PRICE_TOLERANCE));
		expect(condition?.upper).toBeCloseTo(110 * (1 + DRAFT_PRICE_TOLERANCE));
	});

	it('does not map a date_range or setup_window annotation -- they carry no price', () => {
		const dateRange: CapturedAnnotation = {
			annotationId: 'annotation_1',
			kind: 'date_range',
			anchors: {
				kind: 'date_range',
				start: '2025-08-01T00:00:00.000Z',
				end: '2025-09-01T00:00:00.000Z'
			},
			priceAdjustment: 'adjusted'
		};
		const result = deriveDraftConditions(
			setup({ annotations: [dateRange] }),
			builtinCatalogRegistry,
			createIdSequencer()
		);
		expect(result.warnings).toHaveLength(1); // nothing derivable
		expect(result.tree.kind === 'group' ? result.tree.children : []).toHaveLength(0);
	});
});

describe('deriveDraftConditions -- AC8 nothing derivable', () => {
	it('returns an empty draft with an explanatory warning, not an error', () => {
		const result = deriveDraftConditions(setup(), builtinCatalogRegistry, createIdSequencer());
		expect(result.tree.kind).toBe('group');
		expect(result.tree.kind === 'group' ? result.tree.children : []).toEqual([]);
		expect(result.provenance).toEqual([]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/nothing/i);
	});
});

describe('deriveDraftConditions -- brevity cap', () => {
	it('caps the draft at MAX_DRAFT_CONDITIONS and warns about what was left out', () => {
		const many = Array.from({ length: MAX_DRAFT_CONDITIONS + 3 }, (_, i) =>
			priceLevel(100 + i, { annotationId: `annotation_${i}` })
		);
		const result = deriveDraftConditions(
			setup({ annotations: many }),
			builtinCatalogRegistry,
			createIdSequencer()
		);
		const children = result.tree.kind === 'group' ? result.tree.children : [];
		expect(children).toHaveLength(MAX_DRAFT_CONDITIONS);
		expect(result.warnings.some((w) => w.includes('3 additional'))).toBe(true);
	});
});
