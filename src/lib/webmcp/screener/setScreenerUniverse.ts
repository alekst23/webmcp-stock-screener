// `set_screener_universe` (T-1009-3): replaces a screener's universe
// wholesale, advancing the screener's own revision (never the workspace
// revision -- that is RevisionService.commit's job). Routes through
// EPIC-1006's recordCommit; catalog membership (AC6) is checked before any
// commit is attempted so a rejection never mutates or consumes a revision.

import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import type { AssetType, InstrumentDirectory, InstrumentQuery } from '../../discovery/ports';
import { normalizeUniverse, type UniverseSpec } from '../../screener/definition';
import { readScreener, writeScreener } from '../../screener/state';
import {
	checkUniverseCatalogMembership,
	describeUniverseSizeWarning,
	type UniverseSizeResolution
} from '../../screener/universeValidation';
import { recordCommit } from '../../workbench/application/changeHistory';
import { OperationValidationError } from '../../workbench/domain/errors';
import { toWireEnvelope } from '../../workbench/domain/mutation';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import type { ToolResult, ToolSpec } from '../types';
import { fail, ok } from '../toolResult';
import { resolveWorkspaceId, toErrorResult } from './support';

export interface SetScreenerUniverseDeps extends WorkbenchDeps {
	// Defaults to builtinCatalogRegistry -- overridable so tests can drive a
	// small fixed inventory instead of the shipped one.
	catalog?: CatalogRegistry;
	// Optional: the shipped default has no reference-data source at all
	// (src/lib/discovery/unavailableDirectory.ts), and omitting this
	// dependency entirely is itself a valid, honest "cannot resolve" input.
	instrumentDirectory?: InstrumentDirectory;
}

interface LiquidityWireInput {
	min_price?: number;
	min_average_volume?: number;
	min_market_cap?: number;
}

interface ExclusionsWireInput {
	instrument_ids?: string[];
	sector_ids?: string[];
	industry_ids?: string[];
}

interface SetUniverseWireInput {
	workspace_id?: string;
	screener_id?: string;
	asset_class?: string;
	exchanges?: string[];
	countries?: string[];
	sectors?: string[];
	industries?: string[];
	indexes?: string[];
	watchlists?: string[];
	liquidity?: LiquidityWireInput;
	exclusions?: ExclusionsWireInput;
	expected_revision?: number;
	idempotency_key?: string;
}

// Reuses T-1009-1's own lenient normalizer rather than re-declaring the
// UniverseSpec shape here -- a foreign or partial field on the wire
// normalizes to a safe default exactly as it would anywhere else this type
// is read.
function buildUniverseSpec(input: SetUniverseWireInput): UniverseSpec {
	return normalizeUniverse({
		assetClass: input.asset_class,
		exchanges: input.exchanges,
		countries: input.countries,
		sectors: input.sectors,
		industries: input.industries,
		indexes: input.indexes,
		watchlists: input.watchlists,
		liquidity: {
			minPrice: input.liquidity?.min_price,
			minAverageVolume: input.liquidity?.min_average_volume,
			minMarketCap: input.liquidity?.min_market_cap
		},
		exclusions: {
			instrumentIds: input.exclusions?.instrument_ids,
			sectorIds: input.exclusions?.sector_ids,
			industryIds: input.exclusions?.industry_ids
		}
	});
}

const ASSET_TYPES: ReadonlySet<string> = new Set<AssetType>([
	'equity',
	'etf',
	'adr',
	'fund',
	'index',
	'future',
	'fx',
	'crypto'
]);

function isAssetType(value: string): value is AssetType {
	return ASSET_TYPES.has(value);
}

// Best-effort AC7 resolution. `text: ''` is deliberate: InstrumentQuery.text
// is typed as `string`, not a non-empty one, and this call only asks "does
// anything match these structural filters" -- it is not a text search.
// sectors/industries/indexes/watchlists/liquidity/exclusions have no
// equivalent field on InstrumentQuery yet, so they cannot further narrow the
// count; that can only ever overcount a genuinely empty universe, never hide
// one, and is called out in the warning text this feeds.
//
// "Resolvable" is judged generically -- data present, or an empty result
// with no accompanying warnings -- rather than by matching a specific infra
// source ID, so this stays correct against any future real adapter, not
// just today's unavailableDirectory.ts.
async function resolveUniverseSize(
	directory: InstrumentDirectory | undefined,
	universe: UniverseSpec
): Promise<UniverseSizeResolution> {
	if (!directory) {
		return { resolvable: false, count: 0 };
	}
	const query: InstrumentQuery = {
		text: '',
		assetTypes: isAssetType(universe.assetClass) ? [universe.assetClass] : undefined,
		exchangeIds: universe.exchanges.length > 0 ? universe.exchanges : undefined,
		countryCodes: universe.countries.length > 0 ? universe.countries : undefined,
		limit: 1
	};
	const envelope = await directory.searchInstruments(query);
	const resolvable = !(envelope.data.length === 0 && envelope.warnings.length > 0);
	return { resolvable, count: envelope.data.length };
}

