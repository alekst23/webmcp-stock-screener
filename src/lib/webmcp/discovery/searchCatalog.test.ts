import { describe, expect, it, vi } from 'vitest';
import type { CatalogRegistry } from '../../catalog/registry';
import {
	builtinCatalogRegistry,
	listCatalogItems,
	MAX_CATALOG_RESULTS
} from '../../catalog/registry';
import { SECTOR_ENUM_VALUES } from '../../catalog/items';
import {
	CATALOG_KINDS,
	type CatalogItem,
	type CatalogMatch,
	type CatalogQuery
} from '../../catalog/types';
import { createSearchCatalogTool, registerSearchCatalogTool } from './searchCatalog';
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
	enumValues?: readonly string[];
}

async function search(input: unknown): Promise<{ body: Record<string, unknown>; rows: Row[] }> {
	const body = payload(await tool.execute(input));
	return { body, rows: body.items as Row[] };
}

// A small fixed inventory, independent of the real catalog, so the
// enumValues passthrough is proven as a general mechanism -- not just true
// of "field.sector" by coincidence of hand-checking that one item.
function fakeRegistryWith(items: readonly CatalogItem[]): CatalogRegistry {
	return {
		getCatalogItem: (id) => items.find((item) => item.id === id),
		listCatalogItems: (kind) => (kind ? items.filter((item) => item.kind === kind) : items),
		searchCatalogItems: (query: CatalogQuery): CatalogMatch[] =>
			items
				.filter((item) => !query.kinds || query.kinds.includes(item.kind))
				.map((item) => ({ item, score: 100, matchedOn: 'id' as const })),
		isOperatorValidForField: () => ({ valid: true }),
		resolveStudy: () => undefined,
		suggestCatalogIds: () => []
	};
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

	describe('T-0026-2: enumerated field values', () => {
		it('AC2: a lookup against field.sector returns its accepted values alongside the existing row fields', async () => {
			const { rows } = await search({ query: 'sector' });
			const sector = rows.find((r) => r.id === 'field.sector');
			expect(sector, 'field.sector must still be findable').toBeDefined();
			expect(sector?.kind, 'the existing kind field must still be reported').toBe('field');
			expect(sector?.label, 'the existing label field must still be reported').toBeTruthy();
			expect(
				sector?.description,
				'the existing description field must still be reported'
			).toBeTruthy();
			expect(
				sector?.enumValues,
				'field.sector must carry its accepted values, not force a second describe_catalog_item call'
			).toEqual(SECTOR_ENUM_VALUES);
		});

		it("AC4: the sector values offered match items.ts's own SECTOR_ENUM_VALUES -- the one place this project declares them", async () => {
			// Guards against the row-shaping code silently drifting from (or
			// re-deriving a second, disagreeing copy of) the catalog's own
			// declared vocabulary. It does not, and cannot, prove the list
			// matches EPIC-0025's backend: see items.ts's SECTOR_ENUM_VALUES
			// comment -- the backend accepts whatever sector strings are in its
			// currently-loaded reference-data CSV, an open runtime set with no
			// shared canonical source this test (or this ticket) can check
			// against.
			const { rows } = await search({ query: 'field.sector' });
			const sector = rows.find((r) => r.id === 'field.sector');
			expect(sector?.enumValues).toEqual(SECTOR_ENUM_VALUES);
		});

		it('AC2 (general mechanism): any enumerated field the catalog declares surfaces its enumValues, not just sector', async () => {
			const enumField = {
				id: 'field.test_enum',
				kind: 'field' as const,
				label: 'Test enum field',
				description: 'A synthetic enumerated field for the general-mechanism test.',
				aliases: [],
				tags: [],
				valueType: 'enum' as const,
				enumValues: ['alpha', 'beta'],
				nullable: false,
				availability: {
					status: 'available' as const,
					requiresReferenceData: false,
					intervalIds: []
				}
			};
			const fakeTool = createSearchCatalogTool(fakeRegistryWith([enumField]));
			const body = payload(await fakeTool.execute({ query: 'test_enum' }));
			const row = (body.items as Row[])[0];
			expect(row?.enumValues, 'a non-sector enumerated field must also expose its values').toEqual([
				'alpha',
				'beta'
			]);
		});

		it('AC3: a field with no declared enum values carries no enumValues key at all', async () => {
			const plainField = {
				id: 'field.test_plain',
				kind: 'field' as const,
				label: 'Test plain field',
				description: 'A synthetic non-enumerated field.',
				aliases: [],
				tags: [],
				valueType: 'number' as const,
				nullable: false,
				availability: {
					status: 'available' as const,
					requiresReferenceData: false,
					intervalIds: []
				}
			};
			const fakeTool = createSearchCatalogTool(fakeRegistryWith([plainField]));
			const body = payload(await fakeTool.execute({ query: 'test_plain' }));
			const row = (body.items as Row[])[0] as unknown as Record<string, unknown>;
			expect(
				'enumValues' in row,
				'a field with no enumValues declared must not gain the key at all'
			).toBe(false);
		});

		it('AC3: every non-field catalog kind is unchanged -- no enumValues key appears on any of them', async () => {
			for (const kind of CATALOG_KINDS) {
				if (kind === 'field') {
					continue;
				}
				const { rows } = await search({ kinds: [kind], limit: MAX_CATALOG_RESULTS });
				for (const row of rows) {
					expect(
						'enumValues' in (row as unknown as Record<string, unknown>),
						`kind "${kind}" (item ${row.id}) must not gain an enumValues key`
					).toBe(false);
				}
			}
		});
	});

	describe('T-0026-2 AC1: registration on the live composition root', () => {
		it('registerSearchCatalogTool registers search_catalog against document.modelContext', async () => {
			const registerTool = vi.fn();
			vi.stubGlobal('document', { modelContext: { registerTool } });
			try {
				await registerSearchCatalogTool();
				expect(registerTool).toHaveBeenCalledTimes(1);
				const registered = registerTool.mock.calls[0]![0] as { name: string };
				expect(registered.name).toBe('search_catalog');
			} finally {
				vi.unstubAllGlobals();
			}
		});
	});
});
