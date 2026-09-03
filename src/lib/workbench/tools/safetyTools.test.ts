import { describe, expect, it, vi } from 'vitest';
// This file's own source, so a test can assert it names no operation kind
// beyond what a caller registers (AC4/AC8: schema and description must come
// from the live registry, never a hardcoded list).
import safetyToolsSource from './safetyTools.ts?raw';
import type { Clock, WorkspaceRepository } from '../domain/ports';
import { createIdSequencer } from '../domain/ids';
import type { ResourceId } from '../domain/ids';
import type { ChangeBatch } from '../domain/preview';
import { emptyWorkspace } from '../domain/workspace';
import type { PanelRecord, WorkspaceDocument } from '../domain/workspace';
import { diffWorkspaces } from '../domain/workspaceDiff';
import { createPreviewStore } from '../infra/previewStore';
import { createLocalWorkspaceRepository } from '../infra/workspaceRepository';
import { memoryStorage } from '../testSupport';
import { createChangeHistory } from '../application/changeHistory';
import { createIdempotencyCache } from '../application/idempotency';
import { createOperationRegistry } from '../application/operationRegistry';
import type { OperationDefinition, OperationRegistry } from '../application/operationRegistry';
import { createRevisionService } from '../application/revisionService';
import { buildSafetyTools } from './safetyTools';
import type { SafetyToolDeps } from './safetyTools';

const NOW = '2026-01-01T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';

function fixedClock(iso: string = NOW): Clock {
	return { now: () => iso };
}

// A clock a test can move forward, for the expired-preview case -- the real
// PreviewStore only knows "now" through Clock.now(), never Date.now().
function mutableClock(iso: string = NOW): Clock & { advance(ms: number): void } {
	let atMs = Date.parse(iso);
	return {
		now: () => new Date(atMs).toISOString(),
		advance(ms: number) {
			atMs += ms;
		}
	};
}

function sequentialToken(): () => string {
	let n = 0;
	return () => `t${(n += 1)}`;
}

function panel(id: ResourceId, title: string): PanelRecord {
	return {
		id,
		kind: 'chart',
		title,
		collapsed: false,
		visible: true,
		boundResourceId: null,
		config: {}
	};
}

// Every part overridable, so a test can make exactly one of validate,
// describe or apply misbehave (or spy on it) and leave the rest ordinary.
function defineOperation(
	kind: string,
	parts: Partial<Omit<OperationDefinition, 'kind' | 'inputSchema'>> = {}
): OperationDefinition {
	return {
		kind,
		inputSchema: {},
		validate: parts.validate ?? (() => []),
		describe: parts.describe ?? (() => `Describe ${kind}.`),
		apply:
			parts.apply ??
			((_input, doc) => ({ document: doc, affectedIds: [], diffSummary: `Applied ${kind}.` }))
	};
}

function addPanelOp(kind: string, id: ResourceId, title: string): OperationDefinition {
	return defineOperation(kind, {
		describe: () => `Add panel ${title}.`,
		apply: (_input, doc) => ({
			document: { ...doc, panels: [...doc.panels, panel(id, title)] },
			affectedIds: [id],
			diffSummary: `Added panel ${title}.`
		})
	});
}

function registryWith(...definitions: OperationDefinition[]): OperationRegistry {
	// A fresh registry per test: mutating the shared singleton would make the
	// suite order-dependent.
	const registry = createOperationRegistry();
	for (const definition of definitions) {
		registry.register(definition);
	}
	return registry;
}

function batch(...kinds: string[]): ChangeBatch {
	return kinds.map((kind) => ({ kind, input: {} }));
}

function buildDeps(
	params: {
		registry?: OperationRegistry;
		repository?: WorkspaceRepository;
		clock?: Clock;
		ttlMs?: number;
	} = {}
): SafetyToolDeps {
	const repository = params.repository ?? createLocalWorkspaceRepository(memoryStorage());
	const clock = params.clock ?? fixedClock();
	const ids = createIdSequencer();
	const idempotency = createIdempotencyCache();
	return {
		repository,
		revisions: createRevisionService({ repository, clock, ids, idempotency }),
		history: createChangeHistory(),
		registry: params.registry ?? createOperationRegistry(),
		previews: createPreviewStore({ clock, randomToken: sequentialToken(), ttlMs: params.ttlMs }),
		idempotency,
		clock,
		ids
	};
}

function seedWorkspace(
	deps: SafetyToolDeps,
	document: WorkspaceDocument = emptyWorkspace(WORKSPACE_ID, 'WS', NOW)
): WorkspaceDocument {
	deps.repository.put(document);
	return document;
}

