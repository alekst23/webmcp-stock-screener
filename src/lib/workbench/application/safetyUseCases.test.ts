import { describe, expect, it } from 'vitest';
// This file's own source, so a test can assert it names no operation kind
// beyond what a caller registers (epic AC8, extensibility).
import safetyUseCasesSource from './safetyUseCases.ts?raw';
import { StorageWriteError } from '../domain/errors';
import { createIdSequencer } from '../domain/ids';
import type { ResourceId } from '../domain/ids';
import type { Clock, WorkspaceRepository } from '../domain/ports';
import { SafetyError } from '../domain/previewErrors';
import type { ChangeBatch } from '../domain/preview';
import { emptyWorkspace } from '../domain/workspace';
import type { PanelLink, PanelRecord, WorkspaceDocument } from '../domain/workspace';
import { diffWorkspaces } from '../domain/workspaceDiff';
import { createPreviewStore } from '../infra/previewStore';
import { createLocalWorkspaceRepository } from '../infra/workspaceRepository';
import { memoryStorage } from '../testSupport';
import { createChangeHistory, undoChange } from './changeHistory';
import { createIdempotencyCache } from './idempotency';
import { createOperationRegistry } from './operationRegistry';
import type { OperationDefinition, OperationRegistry } from './operationRegistry';
import { createRevisionService } from './revisionService';
import { applyPreviewedChanges, previewWorkspaceChanges } from './safetyUseCases';
import type { SafetyDeps } from './safetyUseCases';

const NOW = '2026-01-01T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';

function fixedClock(iso: string = NOW): Clock {
	return { now: () => iso };
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

function link(id: ResourceId, source: ResourceId, target: ResourceId): PanelLink {
	return { id, sourcePanelId: source, targetPanelId: target, channel: 'symbol' };
}

// Every part overridable, so a test can make exactly one of validate,
// describe or apply misbehave and leave the rest ordinary.
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

function renamePanelOp(kind: string, id: ResourceId, newTitle: string): OperationDefinition {
	return defineOperation(kind, {
		describe: () => `Rename panel to ${newTitle}.`,
		apply: (_input, doc) => ({
			document: {
				...doc,
				panels: doc.panels.map((p) => (p.id === id ? { ...p, title: newTitle } : p))
			},
			affectedIds: [id],
			diffSummary: `Renamed panel to ${newTitle}.`
		})
	});
}

function addLinkOp(
	kind: string,
	id: ResourceId,
	source: ResourceId,
	target: ResourceId
): OperationDefinition {
	return defineOperation(kind, {
		describe: () => `Link ${source} to ${target}.`,
		apply: (_input, doc) => ({
			document: { ...doc, links: [...doc.links, link(id, source, target)] },
			affectedIds: [id],
			diffSummary: 'Linked panels.'
		})
	});
}

function noopOp(kind: string): OperationDefinition {
	return defineOperation(kind, {
		describe: () => 'No-op.',
		apply: (_input, doc) => ({ document: doc, affectedIds: [], diffSummary: '' })
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
		repository?: WorkspaceRepository;
		registry?: OperationRegistry;
	} = {}
): SafetyDeps {
	const repository = params.repository ?? createLocalWorkspaceRepository(memoryStorage());
	const clock = fixedClock();
	const ids = createIdSequencer();
	const idempotency = createIdempotencyCache();
	return {
		repository,
		revisions: createRevisionService({ repository, clock, ids, idempotency }),
		history: createChangeHistory(),
		registry: params.registry ?? createOperationRegistry(),
		// The real infra component, not a hand-rolled fake, with deterministic
		// tokens so a test can assert exact preview ids if it wants to.
		previews: createPreviewStore({ clock, randomToken: sequentialToken() }),
		idempotency,
		clock,
		ids
	};
}

function sequentialToken(): () => string {
	let n = 0;
	return () => `t${(n += 1)}`;
}

function seedWorkspace(
	deps: SafetyDeps,
	document: WorkspaceDocument = emptyWorkspace(WORKSPACE_ID, 'WS', NOW)
) {
	deps.repository.put(document);
	return document;
}

function expectSafetyError(
	run: () => unknown,
	reason: SafetyError['reason'],
	why: string
): SafetyError {
	let thrown: unknown;
	try {
		run();
	} catch (err) {
		thrown = err;
	}
	expect(thrown, why).toBeInstanceOf(SafetyError);
	const safetyError = thrown as SafetyError;
	expect(safetyError.reason, `${why} (reason)`).toBe(reason);
	return safetyError;
}

describe('previewWorkspaceChanges: what it returns (AC1)', () => {
	it('returns preview id, base revision, diff, affected ids, summary, warnings and applicable', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);

		const result = previewWorkspaceChanges(
			{ batch: batch('panels.add'), workspaceId: WORKSPACE_ID },
			deps
		);

		expect(result.previewId, 'a preview id was minted').toMatch(/^preview_/);
		expect(result.baseRevision, "the base revision is the workspace's current revision").toBe(1);
		expect(result.diff.length, 'the diff reflects the added panel').toBe(1);
		expect(result.affectedIds, 'affected ids come from the diff').toEqual(['panel_x']);
		expect(result.summary, 'a human summary is produced').toContain('Added');
		expect(result.warnings, 'no warnings for a clean batch').toEqual([]);
		expect(result.applicable, 'a valid batch is applicable').toBe(true);
	});
});

