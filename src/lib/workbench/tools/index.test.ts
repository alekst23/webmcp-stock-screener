import { beforeEach, describe, expect, it } from 'vitest';
import { createIdSequencer } from '../domain/ids';
import type { Clock } from '../domain/ports';
import type { MarketDataProvenance } from '../domain/provenance';
import { createLocalWorkspaceRepository } from '../infra/workspaceRepository';
import { memoryStorage } from '../testSupport';
import { createChangeHistory } from '../application/changeHistory';
import { createIdempotencyCache } from '../application/idempotency';
import { createOperationRegistry } from '../application/operationRegistry';
import { createRevisionService } from '../application/revisionService';
import { buildWorkbenchTools, type WorkbenchDeps } from './index';

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

const FIXED_PROVENANCE: MarketDataProvenance = {
	asOf: '2026-09-02T14:00:00.000Z',
	source: 'eodhd',
	liveness: 'delayed',
	delaySeconds: 900,
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted',
	fundamentalsPeriod: null,
	calcEngineVersion: '1.0.0'
};

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

describe('buildWorkbenchTools', () => {
	let deps: WorkbenchDeps;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const clock = fixedClock('2026-01-01T00:00:00.000Z');
		const ids = createIdSequencer();
		deps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock,
				ids,
				idempotency: createIdempotencyCache()
			}),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			provenance: { current: () => FIXED_PROVENANCE },
			clock,
			ids
		};
	});

	it('registers exactly the seven named tools', () => {
		const tools = buildWorkbenchTools(deps);
		expect(tools.map((t) => t.name).sort()).toEqual([
			'create_workspace',
			'get_app_context',
			'get_canvas_state',
			'get_change_history',
			'restore_workspace_revision',
			'save_workspace',
			'undo_change'
		]);
	});

	it('every tool is available (not gated on the old WorkspaceState)', () => {
		const tools = buildWorkbenchTools(deps);
		for (const tool of tools) {
			expect(tool.available({} as never)).toBe(true);
		}
	});

	function tool(name: string) {
		const found = buildWorkbenchTools(deps).find((t) => t.name === name);
		if (!found) throw new Error(`no such tool: ${name}`);
		return found;
	}

	it('get_app_context reports no active workspace before one exists', async () => {
		const result = await tool('get_app_context').execute({});
		const body = jsonOf(result) as { activeWorkspaceId: string | null; permissions: unknown };
		expect(body.activeWorkspaceId).toBeNull();
		expect(body.permissions).toMatchObject({ trading: false });
	});

	it('create_workspace creates a workspace at revision 1 and makes it active', async () => {
		const result = await tool('create_workspace').execute({ name: 'My Workspace' });
		const body = jsonOf(result) as { new_revision: number; affected_ids: string[] };
		expect(body.new_revision).toBe(1);
		expect(deps.repository.getActiveId()).toBe(body.affected_ids[0]);
	});

	it('get_app_context reflects a freshly created active workspace, not a stale snapshot', async () => {
		await tool('create_workspace').execute({ name: 'My Workspace' });
		const result = await tool('get_app_context').execute({});
		const body = jsonOf(result) as { activeWorkspaceId: string | null; revision: number };
		expect(body.activeWorkspaceId).not.toBeNull();
		expect(body.revision).toBe(1);
	});

	it('get_app_context reports the market-data delay and presentation timezone', async () => {
		const result = await tool('get_app_context').execute({});
		const body = jsonOf(result) as {
			marketDataLiveness: string;
			marketDataDelaySeconds: number | null;
			presentationTimezone: string;
		};
		expect(body.marketDataLiveness).toBe('delayed');
		expect(body.marketDataDelaySeconds).toBe(900);
		expect(body.presentationTimezone).toBe('America/New_York');
	});

	it('get_canvas_state returns a not_found error for a missing workspace', async () => {
		const result = await tool('get_canvas_state').execute({ workspace_id: 'workspace_404' });
		expect(result.isError).toBe(true);
	});

	it('get_canvas_state reports hasUnsavedChanges before any name is attached', async () => {
		const created = jsonOf(await tool('create_workspace').execute({ name: 'My Workspace' })) as {
			affected_ids: string[];
		};
		const id = created.affected_ids[0]!;
		const state = jsonOf(await tool('get_canvas_state').execute({ workspace_id: id })) as {
			hasUnsavedChanges: boolean;
		};
		expect(state.hasUnsavedChanges).toBe(true);
	});

	it('save_workspace attaches a name to the current revision without bumping it', async () => {
		const created = jsonOf(await tool('create_workspace').execute({ name: 'My Workspace' })) as {
			affected_ids: string[];
			new_revision: number;
		};
		const id = created.affected_ids[0]!;

		const saved = jsonOf(
			await tool('save_workspace').execute({ workspace_id: id, name: 'Baseline' })
		) as { new_revision: number };
		expect(saved.new_revision).toBe(created.new_revision);

		const state = jsonOf(await tool('get_canvas_state').execute({ workspace_id: id })) as {
			hasUnsavedChanges: boolean;
		};
		expect(state.hasUnsavedChanges).toBe(false);
	});

	it('save_workspace rejects a mismatched expected_revision as a structured error', async () => {
		const created = jsonOf(await tool('create_workspace').execute({ name: 'My Workspace' })) as {
			affected_ids: string[];
		};
		const id = created.affected_ids[0]!;
		const result = await tool('save_workspace').execute({
			workspace_id: id,
			name: 'Baseline',
			expected_revision: 99
		});
		expect(result.isError).toBe(true);
		const body = jsonOf(result) as { error: string };
		expect(body.error).toBe('revision_conflict');
	});

	it('undo_change reverses the change that returned the token', async () => {
		const created = jsonOf(
			await tool('create_workspace').execute({ name: 'My Workspace', idempotency_key: 'k1' })
		) as { affected_ids: string[] };
		const id = created.affected_ids[0]!;
		// create_workspace's own change has no inverse; exercise undo via a
		// second, undoable change through the revision service directly.
		const { recordCommit } = await import('../application/changeHistory');
		const before = deps.repository.get(id)!;
		const envelope = recordCommit(
			{ history: deps.history, revisionService: deps.revisions, clock: deps.clock },
			{
				workspaceId: id,
				context: { expectedRevision: before.revision, actor: 'agent' },
				mutate: (doc) => ({
					document: { ...doc, activeSymbol: 'AAPL' },
					affectedIds: [id],
					diffSummary: 'Set symbol.',
					inverse: { document: { ...doc }, affectedIds: [id], diffSummary: 'Reverted symbol.' }
				})
			}
		);

		const result = await tool('undo_change').execute({ undo_token: envelope.undoToken });
		expect(result.isError).toBeUndefined();
		expect(deps.repository.get(id)?.activeSymbol).toBeNull();
	});

	it('undo_change returns a structured error for an unknown token', async () => {
		const result = await tool('undo_change').execute({ undo_token: 'undo_bogus' });
		expect(result.isError).toBe(true);
		const body = jsonOf(result) as { error: string; reason: string };
		expect(body.error).toBe('undo_token_error');
		expect(body.reason).toBe('unknown');
	});

	it('get_change_history lists changes for the given workspace, newest first', async () => {
		const created = jsonOf(await tool('create_workspace').execute({ name: 'My Workspace' })) as {
			affected_ids: string[];
		};
		const id = created.affected_ids[0]!;
		const history = jsonOf(await tool('get_change_history').execute({ workspace_id: id })) as {
			diffSummary: string;
		}[];
		expect(history).toHaveLength(1);
		expect(history[0]?.diffSummary).toContain('Created workspace');
	});

	it('restore_workspace_revision restores an earlier revision as a new, undoable change', async () => {
		const created = jsonOf(await tool('create_workspace').execute({ name: 'My Workspace' })) as {
			affected_ids: string[];
		};
		const id = created.affected_ids[0]!;
		const { recordCommit } = await import('../application/changeHistory');
		recordCommit(
			{ history: deps.history, revisionService: deps.revisions, clock: deps.clock },
			{
				workspaceId: id,
				context: { expectedRevision: 1, actor: 'agent' },
				mutate: (doc) => ({
					document: { ...doc, activeSymbol: 'AAPL' },
					affectedIds: [id],
					diffSummary: 'Set symbol.'
				})
			}
		);
		expect(deps.repository.get(id)?.activeSymbol).toBe('AAPL');

		const result = await tool('restore_workspace_revision').execute({
			workspace_id: id,
			revision: 1
		});
		expect(result.isError).toBeUndefined();
		expect(deps.repository.get(id)?.activeSymbol).toBeNull();
	});

	it('restore_workspace_revision reports a structured error for a missing snapshot', async () => {
		const created = jsonOf(await tool('create_workspace').execute({ name: 'My Workspace' })) as {
			affected_ids: string[];
		};
		const id = created.affected_ids[0]!;
		const result = await tool('restore_workspace_revision').execute({
			workspace_id: id,
			revision: 999
		});
		expect(result.isError).toBe(true);
		const body = jsonOf(result) as { error: string };
		expect(body.error).toBe('operation_validation_error');
	});
});