function tool(deps: SafetyToolDeps, name: string) {
	const found = buildSafetyTools(deps).find((t) => t.name === name);
	if (!found) throw new Error(`no such tool: ${name}`);
	return found;
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): Record<string, unknown> {
	return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

async function preview(
	deps: SafetyToolDeps,
	operations: { kind: string; arguments?: object }[],
	workspaceId: string = WORKSPACE_ID
) {
	const result = await tool(deps, 'preview_workspace_changes').execute({
		operations,
		workspace_id: workspaceId
	});
	return { result, body: jsonOf(result) };
}

async function apply(
	deps: SafetyToolDeps,
	input: { preview_id: unknown; expected_revision?: unknown; idempotency_key?: unknown }
) {
	const result = await tool(deps, 'apply_previewed_changes').execute(input);
	return { result, body: jsonOf(result) };
}

describe('buildSafetyTools: registration (AC1)', () => {
	it('registers exactly preview_workspace_changes and apply_previewed_changes', () => {
		const deps = buildDeps();
		const names = buildSafetyTools(deps)
			.map((t) => t.name)
			.sort();
		expect(names, 'both safety tools must appear with these exact names').toEqual([
			'apply_previewed_changes',
			'preview_workspace_changes'
		]);
	});

	it('both tools are unconditionally available', () => {
		const deps = buildDeps();
		for (const spec of buildSafetyTools(deps)) {
			expect(spec.available(), `${spec.name} must always be available`).toBe(true);
		}
	});
});

describe('buildSafetyTools: schemas and descriptions are generated live from the registry (AC4)', () => {
	it('reflects a two-kind registry differently from a one-kind registry', () => {
		const registryA = registryWith(addPanelOp('area_a.act_one', 'panel_a', 'A'));
		const registryB = registryWith(
			addPanelOp('area_b.act_one', 'panel_b1', 'B1'),
			addPanelOp('area_b.act_two', 'panel_b2', 'B2')
		);

		const previewA = tool(buildDeps({ registry: registryA }), 'preview_workspace_changes');
		const previewB = tool(buildDeps({ registry: registryB }), 'preview_workspace_changes');

		expect(
			previewA.description,
			'the description text must differ when the registered kinds differ'
		).not.toBe(previewB.description);
		expect(previewA.description, "registry A's own kind is named in its description").toContain(
			'area_a.act_one'
		);
		expect(
			previewB.description,
			"registry B's kinds are named in its description, not registry A's"
		).toContain('area_b.act_one');

		type OperationsSchema = {
			properties: { operations: { items: { properties: { kind: { enum?: string[] } } } } };
		};
		const kindSchemaA = (previewA.inputSchema as OperationsSchema).properties.operations.items
			.properties.kind;
		const kindSchemaB = (previewB.inputSchema as OperationsSchema).properties.operations.items
			.properties.kind;
		expect(kindSchemaA.enum, "the kind schema's enum is exactly registry A's kinds").toEqual([
			'area_a.act_one'
		]);
		expect(kindSchemaB.enum, "the kind schema's enum is exactly registry B's kinds").toEqual([
			'area_b.act_one',
			'area_b.act_two'
		]);
	});

	it('reflects an empty registry without throwing and without a stale enum', () => {
		const spec = tool(
			buildDeps({ registry: createOperationRegistry() }),
			'preview_workspace_changes'
		);
		type OperationsSchema = {
			properties: { operations: { items: { properties: { kind: { enum?: string[] } } } } };
		};
		const kindSchema = (spec.inputSchema as OperationsSchema).properties.operations.items.properties
			.kind;
		expect(kindSchema.enum, 'no kinds registered means no enum values to offer').toBeUndefined();
	});

	it('names no operation kind literally in its own source (extensibility, mirrors batchEvaluation.test.ts)', () => {
		const novelKindA = 'zeta_epic.raise_flag';
		const novelKindB = 'omega_epic.lower_flag';
		expect(
			safetyToolsSource.includes(novelKindA) || safetyToolsSource.includes(novelKindB),
			'safetyTools.ts must contain no kind-specific logic; kinds only ever come from deps.registry.kinds()'
		).toBe(false);
	});
});

describe('preview_workspace_changes: unknown kind is a validation failure, not a passthrough (AC5)', () => {
	it('reports applicable:false and never invokes any handler', async () => {
		const validateSpy = vi.fn(() => []);
		const applySpy = vi.fn((_input: unknown, doc: WorkspaceDocument) => ({
			document: doc,
			affectedIds: [],
			diffSummary: 'should never run'
		}));
		const registry = registryWith(
			defineOperation('registered.kind', { validate: validateSpy, apply: applySpy })
		);
		const deps = buildDeps({ registry });
		seedWorkspace(deps);

		const { result, body } = await preview(deps, [{ kind: 'ghost.unregistered', arguments: {} }]);

		expect(result.isError, 'an unknown kind is a successful preview call, not a tool error').toBe(
			undefined
		);
		expect(body.applicable, 'the preview result itself reports not applicable').toBe(false);
		expect((body.failures as unknown[]).length, 'the unknown kind is recorded as a failure').toBe(
			1
		);
		expect(
			validateSpy,
			'no registered handler is invoked for an unknown kind'
		).not.toHaveBeenCalled();
		expect(applySpy, 'no registered handler is invoked for an unknown kind').not.toHaveBeenCalled();
	});
});

describe('every SafetyErrorReason maps to an identifiable tool error (AC6)', () => {
	it('invalid_input: an empty batch', async () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);

		const { result, body } = await preview(deps, []);

		expect(result.isError, 'an empty batch is a tool error').toBe(true);
		expect(body.error, 'the wire error names the reason').toBe('invalid_input');
	});

	it('unknown_preview: an id nothing ever produced', async () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);

		const { result, body } = await apply(deps, { preview_id: 'preview_bogus_1' });

		expect(result.isError).toBe(true);
		expect(body.error).toBe('unknown_preview');
	});

	it('expired_preview: a preview whose TTL has elapsed', async () => {
		const clock = mutableClock();
		const deps = buildDeps({
			registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')),
			clock,
			ttlMs: 5
		});
		seedWorkspace(deps);
		const { body: previewBody } = await preview(deps, [{ kind: 'panels.add' }]);
		clock.advance(10);

		const { result, body } = await apply(deps, { preview_id: previewBody.preview_id });

		expect(result.isError).toBe(true);
		expect(body.error).toBe('expired_preview');
	});

	it('stale_revision: the workspace advanced independently since the preview', async () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const { body: previewBody } = await preview(deps, [{ kind: 'panels.add' }]);
		deps.revisions.commit({
			workspaceId: WORKSPACE_ID,
			context: { expectedRevision: 1, actor: 'agent' },
			mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'Unrelated change.' })
		});

		const { result, body } = await apply(deps, { preview_id: previewBody.preview_id });

		expect(result.isError).toBe(true);
		expect(body.error).toBe('stale_revision');
	});

	it('precondition_mismatch: expected_revision matches neither preview base nor current', async () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const { body: previewBody } = await preview(deps, [{ kind: 'panels.add' }]);

		const { result, body } = await apply(deps, {
			preview_id: previewBody.preview_id,
			expected_revision: 99
		});

		expect(result.isError).toBe(true);
		expect(body.error).toBe('precondition_mismatch');
	});

	it('already_applied: a second apply of the same preview without an idempotency key', async () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const { body: previewBody } = await preview(deps, [{ kind: 'panels.add' }]);
		await apply(deps, { preview_id: previewBody.preview_id });

		const { result, body } = await apply(deps, { preview_id: previewBody.preview_id });

		expect(result.isError).toBe(true);
		expect(body.error).toBe('already_applied');
	});

	it('not_applicable: a preview carrying a validation failure', async () => {
		const deps = buildDeps({
			registry: registryWith(defineOperation('panels.rejected', { validate: () => ['bad input'] }))
		});
		seedWorkspace(deps);
		const { body: previewBody } = await preview(deps, [{ kind: 'panels.rejected' }]);
		expect(previewBody.applicable, 'sanity: the preview is not applicable').toBe(false);

		const { result, body } = await apply(deps, { preview_id: previewBody.preview_id });

		expect(result.isError).toBe(true);
		expect(body.error).toBe('not_applicable');
	});
});