describe('previewWorkspaceChanges: workspace resolution', () => {
	it("defaults workspaceId to the repository's active id", () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		deps.repository.setActiveId(WORKSPACE_ID);

		const result = previewWorkspaceChanges({ batch: batch('panels.add') }, deps);

		expect(result.baseRevision, 'resolved the active workspace').toBe(1);
	});

	it('fails with invalid_input when no workspace id is given and none is active', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });

		expectSafetyError(
			() => previewWorkspaceChanges({ batch: batch('panels.add') }, deps),
			'invalid_input',
			'no workspace at all is a caller mistake'
		);
	});
});

describe('previewWorkspaceChanges: never mutates the repository (AC2)', () => {
	it('for a valid batch', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const before = structuredClone(deps.repository.get(WORKSPACE_ID));

		const result = previewWorkspaceChanges(
			{ batch: batch('panels.add'), workspaceId: WORKSPACE_ID },
			deps
		);

		expect(result.applicable, 'sanity: the batch is valid').toBe(true);
		expect(deps.repository.get(WORKSPACE_ID), 'a valid preview writes nothing').toEqual(before);
	});

	it('for a batch that fails validation', () => {
		const deps = buildDeps({
			registry: registryWith(defineOperation('panels.rejected', { validate: () => ['bad input'] }))
		});
		seedWorkspace(deps);
		const before = structuredClone(deps.repository.get(WORKSPACE_ID));

		const result = previewWorkspaceChanges(
			{ batch: batch('panels.rejected'), workspaceId: WORKSPACE_ID },
			deps
		);

		expect(result.applicable, 'sanity: the batch fails validation').toBe(false);
		expect(deps.repository.get(WORKSPACE_ID), 'an invalid preview still writes nothing').toEqual(
			before
		);
	});

	it('for an empty-diff (no-op) batch', () => {
		const deps = buildDeps({ registry: registryWith(noopOp('panels.noop')) });
		seedWorkspace(deps);
		const before = structuredClone(deps.repository.get(WORKSPACE_ID));

		const result = previewWorkspaceChanges(
			{ batch: batch('panels.noop'), workspaceId: WORKSPACE_ID },
			deps
		);

		expect(result.diff, 'sanity: nothing changed').toEqual([]);
		expect(deps.repository.get(WORKSPACE_ID), 'a no-op preview still writes nothing').toEqual(
			before
		);
	});

	it('leaves the workspace untouched even for an empty batch (rejected before evaluation)', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const before = structuredClone(deps.repository.get(WORKSPACE_ID));

		expect(() => previewWorkspaceChanges({ batch: [], workspaceId: WORKSPACE_ID }, deps)).toThrow(
			SafetyError
		);
		expect(
			deps.repository.get(WORKSPACE_ID),
			'the reject-early path writes nothing either'
		).toEqual(before);
	});
});

describe('applyPreviewedChanges: applying a valid current preview (AC3)', () => {
	it('advances the workspace by exactly one revision and returns the full envelope', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.add'), workspaceId: WORKSPACE_ID },
			deps
		);

		const envelope = applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps);

		expect(envelope.changeId, 'a change id is minted').toMatch(/^change_/);
		expect(envelope.newRevision, 'revision advances by exactly one').toBe(2);
		expect(deps.repository.get(WORKSPACE_ID)?.revision, 'the stored workspace agrees').toBe(2);
		expect(envelope.affectedIds).toEqual(['panel_x']);
		expect(envelope.diffSummary.length, 'a human summary is present').toBeGreaterThan(0);
		expect(envelope.warnings).toEqual([]);
		expect(envelope.undoToken, 'an undoable change gets a token').toMatch(/^undo_/);
	});
});