const DESCRIPTION =
	'Replaces a screener universe wholesale: asset class, exchanges, countries, sectors, ' +
	'industries, indexes, watchlists, liquidity limits (minimum price, average volume, ' +
	'market cap -- applied before any filter condition), and exclusions (instruments, ' +
	'sectors, industries -- these always win over an inclusion criterion that would ' +
	'otherwise have added the same member). Advances the screener revision. An unrecognized ' +
	'index ID is rejected, naming every one of them, and the previous universe is left ' +
	'unchanged; exchange/country/sector/industry membership cannot be verified yet (no ' +
	'reference-data source), so a non-empty selection there is applied with an advisory ' +
	'warning instead. Returns the mutation envelope; undoable via undo_token.';

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		screener_id: { type: 'string' },
		asset_class: { type: 'string' },
		exchanges: { type: 'array', items: { type: 'string' } },
		countries: { type: 'array', items: { type: 'string' } },
		sectors: { type: 'array', items: { type: 'string' } },
		industries: { type: 'array', items: { type: 'string' } },
		indexes: { type: 'array', items: { type: 'string' } },
		watchlists: { type: 'array', items: { type: 'string' } },
		liquidity: {
			type: 'object',
			properties: {
				min_price: { type: 'number' },
				min_average_volume: { type: 'number' },
				min_market_cap: { type: 'number' }
			}
		},
		exclusions: {
			type: 'object',
			properties: {
				instrument_ids: { type: 'array', items: { type: 'string' } },
				sector_ids: { type: 'array', items: { type: 'string' } },
				industry_ids: { type: 'array', items: { type: 'string' } }
			}
		},
		expected_revision: { type: 'number' },
		idempotency_key: { type: 'string' }
	},
	required: ['screener_id']
};

function unknownIndexMessage(unknownIds: string[], suggestions: Record<string, string[]>): string {
	const parts = unknownIds.map((id) => {
		const near = suggestions[id] ?? [];
		return near.length > 0 ? `"${id}" (did you mean: ${near.join(', ')}?)` : `"${id}"`;
	});
	return (
		`Unrecognized index ID(s): ${parts.join(', ')}. Use search_catalog (kind "universe") ` +
		'to find valid index IDs. The universe was not changed.'
	);
}

interface UniverseTarget {
	workspaceId: string;
	screenerId: string;
}

type TargetResult = { ok: true; target: UniverseTarget } | { ok: false; result: ToolResult };

// Every early-exit case here means "nothing happened": no repository write,
// no revision consumed, matching AC6's "previous universe left unchanged".
function resolveTarget(deps: WorkbenchDeps, input: SetUniverseWireInput): TargetResult {
	const screenerId = input.screener_id;
	if (!screenerId) {
		const result = fail('set_screener_universe requires a "screener_id" string.', {
			receivedInput: input
		});
		return { ok: false, result };
	}
	const workspaceId = resolveWorkspaceId(deps, input);
	if (!workspaceId) {
		return { ok: false, result: fail('No active workspace.', { error: 'not_found' }) };
	}
	const doc = deps.repository.get(workspaceId);
	if (!doc) {
		return {
			ok: false,
			result: fail(`Workspace not found: ${workspaceId}`, { error: 'not_found' })
		};
	}
	if (!readScreener(doc, screenerId)) {
		return { ok: false, result: fail(`Screener not found: ${screenerId}`, { error: 'not_found' }) };
	}
	return { ok: true, target: { workspaceId, screenerId } };
}

// `freshDoc` is the document `mutate` receives, freshly loaded by
// RevisionService.commit -- it already holds the screener at its prior
// universe and prior screener-local revision, so it doubles as the exact
// undo target with no reconstruction needed.
function commitUniverseReplacement(
	deps: WorkbenchDeps,
	target: UniverseTarget,
	universe: UniverseSpec,
	warnings: string[],
	input: SetUniverseWireInput
): ToolResult {
	try {
		const envelope = recordCommit(
			{ history: deps.history, revisionService: deps.revisions, clock: deps.clock },
			{
				workspaceId: target.workspaceId,
				context: {
					expectedRevision: input.expected_revision,
					idempotencyKey: input.idempotency_key,
					actor: 'agent'
				},
				operationKind: 'screener.set_screener_universe',
				requestInput: { workspaceId: target.workspaceId, screenerId: target.screenerId, universe },
				mutate: (freshDoc) => {
					const current = readScreener(freshDoc, target.screenerId);
					if (!current) {
						throw new OperationValidationError([`Screener not found: ${target.screenerId}`]);
					}
					const updated = { ...current, universe, revision: current.revision + 1 };
					return {
						document: writeScreener(freshDoc, updated),
						affectedIds: [target.screenerId],
						diffSummary: `Replaced the universe for screener ${target.screenerId}.`,
						warnings,
						inverse: {
							document: freshDoc,
							affectedIds: [target.screenerId],
							diffSummary: `Reverted the universe for screener ${target.screenerId}.`
						}
					};
				}
			}
		);
		return ok(toWireEnvelope(envelope));
	} catch (err) {
		return toErrorResult(err);
	}
}

function execute(deps: SetScreenerUniverseDeps) {
	const catalog = deps.catalog ?? builtinCatalogRegistry;
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as SetUniverseWireInput;
		const targetResult = resolveTarget(deps, input);
		if (!targetResult.ok) {
			return targetResult.result;
		}

		const universe = buildUniverseSpec(input);
		const { unknownIndexIds, suggestionsByIndex, unverifiableWarning } =
			checkUniverseCatalogMembership(universe, catalog);
		if (unknownIndexIds.length > 0) {
			return fail(unknownIndexMessage(unknownIndexIds, suggestionsByIndex), {
				unknownIndexIds,
				suggestions: suggestionsByIndex
			});
		}

		const sizeResolution = await resolveUniverseSize(deps.instrumentDirectory, universe);
		const warnings = [unverifiableWarning, describeUniverseSizeWarning(sizeResolution)].filter(
			(w): w is string => w !== null
		);

		return commitUniverseReplacement(deps, targetResult.target, universe, warnings, input);
	};
}

export function createSetScreenerUniverseTool(deps: SetScreenerUniverseDeps): ToolSpec {
	return {
		name: 'set_screener_universe',
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: execute(deps)
	};
}