describe('preview then apply, driven through the tool interface (AC2, AC7)', () => {
	it('the applied envelope matches exactly what the preview reported', async () => {
		const deps = buildDeps({
			registry: registryWith(
				addPanelOp('panels.add', 'panel_x', 'X'),
				defineOperation('panels.rename', {
					describe: () => 'Rename panel to Renamed.',
					apply: (_input, doc) => ({
						document: {
							...doc,
							panels: doc.panels.map((p) => (p.id === 'panel_x' ? { ...p, title: 'Renamed' } : p))
						},
						affectedIds: ['panel_x'],
						diffSummary: 'Renamed panel to Renamed.'
					})
				})
			)
		});
		seedWorkspace(deps);

		const { result: previewResult, body: previewBody } = await preview(deps, [
			{ kind: 'panels.add' },
			{ kind: 'panels.rename' }
		]);
		expect(previewResult.isError, 'sanity: the preview call itself succeeds').toBeUndefined();
		expect(previewBody.applicable, 'sanity: the batch is applicable').toBe(true);
		expect(previewBody.preview_id, 'the preview payload carries a preview id').toMatch(/^preview_/);

		const { result: applyResult, body: envelope } = await apply(deps, {
			preview_id: previewBody.preview_id
		});

		expect(
			applyResult.isError,
			'applying a valid preview must not be a tool error'
		).toBeUndefined();
		expect(envelope.affected_ids, "applied affected_ids equal the preview's").toEqual(
			previewBody.affected_ids
		);
		expect(envelope.diff_summary, "applied diff_summary equals the preview's").toBe(
			previewBody.diff_summary
		);
		expect(deps.repository.get(WORKSPACE_ID)?.revision, 'the workspace actually advanced').toBe(2);

		// The stored diff produced by actually applying must equal the diff the
		// preview reported in advance -- the honesty guarantee, checked from
		// outside the use-case layer this time. diffWorkspaces returns the
		// domain shape (camelCase entityType); previewBody.diff is the wire
		// shape the tool actually returned, so the comparison goes through the
		// same wire mapping rather than the domain one.
		const after = deps.repository.get(WORKSPACE_ID)!;
		const realWireDiff = diffWorkspaces(emptyWorkspace(WORKSPACE_ID, 'WS', NOW), after).map(
			(entry) => ({
				change: entry.change,
				entity_type: entry.entityType,
				id: entry.id,
				fields: entry.fields
			})
		);
		expect(realWireDiff, "the real stored diff equals the previewed diff's entries").toEqual(
			previewBody.diff
		);
	});

	it('a repeated idempotency_key replays the original envelope through the tool interface', async () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const { body: previewBody } = await preview(deps, [{ kind: 'panels.add' }]);

		const { body: first } = await apply(deps, {
			preview_id: previewBody.preview_id,
			idempotency_key: 'apply-key-1'
		});
		const { body: second } = await apply(deps, {
			preview_id: previewBody.preview_id,
			idempotency_key: 'apply-key-1'
		});

		expect(second, 'the retry returns the exact original envelope').toEqual(first);
		expect(deps.repository.get(WORKSPACE_ID)?.revision, 'the revision advanced only once').toBe(2);
	});
});