describe('honesty: apply produces exactly what preview reported (AC4)', () => {
	function expectHonestApply(deps: SafetyDeps, changeBatch: ChangeBatch, why: string): void {
		const before = structuredClone(deps.repository.get(WORKSPACE_ID)) as WorkspaceDocument;

		const preview = previewWorkspaceChanges(
			{ batch: changeBatch, workspaceId: WORKSPACE_ID },
			deps
		);
		expect(preview.applicable, `${why}: the preview must be applicable`).toBe(true);

		const envelope = applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps);

		expect(envelope.affectedIds, `${why}: affected ids equal the preview's`).toEqual(
			preview.affectedIds
		);
		expect(envelope.diffSummary, `${why}: the summary equals the preview's`).toBe(preview.summary);

		const after = deps.repository.get(WORKSPACE_ID) as WorkspaceDocument;
		expect(
			diffWorkspaces(before, after),
			`${why}: the real stored diff equals the previewed diff`
		).toEqual(preview.diff);
	}

	it('single-operation batch', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		expectHonestApply(deps, batch('panels.add'), 'a single-operation batch');
	});

	it('multi-operation batch, where the second operation acts on the first’s effect', () => {
		const deps = buildDeps({
			registry: registryWith(
				addPanelOp('panels.add', 'panel_x', 'X'),
				renamePanelOp('panels.rename', 'panel_x', 'Renamed')
			)
		});
		seedWorkspace(deps);
		expectHonestApply(deps, batch('panels.add', 'panels.rename'), 'a multi-operation batch');
	});

	it('multi-entity batch touching both panels and links', () => {
		const deps = buildDeps({
			registry: registryWith(
				addPanelOp('panels.add', 'panel_2', 'Second'),
				addLinkOp('links.add', 'link_1', 'panel_seed', 'panel_2')
			)
		});
		seedWorkspace(deps, {
			...emptyWorkspace(WORKSPACE_ID, 'WS', NOW),
			panels: [panel('panel_seed', 'Seed')]
		});
		expectHonestApply(deps, batch('panels.add', 'links.add'), 'a multi-entity batch');
	});

	it('no-op batch', () => {
		const deps = buildDeps({ registry: registryWith(noopOp('panels.noop')) });
		seedWorkspace(deps);
		expectHonestApply(deps, batch('panels.noop'), 'a no-op batch');
	});
});

describe('applyPreviewedChanges: stale revision (AC5)', () => {
	it('refuses when the workspace advanced independently, then succeeds after re-preview', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.add'), workspaceId: WORKSPACE_ID },
			deps
		);
		expect(preview.baseRevision, 'sanity: preview taken at revision 1').toBe(1);

		// Someone else advances the workspace independently of this preview.
		deps.revisions.commit({
			workspaceId: WORKSPACE_ID,
			context: { expectedRevision: 1, actor: 'agent' },
			mutate: (doc) => ({ document: doc, affectedIds: [], diffSummary: 'Unrelated change.' })
		});
		expect(deps.repository.get(WORKSPACE_ID)?.revision, 'sanity: workspace moved to N+1').toBe(2);

		const error = expectSafetyError(
			() => applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps),
			'stale_revision',
			'a stale preview must be refused'
		);
		expect(error.message, 'the message names the previewed revision').toContain('1');
		expect(error.message, 'the message names the current revision').toContain('2');
		expect(
			deps.repository.get(WORKSPACE_ID)?.revision,
			'the failed apply moved nothing further'
		).toBe(2);

		const rePreview = previewWorkspaceChanges(
			{ batch: batch('panels.add'), workspaceId: WORKSPACE_ID },
			deps
		);
		expect(rePreview.baseRevision, 'the re-preview is based on the current revision').toBe(2);
		const envelope = applyPreviewedChanges(
			{ previewId: rePreview.previewId, actor: 'agent' },
			deps
		);
		expect(envelope.newRevision, 'the re-previewed batch applies successfully').toBe(3);
	});
});

