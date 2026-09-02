import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { buildUpsertWatchlistTool } from './upsertWatchlist';
import type { UpsertWatchlistDeps } from './upsertWatchlist';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

interface SuccessPayload {
	change_id: string;
	new_revision: number;
	affected_ids: string[];
	undo_token: string | null;
	watchlist: { watchlist_id: string; name: string; kind: string; members?: unknown[] } | null;
}

interface FailurePayload {
	error: string;
	message: string;
	issues?: string[];
}

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	return JSON.parse(result.content[0]!.text);
}

describe('upsert_watchlist', () => {
	let deps: UpsertWatchlistDeps;
	let tool: ToolSpec;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(emptyWorkspace(WORKSPACE_ID, 'Research', NOW));
		repository.setActiveId(WORKSPACE_ID);
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
			clock,
			ids
		};
		tool = buildUpsertWatchlistTool(deps);
	});

	it('test_creates_a_static_watchlist_and_returns_it_on_the_wire', async () => {
		const body = jsonOf(
			await tool.execute({ name: 'Momentum', kind: 'static', instrument_ids: ['inst_1'] })
		) as SuccessPayload;
		expect(body.watchlist?.kind).toBe('static');
		expect(body.watchlist?.name).toBe('Momentum');
		expect(body.watchlist?.members).toEqual([
			{
				instrument_id: 'inst_1',
				added_at: NOW,
				source: { kind: 'manual' }
			}
		]);
		expect(body.undo_token).not.toBeNull();
	});

	it('test_missing_name_on_create_is_rejected_with_a_named_issue', async () => {
		const body = jsonOf(await tool.execute({ kind: 'static' })) as FailurePayload;
		expect(body.error).toBe('operation_validation_error');
		expect(body.issues?.join(' ')).toMatch(/name/);
	});

	it('test_updates_an_existing_watchlist_keeping_its_id', async () => {
		const created = jsonOf(
			await tool.execute({ name: 'Momentum', kind: 'static', instrument_ids: ['inst_1'] })
		) as SuccessPayload;
		const watchlistId = created.watchlist!.watchlist_id;
		const updated = jsonOf(
			await tool.execute({ watchlist_id: watchlistId, name: 'Renamed', kind: 'static' })
		) as SuccessPayload;
		expect(updated.watchlist?.watchlist_id).toBe(watchlistId);
		expect(updated.watchlist?.name).toBe('Renamed');
	});

	it('test_returns_an_undo_token_that_removes_a_newly_created_watchlist', async () => {
		const body = jsonOf(
			await tool.execute({ name: 'Momentum', kind: 'static', instrument_ids: ['inst_1'] })
		) as SuccessPayload;
		undoChange(body.undo_token!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: { actor: 'agent' }
		});
		const doc = deps.repository.get(WORKSPACE_ID);
		expect(
			(doc?.extensions.watchlists as Record<string, unknown> | undefined)?.[
				body.watchlist!.watchlist_id
			]
		).toBeUndefined();
	});

	it('test_replays_an_idempotency_key_instead_of_creating_a_second_watchlist', async () => {
		const input = {
			name: 'Momentum',
			kind: 'static',
			instrument_ids: ['inst_1'],
			idempotency_key: 'key-1'
		};
		const first = jsonOf(await tool.execute(input)) as SuccessPayload;
		const replay = jsonOf(await tool.execute(input)) as SuccessPayload;
		expect(replay.change_id).toBe(first.change_id);
		const doc = deps.repository.get(WORKSPACE_ID);
		expect(Object.keys((doc?.extensions.watchlists as Record<string, unknown>) ?? {})).toHaveLength(
			1
		);
	});

	it('test_no_active_workspace_is_reported_as_not_found', async () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const ids = createIdSequencer();
		const noWorkspaceDeps: UpsertWatchlistDeps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock,
				ids,
				idempotency: createIdempotencyCache()
			}),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			clock,
			ids
		};
		const noWorkspaceTool = buildUpsertWatchlistTool(noWorkspaceDeps);
		const body = jsonOf(
			await noWorkspaceTool.execute({ name: 'X', kind: 'static' })
		) as FailurePayload;
		expect(body.error).toBe('not_found');
	});
});
