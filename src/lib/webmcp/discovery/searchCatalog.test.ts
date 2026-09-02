import { describe, expect, it } from 'vitest';
import {
	builtinCatalogRegistry,
	listCatalogItems,
	MAX_CATALOG_RESULTS
} from '../../catalog/registry';
import { CATALOG_KINDS } from '../../catalog/types';
import { createSearchCatalogTool } from './searchCatalog';
import { payload } from './testSupport';

const tool = createSearchCatalogTool(builtinCatalogRegistry);

interface Row {
	id: string;
	kind: string;
	label: string;
	description: string;
	score: number;
	matchedOn: string;
	availability: { status: string; reason: string | null; requiresReferenceData: boolean };
}

async function search(input: unknown): Promise<{ body: Record<string, unknown>; rows: Row[] }> {
	const body = payload(await tool.execute(input));
	return { body, rows: body.items as Row[] };
}

describe('search_catalog', () => {
	it('test_match_by_label_returns_the_summary_row', async () => {
		const { rows } = await search({ query: 'Relative strength index' });
		expect(
			rows[0]?.id,
			`expected study.rsi first, got ${JSON.stringify(rows.map((r) => r.id))}`
		).toBe('study.rsi');
		expect(rows[0]?.kind, 'the kind must be reported').toBe('study');
		expect(rows[0]?.label.length, 'the label must be reported').toBeGreaterThan(0);
		expect(rows[0]?.availability.status, 'availability must be reported').toBeTruthy();
	});

	it('test_search_results_stay_summary_sized', async () => {
		const { rows } = await search({ query: 'rsi' });
		expect(
			'parameters' in (rows[0] as unknown as Record<string, unknown>),
			'search rows must not carry full parameter detail -- that is describe_catalog_item'
		).toBe(false);
	});

	it('test_match_by_alias_finds_an_item_under_a_synonym', async () => {
		const { rows } = await search({ query: 'rvol' });
		expect(
			rows[0]?.id,
			`"rvol" should find relative volume, got ${JSON.stringify(rows.map((r) => r.id))}`
		).toBe('indicator.relative_volume');
		expect(rows[0]?.matchedOn, 'the matched attribute must be reported').toBe('alias');
	});

	it('test_kind_restriction_returns_only_those_kinds', async () => {
		const { rows } = await search({ query: 'volume', kinds: ['field'] });
		const kinds = [...new Set(rows.map((r) => r.kind))];
		expect(kinds, `kind restriction leaked: ${JSON.stringify(kinds)}`).toEqual(['field']);
	});

	it('test_declared_kinds_are_exactly_the_registry_kinds', () => {
		const schema = tool.inputSchema as {
			properties: { kinds: { items: { enum: readonly string[] } } };
		};
		expect(
			[...schema.properties.kinds.items.enum].sort(),
			'the declared kind enum must match the registry'
		).toEqual([...CATALOG_KINDS].sort());
	});

	it('test_empty_query_with_a_kind_enumerates_that_kind', async () => {
		const { body, rows } = await search({ kinds: ['interval'], limit: MAX_CATALOG_RESULTS });
		expect(body.outcome, `expected enumeration, got ${body.outcome}`).toBe('enumeration');
		expect(rows.length, 'enumeration must list every item of the kind').toBe(
			listCatalogItems('interval').length
		);
	});

	it('test_unavailable_items_are_included_and_marked_by_default', async () => {
		const { rows } = await search({ query: 'sector' });
		const sector = rows.find((r) => r.id === 'field.sector');
		expect(sector, 'an unavailable item must still be findable').toBeDefined();
		expect(sector?.availability.status, 'it must be marked unavailable').toBe('unavailable');
		expect(
			sector?.availability.reason,
			'the reason must be carried through to the agent'
		).toBeTruthy();
	});

	it('test_unavailable_items_can_be_excluded_on_request', async () => {
		const { rows } = await search({ query: 'sector', includeUnavailable: false });
		expect(
			rows.some((r) => r.id === 'field.sector'),
			'includeUnavailable:false must drop unavailable items'
		).toBe(false);
	});

	it('test_relevance_ordering_is_descending', async () => {
		const { rows } = await search({ query: 'volume' });
		const scores = rows.map((r) => r.score);
		expect(scores, `not in descending relevance order: ${JSON.stringify(scores)}`).toEqual(
			[...scores].sort((a, b) => b - a)
		);
	});

	it('test_no_match_is_a_success_naming_the_query_and_the_kind_restriction', async () => {
		const result = await tool.execute({ query: 'zzzznothing', kinds: ['study'] });
		expect(result.isError, 'a no-match search is not an error').toBeFalsy();
		const body = payload(result);
		expect(body.outcome, `expected no_matches, got ${body.outcome}`).toBe('no_matches');
		expect(body.note as string, 'the note must name the query').toContain('zzzznothing');
		expect(body.note as string, 'the note must name the kind restriction').toContain('study');
	});

	it('test_limit_is_clamped_and_warned_about', async () => {
		const { body, rows } = await search({ limit: 10_000 });
		expect(body.limit, `expected the limit clamped to ${MAX_CATALOG_RESULTS}`).toBe(
			MAX_CATALOG_RESULTS
		);
		expect(rows.length <= MAX_CATALOG_RESULTS, 'more rows than the maximum were returned').toBe(
			true
		);
		expect(
			(body.warnings as string[]).some((w) => w.includes('clamped')),
			`expected a clamping warning, got ${JSON.stringify(body.warnings)}`
		).toBe(true);
	});

	it('test_provenance_identifies_the_catalog_as_a_static_in_app_source', async () => {
		const { body } = await search({ query: 'rsi' });
		const provenance = body.provenance as Record<string, unknown>;
		expect(provenance.sourceId, `expected the built-in catalog, got ${provenance.sourceId}`).toBe(
			'src.catalog.builtin'
		);
		expect(provenance.liveness, 'a shipped catalog is static, not live').toBe('static');
		expect(provenance.engineVersion, 'the engine version must be stated').toBeTruthy();
	});

	it('test_the_tool_takes_no_mutation_parameters', () => {
		const schema = tool.inputSchema as { properties: Record<string, unknown> };
		for (const key of ['expected_revision', 'idempotency_key', 'undo_token']) {
			expect(key in schema.properties, `a read-only tool must not declare "${key}"`).toBe(false);
		}
	});
});
