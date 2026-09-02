import { describe, expect, it } from 'vitest';
import { isCatalogItemId } from '../surface/ids';
import {
	clampCatalogLimit,
	getCatalogItem,
	isOperatorValidForField,
	listCatalogItems,
	MAX_CATALOG_RESULTS,
	resolveStudy,
	searchCatalogItems,
	suggestCatalogIds
} from './registry';
import { CATALOG_KIND_ID_PREFIX, CATALOG_KINDS, CONDITION_FAMILIES } from './types';

describe('inventory integrity', () => {
	it('test_every_registry_id_is_unique', () => {
		const ids = listCatalogItems().map((item) => item.id);
		const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
		expect(duplicates, `duplicate catalog IDs: ${JSON.stringify(duplicates)}`).toEqual([]);
	});

	it('test_every_registry_id_is_well_formed_and_prefixed_by_its_kind', () => {
		for (const item of listCatalogItems()) {
			expect(isCatalogItemId(item.id), `"${item.id}" is not a well-formed catalog item ID`).toBe(
				true
			);
			const prefix = CATALOG_KIND_ID_PREFIX[item.kind];
			expect(
				item.id.startsWith(`${prefix}.`),
				`"${item.id}" is kind "${item.kind}" but is not prefixed "${prefix}."`
			).toBe(true);
		}
	});

	it('test_all_eight_kinds_are_represented', () => {
		for (const kind of CATALOG_KINDS) {
			expect(
				listCatalogItems(kind).length > 0,
				`no catalog items of kind "${kind}" -- search_catalog declares the kind but cannot return one`
			).toBe(true);
		}
	});

	it('test_all_eight_condition_families_are_covered_by_operators', () => {
		const families = new Set(
			listCatalogItems('operator').map((item) =>
				item.kind === 'operator' ? item.conditionFamily : null
			)
		);
		for (const family of CONDITION_FAMILIES) {
			expect(
				families.has(family),
				`no operator belongs to condition family "${family}"; EPIC-1009 could not build that condition type`
			).toBe(true);
		}
	});

	it('test_every_item_that_is_not_available_states_a_reason', () => {
		for (const item of listCatalogItems()) {
			if (item.availability.status !== 'available') {
				expect(
					item.availability.reason?.length ?? 0,
					`"${item.id}" is ${item.availability.status} without a reason`
				).toBeGreaterThan(0);
			}
		}
	});

	it('test_returned_items_cannot_be_mutated_by_callers', () => {
		const item = getCatalogItem('study.sma');
		expect(item, 'study.sma should exist').toBeDefined();
		expect(() => {
			(item as { label: string }).label = 'hacked';
		}, 'a caller was able to mutate a shared registry item').toThrow();
	});
});

describe('lookup', () => {
	it('test_known_id_is_returned_with_its_kind_specific_detail', () => {
		const rsi = getCatalogItem('study.rsi');
		expect(rsi?.kind, `expected a study, got ${rsi?.kind}`).toBe('study');
		if (rsi?.kind !== 'study') {
			throw new Error('study.rsi is not a study');
		}
		expect(
			rsi.parameters.find((p) => p.name === 'length')?.defaultValue,
			`expected RSI length to default to 14, got ${JSON.stringify(rsi.parameters)}`
		).toBe(14);
		expect(
			rsi.outputs[0]?.range,
			`expected a 0-100 output range, got ${JSON.stringify(rsi.outputs[0])}`
		).toEqual({
			min: 0,
			max: 100
		});
	});

	it('test_unknown_id_returns_undefined_rather_than_throwing', () => {
		expect(getCatalogItem('study.does_not_exist'), 'an unknown ID must resolve to undefined').toBe(
			undefined
		);
	});

	it('test_listing_by_kind_returns_only_that_kind', () => {
		for (const kind of CATALOG_KINDS) {
			const wrong = listCatalogItems(kind).filter((item) => item.kind !== kind);
			expect(
				wrong,
				`listCatalogItems("${kind}") returned ${JSON.stringify(wrong.map((i) => i.id))}`
			).toEqual([]);
		}
	});
});

