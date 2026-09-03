// Cross-cutting ACs: the fourteen-tool roster (AC1), stable-id-only
// addressing (AC8), the AC9/AC10 error shape, testability without a
// browser (AC11), and -- the ticket's real point -- AC3's registry-driven
// schema generation, proven by registering brand-new fictional
// definitions into isolated registries and rebuilding the tools with no
// edit to any file in this directory.
import { describe, expect, it } from 'vitest';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import type { Clock } from '../../workbench/domain/ports';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import { createLayoutTemplateRegistry } from '../domain/layoutTemplates';
import { createPanelRegistry } from '../registry/panelKindRegistry';
import { createSourceRendererRegistry } from '../registry/sourceRendererRegistry';
import { createMaximizedPanelState } from './maximizedState';
import { buildPanelTools, type PanelToolDeps } from './panelTools';
import { createPanelToolTestHarness } from './testSupport';

const TOOL_NAMES = [
	'create_panel',
	'duplicate_panel',
	'remove_panel',
	'set_panel_layout',
	'apply_layout_template',
	'split_panel',
	'maximize_panel',
	'bind_panel_source',
	'set_panel_renderer',
	'configure_chart_grid',
	'configure_panel_view',
	'link_panels',
	'unlink_panels',
	'set_panel_selection',
	'reset_layout'
];

