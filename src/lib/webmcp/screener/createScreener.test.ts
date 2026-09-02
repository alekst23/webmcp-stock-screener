import { beforeEach, describe, expect, it } from 'vitest';
import { readScreener } from '../../screener/state';
import { createChangeHistory } from '../../workbench/application/changeHistory';
import { createIdempotencyCache } from '../../workbench/application/idempotency';
import { createOperationRegistry } from '../../workbench/application/operationRegistry';
import { createRevisionService } from '../../workbench/application/revisionService';
import { createIdSequencer } from '../../workbench/domain/ids';
import type { Clock } from '../../workbench/domain/ports';
import type { MarketDataProvenance } from '../../workbench/domain/provenance';
import { emptyWorkspace } from '../../workbench/domain/workspace';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { createCreateScreenerTool } from './createScreener';

function fixedClock(iso: string): Clock {
	return { now: () => iso };
}

const FIXED_PROVENANCE: MarketDataProvenance = {
	asOf: '2026-09-02T14:00:00.000Z',
	sourceId: 'eodhd',
	sourceLabel: 'EOD Historical Data',
	liveness: 'delayed',
	delaySeconds: 900,
	timezone: 'America/New_York',
	currency: 'USD',
	priceAdjustment: 'adjusted',
	engineVersion: '1.0.0'
};

function jsonOf(result: { content: { type: 'text'; text: string }[] }): unknown {
	const first = result.content[0];
	if (!first) {
		throw new Error('ToolResult carried no content.');
	}
	return JSON.parse(first.text);
}

interface Envelope {
	change_id: string;
	new_revision: number;
	affected_ids: string[];
	diff_summary: string;
	warnings: string[];
	undo_token: string | null;
}