describe('applyPreviewedChanges: precondition mismatch (AC6)', () => {
	it('refuses when expectedRevision matches neither the preview base nor the current revision', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.add'), workspaceId: WORKSPACE_ID },
			deps
		);
		const before = structuredClone(deps.repository.get(WORKSPACE_ID));

		expectSafetyError(
			() =>
				applyPreviewedChanges(
					{ previewId: preview.previewId, expectedRevision: 99, actor: 'agent' },
					deps
				),
			'precondition_mismatch',
			'a mismatched expected_revision must be refused'
		);
		expect(deps.repository.get(WORKSPACE_ID), 'nothing was mutated').toEqual(before);
	});
});

describe('applyPreviewedChanges: not applicable (AC7)', () => {
	it('refuses a preview carrying validation failures and mutates nothing', () => {
		const deps = buildDeps({
			registry: registryWith(defineOperation('panels.rejected', { validate: () => ['bad input'] }))
		});
		seedWorkspace(deps);
		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.rejected'), workspaceId: WORKSPACE_ID },
			deps
		);
		expect(preview.applicable).toBe(false);
		const before = structuredClone(deps.repository.get(WORKSPACE_ID));

		expectSafetyError(
			() => applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps),
			'not_applicable',
			'an inapplicable preview must be refused'
		);
		expect(deps.repository.get(WORKSPACE_ID), 'workspace untouched').toEqual(before);
		expect(
			deps.history.list(WORKSPACE_ID),
			'a failed apply issues no token or history record'
		).toEqual([]);
	});

	it('also refuses when a handler validates cleanly but throws inside apply() (reject-early, not rollback)', () => {
		const deps = buildDeps({
			registry: registryWith(
				defineOperation('panels.explodes', {
					validate: () => [],
					apply: () => {
						throw new Error('handler blew up during evaluation');
					}
				})
			)
		});
		seedWorkspace(deps);
		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.explodes'), workspaceId: WORKSPACE_ID },
			deps
		);

		expect(
			preview.applicable,
			'a throwing apply() surfaces as an evaluation failure, not an uncaught exception'
		).toBe(false);
		expectSafetyError(
			() => applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps),
			'not_applicable',
			'this is the reject-early path, distinct from the AC8 rollback tests below'
		);
	});
});

describe('applyPreviewedChanges: second apply without a key (AC9)', () => {
	it('refuses a second apply of the same preview and issues no second mutation', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.add'), workspaceId: WORKSPACE_ID },
			deps
		);
		const first = applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps);
		expect(first.newRevision).toBe(2);

		expectSafetyError(
			() => applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps),
			'already_applied',
			'a second apply without a key must be refused'
		);
		expect(deps.repository.get(WORKSPACE_ID)?.revision, 'no second mutation').toBe(2);
	});
});

describe('applyPreviewedChanges: idempotent retry (AC10)', () => {
	it('replays the original envelope verbatim for a repeated idempotency key', () => {
		const deps = buildDeps({ registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X')) });
		seedWorkspace(deps);
		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.add'), workspaceId: WORKSPACE_ID },
			deps
		);

		const first = applyPreviewedChanges(
			{ previewId: preview.previewId, idempotencyKey: 'key-1', actor: 'agent' },
			deps
		);
		const second = applyPreviewedChanges(
			{ previewId: preview.previewId, idempotencyKey: 'key-1', actor: 'agent' },
			deps
		);

		expect(second, 'the retry returns the exact original envelope').toEqual(first);
		expect(second.changeId, 'same change_id').toBe(first.changeId);
		expect(second.undoToken, 'same undo_token').toBe(first.undoToken);
		expect(deps.repository.get(WORKSPACE_ID)?.revision, 'revision advanced only once').toBe(2);
	});
});

describe('applyPreviewedChanges: undo (AC11)', () => {
	it('issues exactly one undo token per applied batch, and redeeming it restores pre-apply contents', () => {
		const deps = buildDeps({
			registry: registryWith(
				addPanelOp('panels.add', 'panel_x', 'X'),
				renamePanelOp('panels.rename', 'panel_x', 'Renamed')
			)
		});
		seedWorkspace(deps);
		const before = structuredClone(deps.repository.get(WORKSPACE_ID)) as WorkspaceDocument;

		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.add', 'panels.rename'), workspaceId: WORKSPACE_ID },
			deps
		);
		const envelope = applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps);
		expect(envelope.undoToken, 'exactly one undo token is issued').not.toBeNull();

		const undoEnvelope = undoChange(envelope.undoToken as ResourceId, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: { actor: 'agent' }
		});
		expect(undoEnvelope.newRevision, 'undo is itself a forward, numbered change').toBe(3);

		const restored = deps.repository.get(WORKSPACE_ID) as WorkspaceDocument;
		expect(
			diffWorkspaces(before, restored),
			'redeeming the token restores the pre-apply contents'
		).toEqual([]);
	});
});

