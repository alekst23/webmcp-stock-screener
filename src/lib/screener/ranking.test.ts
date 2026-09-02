import { describe, expect, it } from 'vitest';
import type { RankingField } from './definition';
import {
	canNormalizeWeights,
	isClearRankingInput,
	validateRankingDeclaration,
	type RankingDeclarationInput
} from './ranking';

describe('validateRankingDeclaration', () => {
	it('test_singleField_withDirection_isAcceptedAndStored', () => {
		const result = validateRankingDeclaration({
			fields: [{ fieldId: 'field.price.close', direction: 'desc' }]
		});
		expect(result.ok, `Expected single-field ranking to validate: ${JSON.stringify(result)}`).toBe(
			true
		);
		if (!result.ok) return;
		expect(result.ranking.fields, 'Expected exactly one stored ranking field').toEqual([
			{ fieldId: 'field.price.close', direction: 'desc', weight: 1 }
		]);
	});

	it('test_weightedFields_areAccepted_andStoredAsGiven', () => {
		const result = validateRankingDeclaration({
			fields: [
				{ fieldId: 'field.momentum.rsi', direction: 'desc', weight: 0.7 },
				{ fieldId: 'field.volume.relative', direction: 'asc', weight: 0.3 }
			]
		});
		expect(result.ok, `Expected weighted ranking to validate: ${JSON.stringify(result)}`).toBe(
			true
		);
		if (!result.ok) return;
		expect(
			result.ranking.fields.map((f) => f.weight),
			'Weights must round-trip unchanged'
		).toEqual([0.7, 0.3]);
	});

	it('test_weightedFields_default_normalization_isPercentileRank', () => {
		const result = validateRankingDeclaration({
			fields: [{ fieldId: 'field.momentum.rsi', weight: 1 }]
		});
		expect(result.ok, `Expected ranking to validate: ${JSON.stringify(result)}`).toBe(true);
		if (!result.ok) return;
		expect(
			result.ranking.normalization,
			'Default normalization must be percentile_rank per spec.md Open Question 3'
		).toBe('percentile_rank');
	});

	it('test_explicitNormalization_isStoredAsGiven', () => {
		const result = validateRankingDeclaration({
			fields: [{ fieldId: 'field.momentum.rsi' }],
			normalization: 'z_score'
		});
		expect(result.ok, `Expected ranking to validate: ${JSON.stringify(result)}`).toBe(true);
		if (!result.ok) return;
		expect(result.ranking.normalization, 'Explicit normalization must round-trip').toBe('z_score');
	});

	it('test_unknownNormalization_fallsBackToDefault', () => {
		const result = validateRankingDeclaration({
			fields: [{ fieldId: 'field.momentum.rsi' }],
			normalization: 'not_a_real_method'
		});
		expect(result.ok, `Expected ranking to validate: ${JSON.stringify(result)}`).toBe(true);
		if (!result.ok) return;
		expect(
			result.ranking.normalization,
			'An unrecognized normalization must repair to the documented default, not be stored verbatim'
		).toBe('percentile_rank');
	});

	it('test_tieBreak_withDirection_isStored', () => {
		const result = validateRankingDeclaration({
			fields: [{ fieldId: 'field.momentum.rsi' }],
			tieBreak: { fieldId: 'field.price.close', direction: 'asc' }
		});
		expect(result.ok, `Expected ranking to validate: ${JSON.stringify(result)}`).toBe(true);
		if (!result.ok) return;
		expect(result.ranking.tieBreak, 'Tie-break field and direction must be stored').toEqual({
			fieldId: 'field.price.close',
			direction: 'asc'
		});
	});

	it('test_noTieBreak_storesNull', () => {
		const result = validateRankingDeclaration({ fields: [{ fieldId: 'field.momentum.rsi' }] });
		expect(result.ok, `Expected ranking to validate: ${JSON.stringify(result)}`).toBe(true);
		if (!result.ok) return;
		expect(result.ranking.tieBreak, 'Absent tie-break must store as null').toBeNull();
	});

	it('test_explicitLimit_isStored', () => {
		const result = validateRankingDeclaration({
			fields: [{ fieldId: 'field.momentum.rsi' }],
			limit: 25
		});
		expect(result.ok, `Expected ranking to validate: ${JSON.stringify(result)}`).toBe(true);
		if (!result.ok) return;
		expect(result.ranking.limit, 'Explicit limit must be stored as given').toBe(25);
	});

	it('test_omittedLimit_usesDocumentedDefault', () => {
		const result = validateRankingDeclaration({ fields: [{ fieldId: 'field.momentum.rsi' }] });
		expect(result.ok, `Expected ranking to validate: ${JSON.stringify(result)}`).toBe(true);
		if (!result.ok) return;
		expect(result.ranking.limit, 'Omitted limit must default to 100').toBe(100);
	});

	it('test_nonPositiveLimit_isRejected', () => {
		const result = validateRankingDeclaration({
			fields: [{ fieldId: 'field.momentum.rsi' }],
			limit: 0
		});
		expect(result.ok, 'A non-positive limit must be rejected').toBe(false);
		if (result.ok) return;
		expect(result.issues.join(' '), 'Rejection must explain the limit problem').toMatch(/limit/i);
	});

	it('test_nonIntegerLimit_isRejected', () => {
		const result = validateRankingDeclaration({
			fields: [{ fieldId: 'field.momentum.rsi' }],
			limit: 12.5
		});
		expect(result.ok, 'A non-integer limit must be rejected').toBe(false);
	});

	it('test_allZeroWeights_isRejectedAsUnnormalizable', () => {
		const result = validateRankingDeclaration({
			fields: [
				{ fieldId: 'field.momentum.rsi', weight: 0 },
				{ fieldId: 'field.volume.relative', weight: 0 }
			]
		});
		expect(result.ok, 'All-zero weights cannot be normalized and must be rejected').toBe(false);
		if (result.ok) return;
		expect(result.issues.join(' '), 'Rejection must explain the weight problem').toMatch(/weight/i);
	});

	it('test_allNegativeWeights_isRejectedAsUnnormalizable', () => {
		const result = validateRankingDeclaration({
			fields: [
				{ fieldId: 'field.momentum.rsi', weight: -1 },
				{ fieldId: 'field.volume.relative', weight: -2 }
			]
		});
		expect(result.ok, 'All-negative weights cannot be normalized and must be rejected').toBe(false);
	});

	it('test_nonFiniteWeight_isRejected', () => {
		const result = validateRankingDeclaration({
			fields: [{ fieldId: 'field.momentum.rsi', weight: Number.POSITIVE_INFINITY }]
		});
		expect(result.ok, 'A non-finite weight must be rejected').toBe(false);
	});

	it('test_emptyFieldId_isRejected', () => {
		const result = validateRankingDeclaration({ fields: [{ fieldId: '   ' }] });
		expect(result.ok, 'A blank field_id must be rejected').toBe(false);
	});
});

