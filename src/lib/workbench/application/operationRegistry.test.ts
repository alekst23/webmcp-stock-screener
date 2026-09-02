import { beforeEach, describe, expect, it } from 'vitest';
import { OperationValidationError, RevisionConflictError } from '../domain/errors';
import { createIdSequencer } from '../domain/ids';
import type { Clock } from '../domain/ports';
import { emptyWorkspace } from '../domain/workspace';
import type { WorkspaceDocument } from '../domain/workspace';
import { createChangeHistory, undoChange } from './changeHistory';
import type { ChangeHistory } from './changeHistory';
import { createIdempotencyCache } from './idempotency';
import {
	applyOperations,
	createOperationRegistry,
	previewOperations,
	type OperationDefinition,
	type OperationRegistry
} from './operationRegistry';
import { createRevisionService } from './revisionService';
import type { RevisionService } from './revisionService';
import { createLocalWorkspaceRepository } from '../infra/workspaceRepository';
import { memoryStorage } from '../testSupport';

interface SetSymbolInput {
	symbol: string;
}

const setSymbolOp: OperationDefinition<SetSymbolInput> = {
	kind: 'test.set_symbol',
	inputSchema: {},
	validate: () => [],
	describe: (input) => `Set active symbol to ${input.symbol}.`,
	apply: (input, doc) => ({
		document: { ...doc, activeSymbol: input.symbol },
		affectedIds: [doc.id],
		diffSummary: `Set active symbol to ${input.symbol}.`,
		inverse: {
			document: { ...doc },
			affectedIds: [doc.id],
			diffSummary: `Reverted active symbol to ${doc.activeSymbol ?? 'none'}.`
		}
	})
};

interface AddPanelInput {
	title: string;
}

const addPanelOp: OperationDefinition<AddPanelInput> = {
	kind: 'test.add_panel',
	inputSchema: {},
	validate: () => [],
	describe: (input) => `Added panel "${input.title}".`,
	apply: (input, doc, ids) => {
		const id = ids.next('panel', 'chart');
		const nextDoc: WorkspaceDocument = {
			...doc,
			panels: [
				...doc.panels,
				{
					id,
					kind: 'chart',
					title: input.title,
					collapsed: false,
					visible: true,
					boundResourceId: null,
					config: {}
				}
			]
		};
		return {
			document: nextDoc,
			affectedIds: [id],
			diffSummary: `Added panel "${input.title}".`,
			inverse: {
				document: { ...doc },
				affectedIds: [id],
				diffSummary: `Removed panel "${input.title}".`
			}
		};
	}
};

interface RenamePanelInput {
	panelId: string;
	title: string;
}

const renamePanelOp: OperationDefinition<RenamePanelInput> = {
	kind: 'test.rename_panel',
	inputSchema: {},
	validate: (input, doc) =>
		doc.panels.some((p) => p.id === input.panelId) ? [] : [`no such panel: ${input.panelId}`],
	describe: (input) => `Renamed panel to "${input.title}".`,
	apply: (input, doc) => {
		const previousTitle = doc.panels.find((p) => p.id === input.panelId)?.title ?? '';
		return {
			document: {
				...doc,
				panels: doc.panels.map((p) => (p.id === input.panelId ? { ...p, title: input.title } : p))
			},
			affectedIds: [input.panelId],
			diffSummary: `Renamed panel to "${input.title}".`,
			inverse: {
				document: { ...doc },
				affectedIds: [input.panelId],
				diffSummary: `Reverted panel title to "${previousTitle}".`
			}
		};
	}
};

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

describe('createOperationRegistry', () => {
	it('registers and looks up an operation by kind', () => {
		const registry = createOperationRegistry();
		registry.register(setSymbolOp);
		expect(registry.get('test.set_symbol')).toBe(setSymbolOp);
		expect(registry.kinds()).toEqual(['test.set_symbol']);
	});

	it('reports an unregistered kind as null rather than crashing', () => {
		const registry = createOperationRegistry();
		expect(registry.get('nothing.here')).toBeNull();
	});

	it('rejects a malformed (non-namespaced) kind', () => {
		const registry = createOperationRegistry();
		expect(() => registry.register({ ...setSymbolOp, kind: 'not_namespaced' })).toThrow();
	});

	it('rejects registering two operations under the same kind', () => {
		const registry = createOperationRegistry();
		registry.register(setSymbolOp);
		expect(() => registry.register(setSymbolOp)).toThrow();
	});
});

