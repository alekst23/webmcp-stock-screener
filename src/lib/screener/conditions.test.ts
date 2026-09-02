import { describe, expect, it } from 'vitest';
import { CONDITION_FAMILIES, type ConditionFamily } from '../catalog/types';
import {
	CONDITION_FIELD_ALLOWLIST,
	normalizeCondition,
	type Condition,
	type EventRelativeCondition,
	type PatternCondition,
	type RangeCondition,
	type RelativeCondition,
	type ScalarCondition,
	type SeriesComparisonCondition,
	type StudyOutputCondition,
	type TemporalCondition
} from './conditions';

// One valid, fully-populated sample per condition family. Used both to
// exercise normalizeCondition's round-trip and to police AC5's structural
// no-free-form-string property below.
const SAMPLES: Record<ConditionFamily, Condition> = {
	scalar: {
		type: 'scalar',
		fieldId: 'field.price',
		operator: 'op.gt',
		value: 10,
		unit: 'usd'
	} satisfies ScalarCondition,
	range: {
		type: 'range',
		fieldId: 'field.rsi',
		lower: 40,
		upper: 70,
		lowerInclusive: true,
		upperInclusive: true
	} satisfies RangeCondition,
	series_comparison: {
		type: 'series_comparison',
		left: { catalogId: 'indicator.ma', params: { window: 50 } },
		right: { catalogId: 'indicator.ma', params: { window: 200 } },
		operator: 'op.gt'
	} satisfies SeriesComparisonCondition,
	temporal: {
		type: 'temporal',
		condition: {
			type: 'scalar',
			fieldId: 'field.price',
			operator: 'op.gt',
			value: 10,
			unit: 'usd'
		},
		event: 'crossed_above',
		withinBars: 5,
		intervalId: 'interval.1d'
	} satisfies TemporalCondition,
	event_relative: {
		type: 'event_relative',
		eventTypeId: 'event.earnings',
		direction: 'future',
		windowDays: 30
	} satisfies EventRelativeCondition,
	pattern: {
		type: 'pattern',
		patternId: 'pattern.bull_flag',
		minConfidence: 0.75,
		intervalId: 'interval.1d'
	} satisfies PatternCondition,
	relative: {
		type: 'relative',
		fieldId: 'field.volume',
		baseline: { kind: 'own_moving_average', windowBars: 20 },
		multiple: 1.5,
		operator: 'op.gt'
	} satisfies RelativeCondition,
	study_output: {
		type: 'study_output',
		studyId: 'study.macd',
		params: { fast: 12, slow: 26 },
		outputName: 'histogram',
		predicate: 'positive_and_rising'
	} satisfies StudyOutputCondition
};

describe('normalizeCondition', () => {
	for (const family of CONDITION_FAMILIES) {
		it(`test_normalizeCondition_${family}_sample_round_trips_unchanged`, () => {
			const sample = SAMPLES[family];
			const roundTripped = normalizeCondition(JSON.parse(JSON.stringify(sample)));
			expect(roundTripped, `${family} condition failed to normalize at all`).not.toBeNull();
			expect(roundTripped, `${family} condition should round-trip unchanged`).toEqual(sample);
			expect(roundTripped?.type, `discriminant must be "${family}"`).toBe(family);
		});
	}

	it('test_normalizeCondition_unknown_type_returns_null', () => {
		const result = normalizeCondition({ type: 'sql_expression', expression: 'SELECT 1' });
		expect(result, 'an unrecognized condition type must not normalize to anything').toBeNull();
	});

	it('test_normalizeCondition_non_record_input_returns_null_never_throws', () => {
		for (const input of [null, undefined, 42, 'a string', [1, 2, 3], true]) {
			expect(
				() => normalizeCondition(input),
				`input ${JSON.stringify(input)} must not throw`
			).not.toThrow();
			expect(
				normalizeCondition(input),
				`non-record input ${JSON.stringify(input)} must normalize to null`
			).toBeNull();
		}
	});

	it('test_normalizeCondition_temporal_with_unrecoverable_inner_condition_returns_null', () => {
		const result = normalizeCondition({
			type: 'temporal',
			condition: { type: 'not_a_real_family' },
			event: 'crossed_above',
			withinBars: 5,
			intervalId: 'interval.1d'
		});
		expect(
			result,
			'a temporal condition whose inner condition cannot normalize must not survive as a half-built wrapper'
		).toBeNull();
	});

	it('test_normalizeCondition_bad_enum_fields_coerce_to_documented_defaults', () => {
		const scalarLikeTemporal = normalizeCondition({
			type: 'temporal',
			condition: SAMPLES.scalar,
			event: 'not_a_real_event',
			withinBars: 5,
			intervalId: 'interval.1d'
		}) as TemporalCondition | null;
		expect(scalarLikeTemporal, 'temporal condition must still normalize').not.toBeNull();
		expect(
			scalarLikeTemporal?.event,
			'an unrecognized event must coerce to the safe default, not throw or pass through'
		).toBe('became_true');

		const eventRelative = normalizeCondition({
			type: 'event_relative',
			eventTypeId: 'event.earnings',
			direction: 'sideways',
			windowDays: 10
		}) as EventRelativeCondition | null;
		expect(eventRelative, 'event_relative condition must still normalize').not.toBeNull();
		expect(
			eventRelative?.direction,
			'an unrecognized direction must coerce to the safe default'
		).toBe('future');
	});

	it('test_normalizeCondition_missing_required_strings_coerce_to_empty_string_not_throw', () => {
		const result = normalizeCondition({ type: 'scalar' }) as ScalarCondition | null;
		expect(result, 'a scalar condition with no fields at all must still normalize').not.toBeNull();
		expect(result?.fieldId, 'a missing fieldId must coerce to empty string').toBe('');
		expect(result?.operator, 'a missing operator must coerce to empty string').toBe('');
	});
});

describe('CONDITION_FIELD_ALLOWLIST', () => {
	it('test_allowlist_has_exactly_one_entry_per_condition_family', () => {
		const keys = Object.keys(CONDITION_FIELD_ALLOWLIST).sort();
		expect(keys, 'allowlist must cover exactly the eight catalog condition families').toEqual(
			[...CONDITION_FAMILIES].sort()
		);
	});

	// AC5, made structural: this test fails the moment any variant gains a
	// field outside its documented allowlist -- in particular a free-form
	// `expression`/`sql`/`js` field that could later be parsed or evaluated.
	for (const family of CONDITION_FAMILIES) {
		it(`test_${family}_sample_carries_only_allowlisted_fields`, () => {
			const sample = SAMPLES[family];
			const ownKeys = Object.keys(sample);
			const allowed = CONDITION_FIELD_ALLOWLIST[family];
			const disallowed = ownKeys.filter((key) => !allowed.includes(key));
			expect(
				disallowed,
				`${family} condition carries fields outside its declared allowlist: ${JSON.stringify(disallowed)}`
			).toEqual([]);
		});
	}

	it('test_allowlist_rejects_a_hypothetical_expression_field', () => {
		const contaminated = { ...SAMPLES.scalar, expression: 'price * 2 > 20' };
		const ownKeys = Object.keys(contaminated);
		const allowed = CONDITION_FIELD_ALLOWLIST.scalar;
		const disallowed = ownKeys.filter((key) => !allowed.includes(key));
		expect(
			disallowed,
			'a free-form expression field must be caught by the allowlist check'
		).toEqual(['expression']);
	});
});
