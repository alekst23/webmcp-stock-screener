// End-to-end coverage of the discovery group: the three tools are built from
// one builder, exercised through the built specs against the reference-data
// test double, and asserted not to collide with the surface they will
// eventually replace. Follows integration.test.ts's pattern.

import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../catalog/registry';
import { createFakeInstrumentDirectory, fakeInstrument } from '../../discovery/testSupport';
import { createUnavailableInstrumentDirectory } from '../../discovery/unavailableDirectory';
import { buildTools } from '../tools';
import type { ResearchEngine, ToolSpec, WorkspaceState } from '../types';
import { buildDiscoveryTools, DISCOVERY_TOOL_NAMES } from './group';
import { payload } from './testSupport';

const EMPTY_WORKSPACE: WorkspaceState = {
	studies: [],
	setups: [],
	instanceSets: [],
	panels: [],
	focus: null
};

function group(): ToolSpec[] {
	return buildDiscoveryTools({
		directory: createFakeInstrumentDirectory({ instruments: [fakeInstrument()] })
	});
}

function toolNamed(name: string): ToolSpec {
	const spec = group().find((t) => t.name === name);
	if (!spec) {
		throw new Error(`the discovery group did not expose "${name}"`);
	}
	return spec;
}

describe('buildDiscoveryTools', () => {
	it('test_the_builder_exposes_exactly_the_three_canonical_tool_names', () => {
		const names = group()
			.map((t) => t.name)
			.sort();
		expect(names, `unexpected discovery tool set: ${JSON.stringify(names)}`).toEqual(
			[...DISCOVERY_TOOL_NAMES].sort()
		);
	});

	it('test_no_discovery_name_collides_with_the_existing_eleven_tool_surface', () => {
		// A stub engine is enough: only the declared names are read, never called.
		const existing = buildTools({} as ResearchEngine).map((t) => t.name);
		const collisions = group()
			.map((t) => t.name)
			.filter((name) => existing.includes(name));
		expect(
			collisions,
			`the two surfaces cannot coexist until EPIC-1015 retires the old one: ${JSON.stringify(collisions)}`
		).toEqual([]);
	});

	it('test_dependencies_are_parameters_so_a_real_adapter_drops_in_unedited', async () => {
		const withFake = buildDiscoveryTools({
			directory: createFakeInstrumentDirectory({ instruments: [fakeInstrument()] })
		});
		const withDefault = buildDiscoveryTools({
			directory: createUnavailableInstrumentDirectory()
		});
		const fakeBody = payload(
			await withFake.find((t) => t.name === 'search_instruments')!.execute({ query: 'AAPL' })
		);
		const defaultBody = payload(
			await withDefault.find((t) => t.name === 'search_instruments')!.execute({ query: 'AAPL' })
		);
		expect(fakeBody.matchCount, 'the injected directory should have resolved a match').toBe(1);
		expect(defaultBody.outcome, 'the default directory should report an unconfigured source').toBe(
			'source_unavailable'
		);
	});

	it('test_an_explicit_registry_can_be_supplied_and_defaults_to_the_builtin_one', async () => {
		const explicit = buildDiscoveryTools({
			directory: createUnavailableInstrumentDirectory(),
			registry: builtinCatalogRegistry
		});
		const body = payload(
			await explicit.find((t) => t.name === 'search_catalog')!.execute({ query: 'rsi' })
		);
		expect(
			(body.items as unknown[]).length,
			'the supplied registry should have been searched'
		).toBeGreaterThan(0);
	});

	it('test_all_three_tools_are_always_available_with_no_workspace_state', () => {
		for (const spec of group()) {
			expect(
				spec.available(EMPTY_WORKSPACE),
				`"${spec.name}" gated itself behind workspace state; discovery precedes state`
			).toBe(true);
		}
	});

	it('test_every_tool_returns_a_well_formed_result_carrying_provenance', async () => {
		const calls: [string, unknown][] = [
			['search_instruments', { query: 'AAPL' }],
			['search_catalog', { query: 'rsi' }],
			['describe_catalog_item', { itemId: 'study.rsi' }]
		];
		for (const [name, input] of calls) {
			const result = await toolNamed(name).execute(input);
			expect(result.isError, `"${name}" errored on a valid call`).toBeFalsy();
			const provenance = payload(result).provenance as Record<string, unknown>;
			for (const field of [
				'asOf',
				'sourceId',
				'sourceLabel',
				'liveness',
				'timezone',
				'engineVersion'
			]) {
				expect(
					provenance?.[field],
					`"${name}" returned provenance missing "${field}"`
				).toBeTruthy();
			}
		}
	});

	it('test_search_then_describe_round_trips_a_returned_id_into_full_detail', async () => {
		const found = payload(await toolNamed('search_catalog').execute({ query: 'relative volume' }));
		const firstId = (found.items as { id: string }[])[0]?.id;
		expect(firstId, `search_catalog returned nothing to describe: ${JSON.stringify(found)}`).toBe(
			'indicator.relative_volume'
		);

		const described = payload(
			await toolNamed('describe_catalog_item').execute({ itemId: firstId })
		);
		expect(described.id, 'the described item must be the one searched for').toBe(firstId);
		expect(
			(described.parameters as unknown[]).length,
			'the round trip must yield full parameter detail'
		).toBeGreaterThan(0);
		expect(
			(described.outputs as unknown[]).length,
			'the round trip must yield full output detail'
		).toBeGreaterThan(0);
	});

	it('test_every_tool_declares_a_description_an_agent_can_act_on', () => {
		for (const spec of group()) {
			expect(
				spec.description.length,
				`"${spec.name}" has no usable description; it is an agent's only documentation`
			).toBeGreaterThan(120);
		}
	});
});