describe('createCreateScreenerTool', () => {
	let deps: WorkbenchDeps;
	let workspaceId: string;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const clock = fixedClock('2026-01-01T00:00:00.000Z');
		const ids = createIdSequencer();
		const idempotency = createIdempotencyCache();
		deps = {
			repository,
			revisions: createRevisionService({ repository, clock, ids, idempotency }),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			provenance: { current: () => FIXED_PROVENANCE },
			clock,
			ids,
			idempotency
		};
		const workspace = emptyWorkspace(ids.next('workspace'), 'Test Workspace', clock.now());
		repository.put(workspace);
		repository.setActiveId(workspace.id);
		workspaceId = workspace.id;
	});

	function tool() {
		return createCreateScreenerTool(deps);
	}

	it('create_screener mints a screener at revision 1 with an empty tree and default universe', async () => {
		const result = await tool().execute({ workspace_id: workspaceId });
		expect(result.isError, `expected success, got ${JSON.stringify(result)}`).toBeUndefined();
		const envelope = jsonOf(result) as Envelope;
		const screenerId = envelope.affected_ids[0];
		expect(screenerId, 'expected exactly one affected id naming the screener').toBeDefined();

		const doc = deps.repository.get(workspaceId);
		expect(doc, 'workspace must still exist after creation').not.toBeNull();
		const screener = readScreener(doc!, screenerId!);
		expect(screener, `expected screener ${screenerId} to be stored`).not.toBeNull();
		expect(screener?.revision, 'screener must start at revision 1').toBe(1);
		expect(screener?.workspaceId, 'screener must be bound to the workspace').toBe(workspaceId);
		expect(screener?.filterTree, 'a fresh screener has an empty root group').toMatchObject({
			kind: 'group',
			children: []
		});
		expect(screener?.universe.assetClass, 'a fresh screener has a default (empty) universe').toBe(
			''
		);
	});

	it('create_screener advances the workspace revision reported in the envelope', async () => {
		const before = deps.repository.get(workspaceId)!.revision;
		const result = await tool().execute({ workspace_id: workspaceId });
		const envelope = jsonOf(result) as Envelope;
		expect(envelope.new_revision, 'workspace revision must advance by exactly one').toBe(
			before + 1
		);
	});

	it('create_screener stores and echoes an optional name without it becoming an address', async () => {
		const result = await tool().execute({ workspace_id: workspaceId, name: 'Momentum Screen' });
		const envelope = jsonOf(result) as Envelope;
		const screenerId = envelope.affected_ids[0]!;
		const screener = readScreener(deps.repository.get(workspaceId)!, screenerId);
		expect(screener?.name, 'the supplied name must be stored on the screener').toBe(
			'Momentum Screen'
		);
		expect(
			screenerId,
			'the screener id must be a screener_N handle, never derived from name'
		).toMatch(/^screener_\d+$/);
	});

	it('create_screener defaults name to null when none is supplied', async () => {
		const result = await tool().execute({ workspace_id: workspaceId });
		const envelope = jsonOf(result) as Envelope;
		const screener = readScreener(deps.repository.get(workspaceId)!, envelope.affected_ids[0]!);
		expect(screener?.name, 'an omitted name must normalize to null, not empty string').toBeNull();
	});

	it('create_screener rejects a stale expected_revision without creating anything', async () => {
		const result = await tool().execute({ workspace_id: workspaceId, expected_revision: 99 });
		expect(result.isError, 'a mismatched expected_revision must be reported as an error').toBe(
			true
		);
		const body = jsonOf(result) as { error: string; current_revision: number };
		expect(body.error).toBe('revision_conflict');
		expect(body.current_revision, 'the actual current revision must be reported').toBe(
			deps.repository.get(workspaceId)!.revision
		);
		const doc = deps.repository.get(workspaceId)!;
		expect(
			Object.keys((doc.extensions.screener as Record<string, unknown> | undefined) ?? {}),
			'no screener may have been created on a rejected call'
		).toHaveLength(0);
	});

	it('create_screener replays a repeated idempotency_key instead of minting a second screener', async () => {
		const args = { workspace_id: workspaceId, name: 'Momentum Screen', idempotency_key: 'k-1' };
		const first = jsonOf(await tool().execute(args)) as Envelope;
		const second = jsonOf(await tool().execute(args)) as Envelope;
		expect(second.change_id, 'a replayed call must return the original change_id').toBe(
			first.change_id
		);
		expect(second.affected_ids, 'a replayed call must return the original screener id').toEqual(
			first.affected_ids
		);
		const doc = deps.repository.get(workspaceId)!;
		const screenerMap = doc.extensions.screener as Record<string, unknown>;
		expect(
			Object.keys(screenerMap),
			'exactly one screener must exist despite the repeated call'
		).toHaveLength(1);
	});

	it('create_screener returns a present-tense diff_summary and an undo_token', async () => {
		const result = await tool().execute({ workspace_id: workspaceId, name: 'Momentum Screen' });
		const envelope = jsonOf(result) as Envelope;
		expect(envelope.diff_summary, 'diff_summary must describe the change').toContain('Created');
		expect(envelope.undo_token, 'a create is undoable and must carry a token').not.toBeNull();
	});

	it('create_screener is reversible via its undo_token', async () => {
		const created = jsonOf(
			await tool().execute({ workspace_id: workspaceId, name: 'Momentum Screen' })
		) as Envelope;
		const screenerId = created.affected_ids[0]!;
		expect(
			readScreener(deps.repository.get(workspaceId)!, screenerId),
			'screener must exist before undo'
		).not.toBeNull();

		const { undoChange } = await import('../../workbench/application/changeHistory');
		undoChange(created.undo_token!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: { actor: 'agent' }
		});

		expect(
			readScreener(deps.repository.get(workspaceId)!, screenerId),
			'undo must remove the created screener'
		).toBeNull();
	});

	it('create_screener fails cleanly when there is no active workspace', async () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const clock = fixedClock('2026-01-01T00:00:00.000Z');
		const ids = createIdSequencer();
		const idempotency = createIdempotencyCache();
		const emptyDeps: WorkbenchDeps = {
			repository,
			revisions: createRevisionService({ repository, clock, ids, idempotency }),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			provenance: { current: () => FIXED_PROVENANCE },
			clock,
			ids,
			idempotency
		};
		const result = await createCreateScreenerTool(emptyDeps).execute({});
		expect(result.isError, 'no active workspace must be reported as an error').toBe(true);
	});
});
