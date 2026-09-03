// End-to-end coverage of the screener group (T-1009-10 AC1): the six tools
// are built from one builder, exercised through the built specs, and
// asserted not to collide with any of the new-surface tool groups they
// coexist with. Follows webmcp/discovery/group.test.ts's pattern.
//
// T-1015-5: this used to also assert no collision with the legacy 11-tool
// surface, built via `buildTools({} as ResearchEngine)`. That coexistence
// constraint no longer applies now that the legacy surface is gone, so that
// specific collision test retired with it.

import { describe, expect, it } from 'vitest';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createOperationRegistry } from '../../workbench/application/operationRegistry';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import type { Clock } from '../../workbench/domain/ports';
import { makeProvenance } from '../../workbench/domain/provenance';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { buildPanelTools, createMaximizedPanelState } from '../../panels/tools/panelTools';
import { createPanelRegistry } from '../../panels/registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../../panels/registry/sourceRendererRegistry';
import { createLayoutTemplateRegistry } from '../../panels/domain/layoutTemplates';
import type { ToolSpec } from '../types';
import { buildDiscoveryTools } from '../discovery/group';
import { createUnavailableInstrumentDirectory } from '../../discovery/unavailableDirectory';
import { buildWorkbenchTools } from '../../workbench/tools/index';
import { buildSafetyTools } from '../../workbench/tools/safetyTools';
import { createPreviewStore } from '../../workbench/infra/previewStore';
import { buildScreenerTools, SCREENER_TOOL_NAMES } from './group';

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

const FIXED_PROVENANCE = makeProvenance({
	asOf: '2026-01-01T00:00:00.000Z',
	sourceId: 'src.test.fixture',
	sourceLabel: 'Test fixture',
	liveness: 'static',
	timezone: 'UTC'
});

function testDeps(): WorkbenchDeps {
	const repository = createLocalWorkspaceRepository(memoryStorage());
	const clock = fixedClock('2026-01-01T00:00:00.000Z');
	const ids = createIdSequencer();
	const idempotency = createIdempotencyCache();
	return {
		repository,
		revisions: createRevisionService({ repository, clock, ids, idempotency }),
		history: createChangeHistory(),
		registry: createOperationRegistry(),
		provenance: { current: () => FIXED_PROVENANCE },
		clock,
		ids,
		idempotency
	};
}

function group(): ToolSpec[] {
	return buildScreenerTools(testDeps());
}

describe('buildScreenerTools', () => {
	it('test_the_builder_exposes_exactly_the_six_canonical_tool_names', () => {
		const names = group()
			.map((t) => t.name)
			.sort();
		expect(names, `unexpected screener tool set: ${JSON.stringify(names)}`).toEqual(
			[...SCREENER_TOOL_NAMES].sort()
		);
	});

	it('test_every_tool_name_is_unique_and_snake_case', () => {
		const names = group().map((t) => t.name);
		expect(new Set(names).size, 'expected no duplicate tool names').toBe(names.length);
		for (const name of names) {
			expect(name, `"${name}" is not snake_case`).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
		}
	});

	it('test_every_tool_declares_a_description_and_input_schema', () => {
		for (const spec of group()) {
			expect(
				spec.description.length,
				`"${spec.name}" has no usable description; it is an agent's only documentation`
			).toBeGreaterThan(20);
			expect(spec.inputSchema, `"${spec.name}" has no input schema`).toBeDefined();
			const schema = spec.inputSchema as { type?: string };
			expect(schema.type, `"${spec.name}"'s input schema must describe an object`).toBe('object');
		}
	});

	it('test_every_tool_is_callable_with_typeof_execute_function', () => {
		for (const spec of group()) {
			expect(typeof spec.execute, `"${spec.name}" must be callable`).toBe('function');
			expect(spec.available(), `"${spec.name}" should always be available`).toBe(true);
		}
	});

	it('test_no_screener_name_collides_with_the_workbench_or_safety_tools', () => {
		const deps = testDeps();
		const previews = createPreviewStore({ clock: deps.clock });
		const existing = [...buildWorkbenchTools(deps), ...buildSafetyTools({ ...deps, previews })].map(
			(t) => t.name
		);
		const collisions = group()
			.map((t) => t.name)
			.filter((name) => existing.includes(name));
		expect(
			collisions,
			`screener tools must not collide with workbench tools: ${JSON.stringify(collisions)}`
		).toEqual([]);
	});

	it('test_no_screener_name_collides_with_the_panel_tools', () => {
		const existing = buildPanelTools({
			...testDeps(),
			workspaceId: 'workspace_1',
			kinds: createPanelRegistry(),
			sourceRenderer: createSourceRendererRegistry(),
			templates: createLayoutTemplateRegistry(),
			maximized: createMaximizedPanelState()
		}).map((t) => t.name);
		const collisions = group()
			.map((t) => t.name)
			.filter((name) => existing.includes(name));
		expect(
			collisions,
			`screener tools must not collide with panel tools: ${JSON.stringify(collisions)}`
		).toEqual([]);
	});

	it('test_no_screener_name_collides_with_the_discovery_tools', () => {
		const existing = buildDiscoveryTools({
			directory: createUnavailableInstrumentDirectory()
		}).map((t) => t.name);
		const collisions = group()
			.map((t) => t.name)
			.filter((name) => existing.includes(name));
		expect(
			collisions,
			`screener tools must not collide with discovery tools: ${JSON.stringify(collisions)}`
		).toEqual([]);
	});

	it('test_dependencies_are_parameters_so_a_real_catalog_drops_in_unedited', async () => {
		const deps = testDeps();
		const created = await buildScreenerTools(deps)
			.find((t) => t.name === 'create_screener')!
			.execute({ workspace_id: 'workspace_1', name: 'My Screener' });
		expect(created.isError, `create_screener failed: ${JSON.stringify(created)}`).toBeFalsy();
	});
});