describe('buildPanelTools', () => {
	it('AC1/AC11: builds all fifteen tools with no browser and no document.modelContext (hotfix/panel-system: reset_layout)', () => {
		const deps = createPanelToolTestHarness();
		const tools = buildPanelTools(deps);
		expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
		for (const spec of tools) {
			expect(spec.available(), `${spec.name} must always be available`).toBe(true);
			expect(spec.description.length, `${spec.name} needs a real description`).toBeGreaterThan(20);
		}
	});

	it('AC1: every description states what it does and what it returns', () => {
		const deps = createPanelToolTestHarness();
		const tools = buildPanelTools(deps);
		for (const spec of tools) {
			if (spec.name === 'maximize_panel') {
				// AC2's documented exception: no mutation envelope to name.
				expect(spec.description).toMatch(/returns/i);
				continue;
			}
			expect(spec.description, `${spec.name} must say it returns the mutation envelope`).toMatch(
				/mutation envelope/i
			);
		}
	});

	it('AC2: maximize_panel is the one tool whose schema omits expected_revision/idempotency_key', () => {
		const deps = createPanelToolTestHarness();
		const tools = buildPanelTools(deps);
		for (const spec of tools) {
			const schema = spec.inputSchema as { properties?: Record<string, unknown> };
			const hasRevisionFields =
				schema.properties?.expected_revision !== undefined &&
				schema.properties?.idempotency_key !== undefined;
			if (spec.name === 'maximize_panel') {
				expect(hasRevisionFields, 'maximize_panel must not accept revision fields').toBe(false);
			} else {
				expect(
					hasRevisionFields,
					`${spec.name} must accept expected_revision/idempotency_key`
				).toBe(true);
			}
		}
	});

	it('AC8: no tool accepts a positional or ordinal panel field (index/position/ordinal)', () => {
		const deps = createPanelToolTestHarness();
		const tools = buildPanelTools(deps);
		for (const spec of tools) {
			const flat = JSON.stringify(spec.inputSchema).toLowerCase();
			expect(flat, `${spec.name} schema must not expose an ordinal panel reference`).not.toMatch(
				/"(index|position|ordinal)"/
			);
		}
	});

	it('AC9: a failed call is always isError:true, never a bare success envelope', async () => {
		const deps = createPanelToolTestHarness();
		const tools = buildPanelTools(deps);
		const removePanel = tools.find((t) => t.name === 'remove_panel')!;
		const result = await removePanel.execute({ panel_id: 'does_not_exist' });
		expect(result.isError, `expected failure, got ${JSON.stringify(result)}`).toBe(true);
	});

	it('AC10: revision_conflict and idempotency_conflict are each named distinctly', async () => {
		const deps = createPanelToolTestHarness();
		const tools = buildPanelTools(deps);
		const createPanelTool = tools.find((t) => t.name === 'create_panel')!;

		const conflict = await createPanelTool.execute({ kind: 'chart', expected_revision: 5 });
		const conflictPayload = JSON.parse(conflict.content[0]!.text) as { error: string };
		expect(conflictPayload.error).toBe('revision_conflict');

		await createPanelTool.execute({ kind: 'chart', idempotency_key: 'dup' });
		const replay = await createPanelTool.execute({ kind: 'alerts', idempotency_key: 'dup' });
		const replayPayload = JSON.parse(replay.content[0]!.text) as { error: string };
		expect(replayPayload.error).toBe('idempotency_conflict');

		expect(
			conflictPayload.error,
			'a conflict and a replay must be distinguishable from each other'
		).not.toBe(replayPayload.error);
	});

	describe('AC3: schemas are generated from the registries, not hardcoded', () => {
		function buildDepsWithFictionalRegistrations(): PanelToolDeps {
			const repository = createLocalWorkspaceRepository(memoryStorage());
			const clockState = { now: '2026-01-01T00:00:00.000Z' };
			const clock: Clock = { now: () => clockState.now };
			const ids = createIdSequencer();

			const kinds = createPanelRegistry();
			kinds.register({
				kind: 'fictional_kind',
				defaultTitle: 'Fictional',
				defaultSize: { colSpan: 1, rowSpan: 1 },
				minSize: { colSpan: 1, rowSpan: 1 },
				defaultConfig: () => ({}),
				validateConfig: (input) => ({ ok: true, value: input as Record<string, unknown> }),
				configSchema: {
					type: 'object',
					properties: { fictional_field: { type: 'string' } }
				},
				linkChannels: [],
				bindingTypes: ['fictional_source'],
				defaultRenderer: 'fictional_renderer',
				component: async () => ({})
			});

			const sourceRenderer = createSourceRendererRegistry();
			sourceRenderer.registerRendererType({
				name: 'fictional_renderer',
				configSchema: {
					type: 'object',
					properties: { fictional_renderer_field: { type: 'string' } }
				},
				validateConfig: (input) => ({ ok: true, value: input as Record<string, unknown> }),
				defaultConfig: () => ({}),
				acceptedSourceTypes: ['fictional_source']
			});
			sourceRenderer.registerSourceType({
				name: 'fictional_source',
				refSchema: { type: 'object', properties: { fictional_ref: { type: 'string' } } },
				validateRef: (input) => ({ ok: true, value: input as Record<string, unknown> }),
				isCompatible: () => true,
				compatibilityDescription: 'fictional source, always compatible'
			});

			const templates = createLayoutTemplateRegistry();
			templates.register({
				name: 'fictional_template',
				slots: [{ col: 0, row: 0, colSpan: 6, rowSpan: 4 }]
			});

			return {
				workspaceId: 'workspace_1',
				repository,
				revisions: createRevisionService({
					repository,
					clock,
					ids,
					idempotency: createIdempotencyCache()
				}),
				history: createChangeHistory(),
				clock,
				ids,
				kinds,
				sourceRenderer,
				templates,
				maximized: createMaximizedPanelState()
			};
		}

		it('a fictional kind/source/renderer/template surface in the schemas with no edit to tools/', () => {
			const deps = buildDepsWithFictionalRegistrations();
			const tools = buildPanelTools(deps);

			const createPanelSchema = tools.find((t) => t.name === 'create_panel')!.inputSchema as {
				properties: {
					kind: { enum: string[] };
					source: { properties: { type: { enum: string[] } } };
					renderer: { enum: (string | null)[] };
				};
				'x-kind-config-schemas': Record<string, object>;
				'x-renderer-config-schemas': Record<string, object>;
				'x-source-ref-schemas': Record<string, object>;
			};
			expect(createPanelSchema.properties.kind.enum, 'kind enum').toContain('fictional_kind');
			expect(
				createPanelSchema.properties.source.properties.type.enum,
				'source type enum'
			).toContain('fictional_source');
			expect(createPanelSchema.properties.renderer.enum, 'renderer enum').toContain(
				'fictional_renderer'
			);
			expect(createPanelSchema['x-kind-config-schemas'].fictional_kind).toEqual({
				type: 'object',
				properties: { fictional_field: { type: 'string' } }
			});
			expect(createPanelSchema['x-renderer-config-schemas'].fictional_renderer).toEqual({
				type: 'object',
				properties: { fictional_renderer_field: { type: 'string' } }
			});
			expect(createPanelSchema['x-source-ref-schemas'].fictional_source).toEqual({
				type: 'object',
				properties: { fictional_ref: { type: 'string' } }
			});

			const templateSchema = tools.find((t) => t.name === 'apply_layout_template')!.inputSchema as {
				properties: { template_name: { enum: string[] } };
			};
			expect(templateSchema.properties.template_name.enum).toContain('fictional_template');

			const rendererSchema = tools.find((t) => t.name === 'set_panel_renderer')!.inputSchema as {
				properties: { renderer: { enum: string[] } };
			};
			expect(rendererSchema.properties.renderer.enum).toContain('fictional_renderer');

			const bindSchema = tools.find((t) => t.name === 'bind_panel_source')!.inputSchema as {
				properties: { source: { properties: { type: { enum: string[] } } } };
			};
			expect(bindSchema.properties.source.properties.type.enum).toContain('fictional_source');
		});

		it('end-to-end: create_panel actually accepts the fictional kind', async () => {
			const deps = buildDepsWithFictionalRegistrations();
			const tools = buildPanelTools(deps);
			const createPanelTool = tools.find((t) => t.name === 'create_panel')!;
			const result = await createPanelTool.execute({ kind: 'fictional_kind' });
			expect(result.isError, `expected success, got ${JSON.stringify(result)}`).not.toBe(true);
		});
	});
});