describe('previewOperations', () => {
	let registry: OperationRegistry;
	let ids: ReturnType<typeof createIdSequencer>;
	let doc: WorkspaceDocument;

	beforeEach(() => {
		registry = createOperationRegistry();
		registry.register(setSymbolOp);
		registry.register(addPanelOp);
		registry.register(renamePanelOp);
		ids = createIdSequencer();
		doc = emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z');
	});

	it('reports a valid collection with a combined diff summary and affected ids', () => {
		const result = previewOperations([{ kind: 'test.set_symbol', input: { symbol: 'AAPL' } }], {
			registry,
			document: doc,
			ids
		});
		expect(result.valid).toBe(true);
		expect(result.affectedIds).toContain('workspace_1');
		expect(result.diffSummary).toContain('AAPL');
		expect(result.resultingRevision).toBe(doc.revision + 1);
	});

	it('reports an unregistered kind as a per-operation issue rather than throwing', () => {
		const result = previewOperations([{ kind: 'nothing.here', input: {} }], {
			registry,
			document: doc,
			ids
		});
		expect(() =>
			previewOperations([{ kind: 'nothing.here', input: {} }], { registry, document: doc, ids })
		).not.toThrow();
		expect(result.valid).toBe(false);
		expect(result.perOperation[0]?.issues).toEqual(['unknown operation: nothing.here']);
	});

	it('evaluates each operation against the state the preceding ones would produce', () => {
		const result = previewOperations(
			[
				{ kind: 'test.add_panel', input: { title: 'Chart 1' } },
				// References a panel that only exists after the first op runs.
				{ kind: 'test.rename_panel', input: { panelId: 'panel_chart_1', title: 'Renamed' } }
			],
			{ registry, document: doc, ids }
		);
		expect(result.valid).toBe(true);
		expect(result.perOperation[1]?.issues).toEqual([]);
	});

	it('changes no stored state (pure function of its inputs)', () => {
		const before = { ...doc };
		previewOperations([{ kind: 'test.set_symbol', input: { symbol: 'AAPL' } }], {
			registry,
			document: doc,
			ids
		});
		expect(doc).toEqual(before);
	});
});

describe('applyOperations', () => {
	let registry: OperationRegistry;
	let repository: ReturnType<typeof createLocalWorkspaceRepository>;
	let revisionService: RevisionService;
	let history: ChangeHistory;
	let clock: Clock;
	let ids: ReturnType<typeof createIdSequencer>;

	beforeEach(() => {
		registry = createOperationRegistry();
		registry.register(setSymbolOp);
		registry.register(addPanelOp);
		registry.register(renamePanelOp);
		repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(emptyWorkspace('workspace_1', 'Test', '2026-01-01T00:00:00.000Z'));
		clock = fixedClock('2026-01-02T00:00:00.000Z');
		ids = createIdSequencer();
		revisionService = createRevisionService({
			repository,
			clock,
			ids,
			idempotency: createIdempotencyCache()
		});
		history = createChangeHistory();
	});

	function deps() {
		return { registry, workspaceId: 'workspace_1', history, revisionService, clock, ids };
	}

	it('refuses an empty collection with a clear reason', () => {
		expect(() => applyOperations([], { expectedRevision: 1, actor: 'agent' }, deps())).toThrow(
			OperationValidationError
		);
	});

	it('applies a collection as exactly one revision, one change id and one undo token', () => {
		const envelope = applyOperations(
			[
				{ kind: 'test.add_panel', input: { title: 'Chart 1' } },
				{ kind: 'test.set_symbol', input: { symbol: 'AAPL' } }
			],
			{ expectedRevision: 1, actor: 'agent' },
			deps()
		);
		expect(envelope.newRevision).toBe(2);
		expect(envelope.undoToken).not.toBeNull();
		expect(repository.get('workspace_1')?.panels).toHaveLength(1);
		expect(repository.get('workspace_1')?.activeSymbol).toBe('AAPL');
		expect(history.list('workspace_1')).toHaveLength(1);
	});

	it('applies nothing when any operation fails validation, leaving the workspace unchanged', () => {
		const before = repository.get('workspace_1');
		expect(() =>
			applyOperations(
				[
					{ kind: 'test.add_panel', input: { title: 'Chart 1' } },
					{ kind: 'test.rename_panel', input: { panelId: 'panel_nonexistent', title: 'X' } }
				],
				{ expectedRevision: 1, actor: 'agent' },
				deps()
			)
		).toThrow(OperationValidationError);
		expect(repository.get('workspace_1')).toEqual(before);
	});

	it('applies nothing for an unregistered kind, reported as unknown rather than a crash', () => {
		expect(() =>
			applyOperations(
				[{ kind: 'nothing.here', input: {} }],
				{ expectedRevision: 1, actor: 'agent' },
				deps()
			)
		).toThrow(OperationValidationError);
	});

	it('honors expected_revision checking identically to a single mutation', () => {
		expect(() =>
			applyOperations(
				[{ kind: 'test.set_symbol', input: { symbol: 'AAPL' } }],
				{ expectedRevision: 99, actor: 'agent' },
				deps()
			)
		).toThrow(RevisionConflictError);
	});

	it('undoes a whole applied collection as one change, reversing every operation in it', () => {
		const envelope = applyOperations(
			[
				{ kind: 'test.add_panel', input: { title: 'Chart 1' } },
				{ kind: 'test.rename_panel', input: { panelId: 'panel_chart_1', title: 'Renamed' } }
			],
			{ expectedRevision: 1, actor: 'agent' },
			deps()
		);
		expect(repository.get('workspace_1')?.panels[0]?.title).toBe('Renamed');

		undoChange(envelope.undoToken!, {
			history,
			revisionService,
			clock,
			context: { actor: 'agent' }
		});

		// Both operations are reversed together: the panel this collection
		// added is gone entirely, not just renamed back.
		expect(repository.get('workspace_1')?.panels).toHaveLength(0);
	});
});
