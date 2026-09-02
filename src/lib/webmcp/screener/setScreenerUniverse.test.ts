import { beforeEach, describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../catalog/registry';
import type { InstrumentDirectory, InstrumentMatch } from '../../discovery/ports';
import { fakeInstrument } from '../../discovery/testSupport';
import { createScreener } from '../../screener/definition';
import { readScreener, writeScreener } from '../../screener/state';
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
import { createSetScreenerUniverseTool, type SetScreenerUniverseDeps } from './setScreenerUniverse';

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

// A private double matching this module's own usage of InstrumentDirectory
// (an empty-text structural query) -- unlike discovery/testSupport.ts's
// createFakeInstrumentDirectory, which treats empty text as "no match" and
// so cannot express "here is what matches these filters".
function directoryReturning(data: InstrumentMatch[], warnings: string[] = []): InstrumentDirectory {
	return {
		async searchInstruments() {
			return { data, provenance: FIXED_PROVENANCE, warnings };
		},
		async getInstrument() {
			return { data: null, provenance: FIXED_PROVENANCE, warnings: [] };
		}
	};
}

function oneMatch(): InstrumentMatch {
	return { instrument: fakeInstrument(), matchedOn: 'symbol', score: 1 };
}

describe('createSetScreenerUniverseTool', () => {
	let deps: WorkbenchDeps;
	let workspaceId: string;
	let screenerId: string;

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
		let workspace = emptyWorkspace(ids.next('workspace'), 'Test Workspace', clock.now());
		const screener = createScreener(ids, workspace.id, null);
		workspace = writeScreener(workspace, screener);
		repository.put(workspace);
		repository.setActiveId(workspace.id);
		workspaceId = workspace.id;
		screenerId = screener.screenerId;
	});

	function tool(extra: Partial<SetScreenerUniverseDeps> = {}) {
		return createSetScreenerUniverseTool({ ...deps, ...extra });
	}

	it('set_screener_universe replaces the universe wholesale and advances the screener revision', async () => {
		const first = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			exchanges: ['XNAS'],
			sectors: ['tech']
		});
		expect(first.isError, `expected success, got ${JSON.stringify(first)}`).toBeUndefined();

		const second = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			countries: ['US']
		});
		expect(second.isError).toBeUndefined();

		const screener = readScreener(deps.repository.get(workspaceId)!, screenerId)!;
		expect(screener.universe.exchanges, 'the first universe must be fully replaced').toEqual([]);
		expect(screener.universe.sectors, 'the first universe must be fully replaced').toEqual([]);
		expect(screener.universe.countries).toEqual(['US']);
		expect(screener.revision, 'the screener-local revision must advance on each set').toBe(3);
	});

	it('set_screener_universe advances the workspace revision, not just the screener revision', async () => {
		const before = deps.repository.get(workspaceId)!.revision;
		const result = await tool().execute({ workspace_id: workspaceId, screener_id: screenerId });
		const envelope = jsonOf(result) as Envelope;
		expect(envelope.new_revision, 'the workspace revision must advance by exactly one').toBe(
			before + 1
		);
	});

	it('set_screener_universe stores liquidity limits unchanged', async () => {
		await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			liquidity: { min_price: 5, min_average_volume: 100000, min_market_cap: 2000000000 }
		});
		const screener = readScreener(deps.repository.get(workspaceId)!, screenerId)!;
		expect(screener.universe.liquidity).toEqual({
			minPrice: 5,
			minAverageVolume: 100000,
			minMarketCap: 2000000000
		});
	});

	it('set_screener_universe stores an exclusion alongside an overlapping inclusion', async () => {
		await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			sectors: ['tech'],
			exclusions: { sector_ids: ['tech'] }
		});
		const screener = readScreener(deps.repository.get(workspaceId)!, screenerId)!;
		expect(
			screener.universe.sectors,
			'the inclusion is stored even though the same sector is also excluded'
		).toEqual(['tech']);
		expect(
			screener.universe.exclusions.sectorIds,
			'the exclusion is stored and is not silently dropped or deduplicated'
		).toEqual(['tech']);
	});

	it('set_screener_universe rejects an unknown index id, naming it, leaving the universe unchanged', async () => {
		const before = readScreener(deps.repository.get(workspaceId)!, screenerId)!;
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			indexes: ['universe.nope']
		});
		expect(result.isError, 'an unrecognized index id must be rejected').toBe(true);
		const body = jsonOf(result) as { error: string; unknownIndexIds: string[] };
		expect(body.unknownIndexIds).toEqual(['universe.nope']);

		const after = readScreener(deps.repository.get(workspaceId)!, screenerId)!;
		expect(after, 'the universe must be left exactly as it was').toEqual(before);
	});

	it('set_screener_universe accepts a real catalog index id', async () => {
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			indexes: ['universe.sp500']
		});
		expect(result.isError, 'a known catalog index id must be accepted').toBeUndefined();
		const screener = readScreener(deps.repository.get(workspaceId)!, screenerId)!;
		expect(screener.universe.indexes).toEqual(['universe.sp500']);
	});

	it('set_screener_universe warns, but still applies, when exchange/sector membership cannot be verified', async () => {
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			exchanges: ['XNAS'],
			sectors: ['tech']
		});
		expect(result.isError).toBeUndefined();
		const envelope = jsonOf(result) as Envelope;
		expect(
			envelope.warnings.some((w) => w.includes('exchanges') && w.includes('sectors')),
			`expected an unverifiable-membership warning, got ${JSON.stringify(envelope.warnings)}`
		).toBe(true);
	});

	it('set_screener_universe warns the size is unknown with no instrument directory configured', async () => {
		const result = await tool().execute({ workspace_id: workspaceId, screener_id: screenerId });
		const envelope = jsonOf(result) as Envelope;
		expect(
			envelope.warnings.some((w) => w.toLowerCase().includes('unknown')),
			`expected an unknown-size warning, got ${JSON.stringify(envelope.warnings)}`
		).toBe(true);
	});

	it('set_screener_universe warns the size is unknown when the directory cannot resolve it', async () => {
		const directory = directoryReturning([], ['No reference-data source is configured.']);
		const result = await tool({ instrumentDirectory: directory }).execute({
			workspace_id: workspaceId,
			screener_id: screenerId
		});
		const envelope = jsonOf(result) as Envelope;
		expect(
			envelope.warnings.some((w) => w.toLowerCase().includes('unknown')),
			`expected an unknown-size warning, got ${JSON.stringify(envelope.warnings)}`
		).toBe(true);
		expect(
			envelope.warnings.some((w) => w.toLowerCase().includes('resolves to zero')),
			'a directory that cannot resolve must never be reported as zero'
		).toBe(false);
	});

	it('set_screener_universe warns the universe is empty when the directory resolves zero matches', async () => {
		const directory = directoryReturning([]);
		const result = await tool({ instrumentDirectory: directory }).execute({
			workspace_id: workspaceId,
			screener_id: screenerId
		});
		const envelope = jsonOf(result) as Envelope;
		expect(
			envelope.warnings.some((w) => w.toLowerCase().includes('zero')),
			`expected an empty-universe warning, got ${JSON.stringify(envelope.warnings)}`
		).toBe(true);
	});

	it('set_screener_universe carries no size warning when the directory resolves matches', async () => {
		const directory = directoryReturning([oneMatch()]);
		const result = await tool({ instrumentDirectory: directory }).execute({
			workspace_id: workspaceId,
			screener_id: screenerId
		});
		const envelope = jsonOf(result) as Envelope;
		expect(
			envelope.warnings.some(
				(w) => w.toLowerCase().includes('unknown') || w.toLowerCase().includes('zero')
			),
			`expected no size warning, got ${JSON.stringify(envelope.warnings)}`
		).toBe(false);
	});

	it('set_screener_universe rejects a stale expected_revision without mutating', async () => {
		const before = readScreener(deps.repository.get(workspaceId)!, screenerId)!;
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			expected_revision: 99
		});
		expect(result.isError).toBe(true);
		const body = jsonOf(result) as { error: string; current_revision: number };
		expect(body.error).toBe('revision_conflict');
		expect(body.current_revision).toBe(deps.repository.get(workspaceId)!.revision);
		expect(readScreener(deps.repository.get(workspaceId)!, screenerId)!).toEqual(before);
	});

	it('set_screener_universe replays a repeated idempotency_key instead of acting again', async () => {
		const args = {
			workspace_id: workspaceId,
			screener_id: screenerId,
			sectors: ['tech'],
			idempotency_key: 'u-1'
		};
		const first = jsonOf(await tool().execute(args)) as Envelope;
		const revisionAfterFirst = readScreener(
			deps.repository.get(workspaceId)!,
			screenerId
		)!.revision;
		const second = jsonOf(await tool().execute(args)) as Envelope;
		expect(second.change_id, 'a replay must return the original change_id').toBe(first.change_id);
		expect(
			readScreener(deps.repository.get(workspaceId)!, screenerId)!.revision,
			'a replay must not advance the screener revision a second time'
		).toBe(revisionAfterFirst);
	});

	it('set_screener_universe returns affected_ids, a present-tense diff_summary, and an undo_token', async () => {
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			sectors: ['tech']
		});
		const envelope = jsonOf(result) as Envelope;
		expect(envelope.affected_ids).toEqual([screenerId]);
		expect(envelope.diff_summary).toContain('Replaced');
		expect(envelope.undo_token).not.toBeNull();
	});

	it('set_screener_universe is reversible via its undo_token', async () => {
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			sectors: ['tech']
		});
		const envelope = jsonOf(result) as Envelope;

		const { undoChange } = await import('../../workbench/application/changeHistory');
		undoChange(envelope.undo_token!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock: deps.clock,
			context: { actor: 'agent' }
		});

		const screener = readScreener(deps.repository.get(workspaceId)!, screenerId)!;
		expect(screener.universe.sectors, 'undo must restore the prior universe').toEqual([]);
		expect(screener.revision, 'undo must restore the prior screener-local revision').toBe(1);
	});

	it('set_screener_universe reports not_found for an unknown screener_id', async () => {
		const result = await tool().execute({
			workspace_id: workspaceId,
			screener_id: 'screener_404'
		});
		expect(result.isError).toBe(true);
		const body = jsonOf(result) as { error: string };
		expect(body.error).toBe('not_found');
	});

	it('set_screener_universe uses the builtin catalog registry by default', async () => {
		const result = await createSetScreenerUniverseTool(deps).execute({
			workspace_id: workspaceId,
			screener_id: screenerId,
			indexes: [Object.values(builtinCatalogRegistry.listCatalogItems('universe'))[0]!.id]
		});
		expect(result.isError, 'a real builtin universe id must validate').toBeUndefined();
	});
});
