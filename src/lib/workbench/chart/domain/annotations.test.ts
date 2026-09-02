import { describe, expect, it } from 'vitest';
import { createIdSequencer } from '../../domain/ids';
import type { AnnotationInput, AnnotationResult, ChartAnnotation } from './annotations';
import {
	ANNOTATION_KINDS,
	annotationPrices,
	annotationTimes,
	copyAnnotation,
	createAnnotation,
	isAnnotationStale,
	normalizeAnnotations,
	staleAnnotationIds,
	validateAnnotationAnchors
} from './annotations';
import { CHART_PRICE_ADJUSTMENTS } from './chartState';

const SEP = '2026-09-01T00:00:00.000Z';
const OCT = '2026-10-01T00:00:00.000Z';

function expectOk(result: AnnotationResult): ChartAnnotation {
	if (!result.ok) {
		throw new Error(`expected an annotation, got: ${result.issues.join('; ')}`);
	}
	return result.annotation;
}

function expectFailed(result: AnnotationResult): string[] {
	if (result.ok) {
		throw new Error('expected the annotation to be rejected');
	}
	return result.issues;
}

function input(overrides: Partial<AnnotationInput>): AnnotationInput {
	return {
		id: 'annotation_1',
		kind: 'price_level',
		anchors: { kind: 'price_level', price: 231.5 },
		priceAdjustment: 'adjusted',
		...overrides
	};
}

const wellFormedAnchors = {
	trendline: {
		kind: 'trendline',
		from: { time: SEP, price: 210 },
		to: { time: OCT, price: 240 }
	},
	price_level: { kind: 'price_level', price: 231.5 },
	date_range: { kind: 'date_range', start: SEP, end: OCT },
	setup_window: { kind: 'setup_window', start: SEP, end: OCT },
	label: { kind: 'label', at: { time: SEP, price: 210 }, text: 'breakout' }
} as const;

describe('all five annotation kinds', () => {
	it('constructs each kind at its own anchors with its own stable ID', () => {
		const kinds = Object.keys(ANNOTATION_KINDS) as (keyof typeof wellFormedAnchors)[];
		const built = kinds.map((kind, i) =>
			expectOk(
				createAnnotation(
					input({ id: `annotation_${i + 1}`, kind, anchors: wellFormedAnchors[kind] })
				)
			)
		);
		expect(built.map((a) => a.kind)).toEqual(kinds);
		expect(new Set(built.map((a) => a.id)).size).toBe(kinds.length);
	});

	it('covers exactly the five kinds the spec names', () => {
		expect(Object.keys(ANNOTATION_KINDS).sort()).toEqual([
			'date_range',
			'label',
			'price_level',
			'setup_window',
			'trendline'
		]);
	});
});

