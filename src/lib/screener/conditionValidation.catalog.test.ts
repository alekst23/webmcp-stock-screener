// Tests for the four condition variants whose validation rules lean hardest
// on catalog lookups: event_relative, pattern, relative, study_output. The
// four structurally simpler variants are covered in
// conditionValidation.test.ts.
import { describe, expect, it } from 'vitest';
import type { CatalogRegistry } from '../catalog/registry';
import { builtinCatalogRegistry } from '../catalog/registry';
import type { CatalogItem } from '../catalog/types';
import { PROBLEM_CODES } from './validation';
import { validateCondition } from './conditionValidation';
import type {
	EventRelativeCondition,
	PatternCondition,
	RelativeCondition,
	StudyOutputCondition
} from './conditions';

// Mirrors src/lib/catalog/registry.ts's real query semantics over a small
// fixed inventory (the same pattern src/lib/screener/universeValidation.test.ts
// uses), so a fixture behaves exactly like the built-in registry would for
// availability, parameter, and interval scenarios the seeded inventory
// doesn't happen to cover (every seeded pattern and every earnings-adjacent
// field is deliberately declared unavailable).
function fixtureRegistry(items: CatalogItem[]): CatalogRegistry {
	const byId = new Map(items.map((item) => [item.id, item]));
	return {
		getCatalogItem: (id) => byId.get(id),
		listCatalogItems: (kind) => (kind ? items.filter((i) => i.kind === kind) : items),
		searchCatalogItems: () => [],
		isOperatorValidForField: (operatorId, fieldId) => {
			const operator = byId.get(operatorId);
			const field = byId.get(fieldId);
			if (!operator || operator.kind !== 'operator') {
				return { valid: false, reason: `"${operatorId}" is not a known operator ID.` };
			}
			if (!field || field.kind !== 'field') {
				return { valid: false, reason: `"${fieldId}" is not a known field ID.` };
			}
			if (!operator.operandTypes.includes(field.valueType)) {
				return {
					valid: false,
					reason: `Operator "${operator.id}" does not accept field "${field.id}" of type "${field.valueType}".`
				};
			}
			return { valid: true };
		},
		resolveStudy: (studyId) => {
			const item = byId.get(studyId);
			return item?.kind === 'study' ? item : undefined;
		},
		suggestCatalogIds: () => []
	};
}

const AVAILABLE_EVENT_FIELD: CatalogItem = {
	id: 'field.test_event',
	kind: 'field',
	label: 'Test event',
	description: 'A test-only event field with real availability.',
	aliases: [],
	tags: [],
	valueType: 'date',
	nullable: true,
	availability: { status: 'available', requiresReferenceData: false, intervalIds: ['interval.1d'] }
};

describe('validateCondition: event_relative (AC5)', () => {
	function eventRelative(eventTypeId: string, windowDays = 30): EventRelativeCondition {
		return { type: 'event_relative', eventTypeId, direction: 'future', windowDays };
	}

	it('accepts_earningsWithinNextThirtyDays_whenAvailable', () => {
		const registry = fixtureRegistry([AVAILABLE_EVENT_FIELD]);
		const problems = validateCondition(eventRelative('field.test_event'), { registry });
		expect(problems, 'an available event type is valid').toEqual([]);
	});

	it('rejects_unknownEventType_namingIt', () => {
		const problems = validateCondition(eventRelative('field.no_such_event'), {
			registry: builtinCatalogRegistry
		});
		expect(problems[0]?.code).toBe(PROBLEM_CODES.unknownCatalogItem);
		expect(problems[0]?.message).toContain('field.no_such_event');
	});

	it('rejects_eventCalendarUnavailableForTheUniverse_namingTheReason', () => {
		// field.earnings.next_report_date is seeded unavailable (no fundamentals
		// source), requiresReferenceData: true -- the flag AC5 names.
		const problems = validateCondition(eventRelative('field.earnings.next_report_date'), {
			registry: builtinCatalogRegistry
		});
		expect(problems.length, 'an unavailable event calendar is rejected').toBeGreaterThan(0);
		expect(problems[0]?.code).toBe(PROBLEM_CODES.unavailableData);
		expect(problems[0]?.message).toContain('field.earnings.next_report_date');
	});

	it('rejects_negativeWindowDays', () => {
		const registry = fixtureRegistry([AVAILABLE_EVENT_FIELD]);
		const problems = validateCondition(eventRelative('field.test_event', -1), { registry });
		expect(problems.some((p) => p.code === PROBLEM_CODES.invalidParameter)).toBe(true);
	});
});

