import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry, listCatalogItems } from '../../catalog/registry';
import { CATALOG_KINDS } from '../../catalog/types';
import { createDescribeCatalogItemTool } from './describeCatalogItem';
import { payload } from './testSupport';

const tool = createDescribeCatalogItemTool(builtinCatalogRegistry);

async function describeItem(itemId: string): Promise<Record<string, unknown>> {
	return payload(await tool.execute({ itemId }));
}

describe('describe_catalog_item', () => {
	it('test_an_item_of_every_kind_can_be_described_with_its_kind_specific_detail', async () => {
		for (const kind of CATALOG_KINDS) {
			const sample = listCatalogItems(kind)[0];
			expect(sample, `no ${kind} to describe`).toBeDefined();
			const body = await describeItem(sample!.id);
			expect(body.kind, `expected kind "${kind}", got ${body.kind}`).toBe(kind);
			expect(
				Object.keys(body.detail as object).length,
				`"${sample!.id}" of kind "${kind}" returned no kind-specific detail`
			).toBeGreaterThan(0);
		}
	});

	it('test_a_field_reports_nullability_and_reporting_basis', async () => {
		const detail = (await describeItem('field.fundamentals.pe_ratio')).detail as Record<
			string,
			unknown
		>;
		expect(detail.nullable, 'a field must report nullability').toBe(true);
		expect(detail.reportingBasis, 'a fundamentals field must report its basis').toBe(
			'trailing_twelve_months'
		);
	});

	it('test_an_operator_reports_arity_operand_types_and_condition_family', async () => {
		const detail = (await describeItem('op.crosses_above')).detail as Record<string, unknown>;
		expect(detail.arity, 'an operator must report its arity').toBe(2);
		expect(detail.operandTypes, 'an operator must report its operand types').toEqual(['number']);
		expect(detail.conditionFamily, 'an operator must report its condition family').toBe(
			'series_comparison'
		);
	});

	it('test_an_interval_reports_its_bar_duration_and_a_universe_its_membership_source', async () => {
		const interval = (await describeItem('interval.1d')).detail as Record<string, unknown>;
		expect(interval.barSeconds, 'an interval must report its bar duration').toBe(86_400);

		const universe = (await describeItem('universe.sp500')).detail as Record<string, unknown>;
		expect(
			universe.membershipSource,
			'a universe must report where its membership comes from'
		).toBeTruthy();
	});

	it('test_a_template_reports_what_it_applies_to', async () => {
		const detail = (await describeItem('template.momentum_breakout')).detail as Record<
			string,
			unknown
		>;
		expect(detail.appliesTo, 'a template must report its target').toBe('screener');
	});

	it('test_a_study_reports_every_parameter_and_output_in_full', async () => {
		const body = await describeItem('study.rsi');
		const length = (body.parameters as Record<string, unknown>[]).find((p) => p.name === 'length');
		expect(
			length,
			`expected a length parameter, got ${JSON.stringify(body.parameters)}`
		).toBeDefined();
		expect(length?.valueType, 'a parameter must state its value type').toBe('number');
		expect(length?.unit, 'a parameter must state its unit where one applies').toBe('bars');
		expect(length?.defaultValue, 'a parameter must state its default').toBe(14);
		expect(length?.range, 'a parameter must state its valid range').toEqual({ min: 2, max: 200 });
		expect(length?.required, 'a parameter must state whether it is required').toBe(false);

		const output = (body.outputs as Record<string, unknown>[])[0];
		expect(output?.valueType, 'an output must state its value type').toBe('number');
		expect(output?.range, 'the RSI output range must be stated').toEqual({ min: 0, max: 100 });
	});

	it('test_availability_reports_status_reason_and_covered_intervals', async () => {
		const available = (await describeItem('study.sma')).availability as Record<string, unknown>;
		expect(available.status, 'study.sma is computable today').toBe('available');
		expect(available.intervalIds, 'the covered intervals must be stated').toContain('interval.1d');

		const blocked = (await describeItem('study.rsi')).availability as Record<string, unknown>;
		expect(blocked.status, 'study.rsi is declared but not computable').toBe('unavailable');
		expect(blocked.reason, 'an unavailable item must say why').toBeTruthy();
	});

	it('test_a_reference_data_dependent_item_returns_full_detail_not_a_not_found', async () => {
		const result = await tool.execute({ itemId: 'field.sector' });
		expect(result.isError, 'an unavailable item is described, not treated as missing').toBeFalsy();
		const body = payload(result);
		expect(body.id, 'the item must be fully identified').toBe('field.sector');
		expect(
			(body.detail as Record<string, unknown>).valueType,
			'its declared detail must still be returned'
		).toBe('enum');
		const availability = body.availability as Record<string, unknown>;
		expect(availability.status, 'it must report unavailable').toBe('unavailable');
		expect(availability.requiresReferenceData, 'it must name the reference-data dependency').toBe(
			true
		);
		expect(availability.reason as string, 'the reason must name the dependency').toMatch(
			/reference-data source/i
		);
	});

	it('test_an_unknown_id_is_an_explicit_not_found_naming_the_id', async () => {
		const result = await tool.execute({ itemId: 'study.does_not_exist' });
		expect(result.isError, 'an unknown ID must not be an empty success').toBe(true);
		const body = payload(result);
		expect(body.error as string, 'the error must name the ID it was given').toContain(
			'study.does_not_exist'
		);
		expect(body.itemId, 'the ID must be echoed back').toBe('study.does_not_exist');
	});

	it('test_a_near_miss_id_suggests_the_real_one', async () => {
		const body = payload(await tool.execute({ itemId: 'study.rsi14' }));
		expect(
			body.suggestions as string[],
			`expected study.rsi to be suggested, got ${JSON.stringify(body.suggestions)}`
		).toContain('study.rsi');
	});

	it('test_a_missing_item_id_is_rejected', async () => {
		const result = await tool.execute({});
		expect(result.isError, 'a missing itemId must be an error').toBe(true);
	});

	it('test_provenance_identifies_the_catalog_as_a_static_in_app_source', async () => {
		const provenance = (await describeItem('study.sma')).provenance as Record<string, unknown>;
		expect(provenance.sourceId, 'the source must be the built-in catalog').toBe(
			'src.catalog.builtin'
		);
		expect(provenance.delivery, 'a shipped catalog is static').toBe('static');
		expect(provenance.engineVersion, 'the engine version must be stated').toBeTruthy();
	});

	it('test_the_tool_takes_no_mutation_parameters', () => {
		const schema = tool.inputSchema as { properties: Record<string, unknown> };
		for (const key of ['expected_revision', 'idempotency_key', 'undo_token']) {
			expect(key in schema.properties, `a read-only tool must not declare "${key}"`).toBe(false);
		}
	});
});