describe('isClearRankingInput', () => {
	it('test_missingFields_isClearing', () => {
		const input: RankingDeclarationInput = {};
		expect(isClearRankingInput(input), 'No fields key at all must mean "clear"').toBe(true);
	});

	it('test_emptyFieldsArray_isClearing', () => {
		const input: RankingDeclarationInput = { fields: [] };
		expect(isClearRankingInput(input), 'An empty fields array must mean "clear"').toBe(true);
	});

	it('test_nullFields_isClearing', () => {
		const input: RankingDeclarationInput = { fields: null };
		expect(isClearRankingInput(input), 'An explicit null fields must mean "clear"').toBe(true);
	});

	it('test_nonEmptyFields_isNotClearing', () => {
		const input: RankingDeclarationInput = { fields: [{ fieldId: 'field.momentum.rsi' }] };
		expect(
			isClearRankingInput(input),
			'A populated fields array must not be treated as clearing'
		).toBe(false);
	});
});

describe('canNormalizeWeights', () => {
	const field = (weight: number): RankingField => ({
		fieldId: 'field.momentum.rsi',
		direction: 'desc',
		weight
	});

	it('test_emptyFieldList_canNormalize', () => {
		expect(canNormalizeWeights([]), 'No fields to normalize is trivially normalizable').toBe(true);
	});

	it('test_mixedPositiveAndZeroWeights_canNormalize', () => {
		expect(canNormalizeWeights([field(1), field(0)]), 'At least one positive weight suffices').toBe(
			true
		);
	});
});