describe('extensibility: a kind registered only inside this test (AC8)', () => {
	it('drives a novel kind through both tools successfully', async () => {
		const novelKind = 'zeta_epic.raise_flag';
		expect(
			safetyToolsSource.includes(novelKind),
			'safetyTools.ts must name no operation kind, including this one'
		).toBe(false);

		const registry = registryWith(
			defineOperation(novelKind, {
				describe: () => 'Raise a flag.',
				apply: (_input, doc) => ({
					document: { ...doc, extensions: { ...doc.extensions, flag: true } },
					affectedIds: [WORKSPACE_ID],
					diffSummary: 'Flag raised.'
				})
			})
		);
		const deps = buildDeps({ registry });
		seedWorkspace(deps);

		const { result: previewResult, body: previewBody } = await preview(deps, [{ kind: novelKind }]);
		expect(previewResult.isError).toBeUndefined();
		expect(previewBody.applicable, 'the novel kind previews as applicable').toBe(true);

		const { result: applyResult } = await apply(deps, { preview_id: previewBody.preview_id });

		expect(applyResult.isError).toBeUndefined();
		expect(deps.repository.get(WORKSPACE_ID)?.extensions, 'the novel effect landed').toEqual({
			flag: true
		});
	});
});

describe('no free-form mutating input (AC9)', () => {
	it('the declared schemas accept only the typed batch or a preview id', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		const previewSchema = tool(deps, 'preview_workspace_changes').inputSchema as {
			properties: Record<string, unknown>;
			required?: string[];
		};
		const applySchema = tool(deps, 'apply_previewed_changes').inputSchema as {
			properties: Record<string, unknown>;
			required?: string[];
		};

		expect(
			Object.keys(previewSchema.properties).sort(),
			'preview accepts only the operation batch and an optional workspace id'
		).toEqual(['operations', 'workspace_id']);
		const operationsItemProps = (
			previewSchema.properties.operations as {
				items: { properties: Record<string, unknown> };
			}
		).items.properties;
		expect(
			Object.keys(operationsItemProps).sort(),
			'each proposed operation carries only its registered kind and typed arguments'
		).toEqual(['arguments', 'kind']);

		expect(
			Object.keys(applySchema.properties).sort(),
			'apply accepts only a preview id plus the common mutation contract fields'
		).toEqual(['expected_revision', 'idempotency_key', 'preview_id']);
	});
});

// T-1015-5: this file used to also carry an "AC10: the existing
// pattern-research surface is unaffected" describe block, proving
// buildTools() from the legacy webmcp/tools.ts still returned its eleven
// tool names byte-for-byte. That regression guard existed only to protect
// the legacy surface while it coexisted with this one; deleted along with
// webmcp/tools.ts rather than left asserting on tool names that no longer
// exist anywhere in the codebase.