describe('search', () => {
	it('test_match_by_label', () => {
		const results = searchCatalogItems({ text: 'Relative strength index' });
		expect(results[0]?.item.id, `expected study.rsi first, got ${results[0]?.item.id}`).toBe(
			'study.rsi'
		);
		expect(results[0]?.matchedOn, 'expected a label match').toBe('label');
	});

	it('test_match_by_alias_finds_the_item_under_a_common_synonym', () => {
		const results = searchCatalogItems({ text: 'rvol' });
		expect(
			results[0]?.item.id,
			`"rvol" should find relative volume, got ${JSON.stringify(results.map((r) => r.item.id))}`
		).toBe('indicator.relative_volume');
		expect(results[0]?.matchedOn, 'expected an alias match').toBe('alias');
	});

	it('test_exact_id_outranks_a_looser_match', () => {
		const results = searchCatalogItems({ text: 'study.sma' });
		expect(results[0]?.item.id, `expected the exact ID first, got ${results[0]?.item.id}`).toBe(
			'study.sma'
		);
		expect(results[0]?.matchedOn, 'expected an id match').toBe('id');
	});

	it('test_results_are_ordered_by_descending_relevance', () => {
		const scores = searchCatalogItems({ text: 'volume' }).map((r) => r.score);
		const sorted = [...scores].sort((a, b) => b - a);
		expect(
			scores,
			`results are not in descending relevance order: ${JSON.stringify(scores)}`
		).toEqual(sorted);
	});

	it('test_kind_restriction_returns_only_those_kinds', () => {
		const results = searchCatalogItems({ text: 'volume', kinds: ['field'] });
		const kinds = new Set(results.map((r) => r.item.kind));
		expect(
			[...kinds],
			`kind restriction leaked other kinds: ${JSON.stringify([...kinds])}`
		).toEqual(['field']);
	});

	it('test_empty_query_with_a_kind_enumerates_that_kind', () => {
		const results = searchCatalogItems({ kinds: ['interval'], limit: MAX_CATALOG_RESULTS });
		expect(results.length, `enumeration should list every interval, got ${results.length}`).toBe(
			listCatalogItems('interval').length
		);
		expect(results[0]?.matchedOn, 'enumeration is not a text match and should say so').toBe(
			'enumeration'
		);
	});

	it('test_unavailable_items_are_included_by_default_and_excludable_on_request', () => {
		const included = searchCatalogItems({ text: 'sector' });
		expect(
			included.some((r) => r.item.id === 'field.sector'),
			'an unavailable item must still be findable by default'
		).toBe(true);

		const excluded = searchCatalogItems({ text: 'sector', includeUnavailable: false });
		expect(
			excluded.some((r) => r.item.id === 'field.sector'),
			'includeUnavailable:false must drop unavailable items'
		).toBe(false);
	});

	it('test_no_match_returns_an_empty_list_rather_than_everything', () => {
		expect(
			searchCatalogItems({ text: 'zzzznothingmatchesthis' }),
			'a no-match query must return nothing, not the whole catalog'
		).toEqual([]);
	});

	it('test_limit_is_clamped_to_the_documented_maximum', () => {
		expect(clampCatalogLimit(10_000), 'an unbounded limit must clamp').toEqual({
			limit: MAX_CATALOG_RESULTS,
			clamped: true
		});
		expect(
			searchCatalogItems({ limit: 10_000 }).length <= MAX_CATALOG_RESULTS,
			'search returned more than the documented maximum'
		).toBe(true);
	});
});

describe('isOperatorValidForField (EPIC-1009 hook)', () => {
	it('test_matching_operator_and_field_types_are_valid', () => {
		const check = isOperatorValidForField('op.greater_than', 'field.volume');
		expect(check.valid, `expected valid, got ${JSON.stringify(check)}`).toBe(true);
	});

	it('test_mismatched_operator_and_field_types_are_invalid_with_a_reason', () => {
		const check = isOperatorValidForField('op.greater_than', 'field.symbol');
		expect(check.valid, '"greater than" must not apply to a string field').toBe(false);
		expect(
			check.valid === false ? check.reason : '',
			'an invalid pairing must explain itself so the agent can self-correct'
		).toMatch(/string/);
	});

	it('test_unknown_operator_or_field_is_invalid_and_names_what_was_unknown', () => {
		const badOp = isOperatorValidForField('op.nope', 'field.volume');
		expect(badOp.valid, 'an unknown operator must be invalid').toBe(false);
		expect(
			badOp.valid === false ? badOp.reason : '',
			'the reason must name the unknown ID'
		).toContain('op.nope');

		const badField = isOperatorValidForField('op.greater_than', 'field.nope');
		expect(badField.valid, 'an unknown field must be invalid').toBe(false);
		expect(
			badField.valid === false ? badField.reason : '',
			'the reason must name the unknown ID'
		).toContain('field.nope');
	});

	it('test_a_non_operator_id_passed_as_an_operator_is_rejected', () => {
		const check = isOperatorValidForField('study.sma', 'field.volume');
		expect(check.valid, 'a study ID must not be accepted as an operator').toBe(false);
	});
});