const AVAILABLE_PATTERN: CatalogItem = {
	id: 'pattern.test_pattern',
	kind: 'pattern',
	label: 'Test pattern',
	description: 'A test-only pattern with real availability.',
	aliases: [],
	tags: [],
	parameters: [],
	outputs: [{ name: 'matched', valueType: 'boolean' }],
	defaultIntervalId: 'interval.1d',
	availability: { status: 'available', requiresReferenceData: false, intervalIds: ['interval.1d'] }
};

const INTERVAL_1D: CatalogItem = {
	id: 'interval.1d',
	kind: 'interval',
	label: '1 day',
	description: 'test fixture interval',
	aliases: [],
	tags: [],
	barSeconds: 86_400,
	sessionAware: true,
	availability: { status: 'available', requiresReferenceData: false, intervalIds: ['interval.1d'] }
};

describe('validateCondition: pattern (AC6)', () => {
	function pattern(patternId: string, minConfidence: number, intervalId: string): PatternCondition {
		return { type: 'pattern', patternId, minConfidence, intervalId };
	}

	it('accepts_bullFlagAboveConfidence_whenAvailableOnTheInterval', () => {
		const registry = fixtureRegistry([AVAILABLE_PATTERN, INTERVAL_1D]);
		const problems = validateCondition(pattern('pattern.test_pattern', 0.75, 'interval.1d'), {
			registry
		});
		expect(problems, 'a valid confidence on an available interval is valid').toEqual([]);
	});

	it('rejects_unknownPattern_namingIt', () => {
		const problems = validateCondition(pattern('pattern.does_not_exist', 0.5, 'interval.1d'), {
			registry: builtinCatalogRegistry
		});
		expect(problems[0]?.code).toBe(PROBLEM_CODES.unknownCatalogItem);
	});

	it('rejects_confidenceOutsideZeroToOne_namingTheRange', () => {
		const registry = fixtureRegistry([AVAILABLE_PATTERN, INTERVAL_1D]);
		const problems = validateCondition(pattern('pattern.test_pattern', 1.5, 'interval.1d'), {
			registry
		});
		expect(
			problems.some(
				(p) => p.code === PROBLEM_CODES.invalidParameter && p.message.includes('0 to 1')
			)
		).toBe(true);
	});

	it('rejects_intervalNotInThePatternsDeclaredAvailability', () => {
		// The real bull_flag pattern is seeded unavailable, so its
		// availability.intervalIds is empty -- no interval satisfies it today.
		const problems = validateCondition(pattern('pattern.bull_flag', 0.75, 'interval.1d'), {
			registry: builtinCatalogRegistry
		});
		expect(problems.some((p) => p.code === PROBLEM_CODES.unavailableData)).toBe(true);
	});
});

describe('validateCondition: relative (AC7)', () => {
	function relative(
		fieldId: string,
		operator: string,
		baseline: RelativeCondition['baseline'],
		multiple: number
	): RelativeCondition {
		return { type: 'relative', fieldId, baseline, multiple, operator };
	}

	it('accepts_volumeAboveOneAndHalfTimesItsTwentyDayAverage', () => {
		const problems = validateCondition(
			relative(
				'field.volume',
				'op.greater_than',
				{ kind: 'own_moving_average', windowBars: 20 },
				1.5
			)
		);
		expect(problems, 'a numeric field with a valid baseline and operator is valid').toEqual([]);
	});

	it('accepts_indexBaseline_resolvingAsAUniverseItem', () => {
		const problems = validateCondition(
			relative('field.volume', 'op.greater_than', { kind: 'index', indexId: 'universe.sp500' }, 2)
		);
		expect(
			problems,
			'universe.sp500 is a real universe item the index baseline resolves to'
		).toEqual([]);
	});

	it('rejects_unknownField_namingIt', () => {
		const problems = validateCondition(
			relative(
				'field.does_not_exist',
				'op.greater_than',
				{ kind: 'own_moving_average', windowBars: 20 },
				1.5
			)
		);
		expect(problems.some((p) => p.code === PROBLEM_CODES.unknownCatalogItem)).toBe(true);
	});

	it('rejects_nonNumericField', () => {
		const problems = validateCondition(
			relative(
				'field.symbol',
				'op.greater_than',
				{ kind: 'own_moving_average', windowBars: 20 },
				1.5
			)
		);
		expect(problems.some((p) => p.code === PROBLEM_CODES.invalidParameter)).toBe(true);
	});

	it('rejects_unresolvableBaselineReference_namingIt', () => {
		const problems = validateCondition(
			relative(
				'field.volume',
				'op.greater_than',
				{ kind: 'peer_group', groupId: 'peer.bogus' },
				1.5
			)
		);
		expect(
			problems.some(
				(p) => p.code === PROBLEM_CODES.unknownCatalogItem && p.message.includes('peer.bogus')
			)
		).toBe(true);
	});

	it('rejects_nonPositiveMultiple', () => {
		const problems = validateCondition(
			relative(
				'field.volume',
				'op.greater_than',
				{ kind: 'own_moving_average', windowBars: 20 },
				-1
			)
		);
		expect(
			problems.some(
				(p) => p.code === PROBLEM_CODES.invalidParameter && p.message.includes('multiple')
			)
		).toBe(true);
	});

	it('rejects_operatorNotValidForTheField', () => {
		// op.matches_pattern only accepts 'enum' operands; field.volume is numeric.
		const problems = validateCondition(
			relative(
				'field.volume',
				'op.matches_pattern',
				{ kind: 'own_moving_average', windowBars: 20 },
				1.5
			)
		);
		expect(problems.some((p) => p.code === PROBLEM_CODES.invalidParameter)).toBe(true);
	});
});