describe('anchors belonging to a different kind', () => {
	it('rejects a trendline given a price level’s single price, naming what was expected', () => {
		const issues = expectFailed(
			createAnnotation(input({ kind: 'trendline', anchors: wellFormedAnchors.price_level }))
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain('does not match the annotation kind "trendline"');
		expect(issues[0]).toContain('two {time, price} points');
	});

	it('rejects a date range given a price', () => {
		const issues = expectFailed(
			createAnnotation(input({ kind: 'date_range', anchors: { kind: 'date_range', price: 100 } }))
		);
		expect(issues.some((i) => i.includes('anchors.start'))).toBe(true);
	});

	it('rejects a trendline given only one point', () => {
		const issues = expectFailed(
			createAnnotation(
				input({
					kind: 'trendline',
					anchors: { kind: 'trendline', from: { time: SEP, price: 210 } }
				})
			)
		);
		expect(issues.some((i) => i.includes('anchors.to'))).toBe(true);
	});

	it('rejects a trendline whose two points are the same point', () => {
		const point = { time: SEP, price: 210 };
		const issues = expectFailed(
			createAnnotation(
				input({ kind: 'trendline', anchors: { kind: 'trendline', from: point, to: point } })
			)
		);
		expect(issues[0]).toContain('two distinct points');
	});

	it('rejects a label with no text', () => {
		const issues = expectFailed(
			createAnnotation(
				input({
					kind: 'label',
					anchors: { kind: 'label', at: { time: SEP, price: 1 }, text: '  ' }
				})
			)
		);
		expect(issues).toEqual(['anchors.text: a label needs non-empty text.']);
	});
});

describe('inverted and non-finite anchors', () => {
	it('rejects a date range whose end precedes its start', () => {
		const issues = expectFailed(
			createAnnotation(
				input({ kind: 'date_range', anchors: { kind: 'date_range', start: OCT, end: SEP } })
			)
		);
		expect(issues).toEqual(['anchors.end: must be after anchors.start.']);
	});

	it('rejects a setup window whose end precedes its start', () => {
		const issues = expectFailed(
			createAnnotation(
				input({ kind: 'setup_window', anchors: { kind: 'setup_window', start: OCT, end: SEP } })
			)
		);
		expect(issues).toEqual(['anchors.end: must be after anchors.start.']);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, 'expensive'])(
		'rejects a price level anchored at %s',
		(price) => {
			const issues = expectFailed(
				createAnnotation(input({ anchors: { kind: 'price_level', price } }))
			);
			expect(issues[0]).toContain('anchors.price');
		}
	);

	it('rejects a non-ISO anchor time', () => {
		const issues = expectFailed(
			createAnnotation(
				input({
					kind: 'date_range',
					anchors: { kind: 'date_range', start: 'last tuesday', end: OCT }
				})
			)
		);
		expect(issues[0]).toContain('anchors.start');
	});
});

describe('the price-adjustment stamp', () => {
	it('records the policy in force when the annotation was drawn', () => {
		const annotation = expectOk(createAnnotation(input({ priceAdjustment: 'unadjusted' })));
		expect(annotation.priceAdjustment).toBe('unadjusted');
	});

	it('marks a price-bearing annotation stale once the chart policy changes', () => {
		const level = expectOk(createAnnotation(input({ priceAdjustment: 'unadjusted' })));
		expect(isAnnotationStale(level, 'unadjusted')).toBe(false);
		expect(isAnnotationStale(level, 'adjusted')).toBe(true);
	});

	it('leaves a time-only annotation fresh, because bar times survive a policy change', () => {
		const range = expectOk(
			createAnnotation(
				input({
					kind: 'date_range',
					anchors: wellFormedAnchors.date_range,
					priceAdjustment: 'unadjusted'
				})
			)
		);
		expect(isAnnotationStale(range, 'adjusted')).toBe(false);
	});

	it('reports exactly the stale IDs across a mixed list', () => {
		const level = expectOk(
			createAnnotation(input({ id: 'annotation_1', priceAdjustment: 'unadjusted' }))
		);
		const trendline = expectOk(
			createAnnotation(
				input({ id: 'annotation_2', kind: 'trendline', anchors: wellFormedAnchors.trendline })
			)
		);
		const range = expectOk(
			createAnnotation(
				input({
					id: 'annotation_3',
					kind: 'date_range',
					anchors: wellFormedAnchors.date_range,
					priceAdjustment: 'unadjusted'
				})
			)
		);
		expect(staleAnnotationIds([level, trendline, range], 'adjusted')).toEqual(['annotation_1']);
	});

	it('rejects an unknown policy', () => {
		const issues = expectFailed(
			createAnnotation(input({ priceAdjustment: 'inflation_adjusted' as never }))
		);
		expect(issues[0]).toContain('price_adjustment');
	});

	// The module keeps its own compile-time-exhaustive membership table so it
	// needs no runtime import from chartState; this guards the two from drifting.
	it('knows the same policies chartState declares', () => {
		for (const policy of Object.keys(CHART_PRICE_ADJUSTMENTS)) {
			const result = createAnnotation(input({ priceAdjustment: policy as never }));
			expect(result.ok).toBe(true);
		}
	});
});

describe('anchor accessors', () => {
	it('exposes the times and prices each kind is anchored at', () => {
		const trendline = expectOk(
			createAnnotation(input({ kind: 'trendline', anchors: wellFormedAnchors.trendline }))
		);
		expect(annotationTimes(trendline)).toEqual([SEP, OCT]);
		expect(annotationPrices(trendline)).toEqual([210, 240]);

		const level = expectOk(createAnnotation(input({})));
		expect(annotationTimes(level)).toEqual([]);
		expect(annotationPrices(level)).toEqual([231.5]);

		const range = expectOk(
			createAnnotation(input({ kind: 'date_range', anchors: wellFormedAnchors.date_range }))
		);
		expect(annotationTimes(range)).toEqual([SEP, OCT]);
		expect(annotationPrices(range)).toEqual([]);
	});
});

describe('copyAnnotation', () => {
	it('shares no structure with its source, so an anchor cannot be mutated through it', () => {
		const source = expectOk(
			createAnnotation(
				input({ kind: 'trendline', anchors: wellFormedAnchors.trendline, label: 'break' })
			)
		);
		const copy = copyAnnotation(source);
		expect(copy).toEqual(source);
		expect(copy.anchors).not.toBe(source.anchors);
	});

	it('omits an absent label rather than writing undefined', () => {
		const copy = copyAnnotation(expectOk(createAnnotation(input({}))));
		expect('label' in copy).toBe(false);
	});
});

describe('createAnnotation copies its anchors', () => {
	it('does not hold a reference to the caller’s anchor object', () => {
		const anchors = { kind: 'price_level' as const, price: 100 };
		const annotation = expectOk(createAnnotation(input({ anchors })));
		anchors.price = 999;
		expect(annotationPrices(annotation)).toEqual([100]);
	});
});

describe('normalizeAnnotations', () => {
	it('never throws on foreign input', () => {
		expect(() => normalizeAnnotations(undefined)).not.toThrow();
		expect(normalizeAnnotations('garbage')).toEqual([]);
	});

	it('drops malformed and duplicate entries while keeping the valid ones', () => {
		const kept = normalizeAnnotations([
			{
				id: 'annotation_1',
				kind: 'price_level',
				anchors: wellFormedAnchors.price_level,
				priceAdjustment: 'adjusted'
			},
			{
				id: 'annotation_1',
				kind: 'price_level',
				anchors: wellFormedAnchors.price_level,
				priceAdjustment: 'adjusted'
			},
			{
				id: 'annotation_2',
				kind: 'trendline',
				anchors: wellFormedAnchors.price_level,
				priceAdjustment: 'adjusted'
			},
			'nonsense'
		]);
		expect(kept.map((a) => a.id)).toEqual(['annotation_1']);
	});

	it('round-trips a well-formed list unchanged', () => {
		const built = [
			expectOk(createAnnotation(input({ id: 'annotation_1' }))),
			expectOk(
				createAnnotation(
					input({
						id: 'annotation_2',
						kind: 'label',
						anchors: wellFormedAnchors.label,
						label: 'high'
					})
				)
			)
		];
		expect(normalizeAnnotations(built)).toEqual(built);
	});
});

describe('validateAnnotationAnchors', () => {
	it('accepts each kind’s own anchors', () => {
		for (const kind of Object.keys(wellFormedAnchors) as (keyof typeof wellFormedAnchors)[]) {
			expect(validateAnnotationAnchors(kind, wellFormedAnchors[kind])).toEqual([]);
		}
	});

	it('names what a kind expects when handed a non-object', () => {
		expect(validateAnnotationAnchors('label', 42)).toEqual([
			'anchors: a label annotation expects a single {time, price} point as `at`, plus `text`.'
		]);
	});
});

describe('stable annotation IDs', () => {
	it('mints kind-prefixed annotation IDs that never collide with study IDs', () => {
		const ids = createIdSequencer();
		const annotationIds = [ids.next('annotation'), ids.next('annotation')];
		const studyIds = [ids.next('study'), ids.next('study')];
		expect(annotationIds).toEqual(['annotation_1', 'annotation_2']);
		expect(new Set([...annotationIds, ...studyIds]).size).toBe(4);
	});
});