describe('resolveStudy (EPIC-1011 hook)', () => {
	it('test_known_study_resolves_to_its_parameters_and_outputs', () => {
		const study = resolveStudy('study.macd');
		expect(
			study?.parameters.map((p) => p.name),
			`expected fast/slow/signal, got ${JSON.stringify(study?.parameters)}`
		).toEqual(['fast', 'slow', 'signal']);
		expect(
			study?.outputs.map((o) => o.name),
			`expected macd/signal/histogram, got ${JSON.stringify(study?.outputs)}`
		).toEqual(['macd', 'signal', 'histogram']);
	});

	it('test_an_indicator_id_does_not_resolve_as_a_study', () => {
		expect(
			resolveStudy('indicator.relative_volume'),
			'an indicator must not resolve through the study hook'
		).toBe(undefined);
	});

	it('test_unknown_study_resolves_to_undefined', () => {
		expect(resolveStudy('study.nope'), 'an unknown study must resolve to undefined').toBe(
			undefined
		);
	});
});

describe('availability honesty', () => {
	it('test_reference_data_dependent_items_are_present_unavailable_and_flagged', () => {
		for (const id of [
			'field.sector',
			'field.industry',
			'field.country',
			'field.exchange',
			'field.index_membership',
			'field.fundamentals.pe_ratio',
			'field.earnings.next_report_date',
			'universe.sp500'
		]) {
			const item = getCatalogItem(id);
			expect(item, `"${id}" must be present in the registry, not omitted`).toBeDefined();
			expect(
				item?.availability.status,
				`"${id}" must not claim availability it does not have`
			).toBe('unavailable');
			expect(
				item?.availability.requiresReferenceData,
				`"${id}" must be flagged as needing reference data`
			).toBe(true);
			expect(item?.availability.reason, `"${id}" must say why it is unavailable`).toBeTruthy();
		}
	});

	it('test_items_backed_by_real_daily_data_report_available_over_the_daily_interval', () => {
		for (const id of ['field.price.close', 'field.volume', 'study.sma', 'interval.1d']) {
			const item = getCatalogItem(id);
			expect(item?.availability.status, `"${id}" should be available`).toBe('available');
			expect(
				item?.availability.intervalIds,
				`"${id}" should state the daily interval it is available over`
			).toContain('interval.1d');
		}
	});
});

describe('suggestCatalogIds', () => {
	it('test_a_near_miss_id_suggests_the_real_one_first', () => {
		expect(
			suggestCatalogIds('study.rsi14')[0],
			`expected study.rsi to be suggested for "study.rsi14", got ${JSON.stringify(suggestCatalogIds('study.rsi14'))}`
		).toBe('study.rsi');
	});

	it('test_a_wrong_prefix_still_finds_the_item_by_its_tail', () => {
		expect(
			suggestCatalogIds('indicator.sma'),
			`expected study.sma among suggestions, got ${JSON.stringify(suggestCatalogIds('indicator.sma'))}`
		).toContain('study.sma');
	});

	it('test_suggestions_are_bounded_and_deterministic', () => {
		const first = suggestCatalogIds('field.price');
		const second = suggestCatalogIds('field.price');
		expect(first.length <= 5, `expected at most 5 suggestions, got ${first.length}`).toBe(true);
		expect(second, 'suggestions must be deterministic across calls').toEqual(first);
	});

	it('test_an_empty_id_suggests_nothing', () => {
		expect(suggestCatalogIds('   '), 'an empty ID has nothing to suggest against').toEqual([]);
	});
});