const REQUIRED_PARAM_STUDY: CatalogItem = {
	id: 'study.test_study',
	kind: 'study',
	label: 'Test study',
	description: 'A test-only study with a required parameter.',
	aliases: [],
	tags: [],
	parameters: [
		{ name: 'foo', valueType: 'number', defaultValue: null, range: { min: 0 }, required: true }
	],
	outputs: [{ name: 'value', valueType: 'number' }],
	defaultIntervalId: 'interval.1d',
	availability: { status: 'available', requiresReferenceData: false, intervalIds: ['interval.1d'] }
};

describe('validateCondition: study_output (AC8)', () => {
	function studyOutput(
		studyId: string,
		params: StudyOutputCondition['params'],
		outputName: string,
		predicate: string
	): StudyOutputCondition {
		return { type: 'study_output', studyId, params, outputName, predicate };
	}

	it('accepts_macdHistogramPositiveAndRising', () => {
		const problems = validateCondition(
			studyOutput('study.sma', { length: 20 }, 'sma', 'positive_and_rising')
		);
		expect(problems, 'a declared output and a recognized predicate are valid').toEqual([]);
	});

	it('rejects_unknownStudy_namingIt', () => {
		const problems = validateCondition(studyOutput('study.does_not_exist', {}, 'sma', 'positive'));
		expect(problems[0]?.code).toBe(PROBLEM_CODES.unknownCatalogItem);
	});

	it('rejects_outputNameNotDeclaredByTheStudy_namingValidOutputs', () => {
		const problems = validateCondition(
			studyOutput('study.sma', { length: 20 }, 'nonexistent_output', 'positive')
		);
		expect(
			problems.some((p) => p.code === PROBLEM_CODES.invalidParameter && p.message.includes('sma'))
		).toBe(true);
	});

	it('rejects_predicateNotInTheClosedUnion_namingValidPredicates', () => {
		const problems = validateCondition(
			studyOutput('study.sma', { length: 20 }, 'sma', 'doing_a_backflip')
		);
		expect(
			problems.some(
				(p) => p.code === PROBLEM_CODES.invalidParameter && p.message.includes('predicate')
			)
		).toBe(true);
	});

	it('rejects_paramOutsideStudysDeclaredRange_namingIt', () => {
		// study.rsi's length parameter declares range { min: 2, max: 200 }.
		const problems = validateCondition(
			studyOutput('study.rsi', { length: 999 }, 'rsi', 'above_zero')
		);
		expect(
			problems.some(
				(p) => p.code === PROBLEM_CODES.invalidParameter && p.message.includes('length')
			)
		).toBe(true);
	});

	it('rejects_missingRequiredParameter_namingIt', () => {
		const registry = fixtureRegistry([REQUIRED_PARAM_STUDY]);
		const problems = validateCondition(studyOutput('study.test_study', {}, 'value', 'positive'), {
			registry
		});
		expect(
			problems.some((p) => p.code === PROBLEM_CODES.invalidParameter && p.message.includes('foo'))
		).toBe(true);
	});
});