describe('applyPreviewedChanges: atomicity / rollback (AC8)', () => {
	function seedFailableRepository(): WorkspaceRepository {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(emptyWorkspace(WORKSPACE_ID, 'WS', NOW));
		return repository;
	}

	it('rolls back when putRevision throws after put has already landed -- the mandatory case', () => {
		const repository = seedFailableRepository();
		const failingRepository: WorkspaceRepository = {
			...repository,
			putRevision: () => {
				throw new StorageWriteError('putRevision failed');
			}
		};
		const deps = buildDeps({
			repository: failingRepository,
			registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X'))
		});
		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.add'), workspaceId: WORKSPACE_ID },
			deps
		);
		const before = structuredClone(deps.repository.get(WORKSPACE_ID));

		expect(
			() => applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps),
			'a failure after put must still propagate to the caller'
		).toThrow(StorageWriteError);

		expect(deps.repository.get(WORKSPACE_ID), 'the pre-apply document is restored').toEqual(before);
		expect(deps.repository.get(WORKSPACE_ID)?.revision, 'the revision did not advance').toBe(1);
		expect(deps.history.list(WORKSPACE_ID), 'no change-history record exists').toEqual([]);
	});

	it('propagates the failure (as a no-op restore) when put itself throws', () => {
		const repository = seedFailableRepository();
		const failingRepository: WorkspaceRepository = {
			...repository,
			put: () => {
				throw new StorageWriteError('put failed');
			}
		};
		const deps = buildDeps({
			repository: failingRepository,
			registry: registryWith(addPanelOp('panels.add', 'panel_x', 'X'))
		});
		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.add'), workspaceId: WORKSPACE_ID },
			deps
		);
		const before = structuredClone(deps.repository.get(WORKSPACE_ID));

		expect(
			() => applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps),
			'a failure before any write must still propagate to the caller'
		).toThrow(StorageWriteError);

		expect(deps.repository.get(WORKSPACE_ID), 'nothing landed in the first place').toEqual(before);
		expect(deps.history.list(WORKSPACE_ID), 'no change-history record exists').toEqual([]);
	});

	it('a validation-time rejection is a distinct, weaker path -- labeled contrast, not AC8 evidence by itself', () => {
		const deps = buildDeps({
			registry: registryWith(defineOperation('panels.rejected', { validate: () => ['bad'] }))
		});
		seedWorkspace(deps);
		const preview = previewWorkspaceChanges(
			{ batch: batch('panels.rejected'), workspaceId: WORKSPACE_ID },
			deps
		);

		expectSafetyError(
			() => applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps),
			'not_applicable',
			'this proves the reject-early path, never touching storage -- the two tests above prove rollback'
		);
	});
});

describe('extensibility: a kind unknown to safetyUseCases.ts (epic AC8)', () => {
	it('drives a novel operation kind through preview and apply', () => {
		const novelKind = 'quasar.entangle_dimensions';
		expect(
			safetyUseCasesSource.includes('quasar'),
			'safetyUseCases.ts must contain no kind-specific logic'
		).toBe(false);

		const registry = registryWith(
			defineOperation(novelKind, {
				describe: () => 'Entangle two dimensions.',
				apply: (_input, doc) => ({
					document: { ...doc, extensions: { ...doc.extensions, quasar: { entangled: true } } },
					affectedIds: [WORKSPACE_ID],
					diffSummary: 'Entangled.'
				})
			})
		);
		const deps = buildDeps({ registry });
		seedWorkspace(deps);

		const preview = previewWorkspaceChanges(
			{ batch: [{ kind: novelKind, input: {} }], workspaceId: WORKSPACE_ID },
			deps
		);
		expect(preview.applicable, 'a registry-only kind previews fine').toBe(true);

		const envelope = applyPreviewedChanges({ previewId: preview.previewId, actor: 'agent' }, deps);

		expect(deps.repository.get(WORKSPACE_ID)?.extensions, 'the effect landed').toEqual({
			quasar: { entangled: true }
		});
		expect(envelope.affectedIds).toEqual([WORKSPACE_ID]);
	});
});
