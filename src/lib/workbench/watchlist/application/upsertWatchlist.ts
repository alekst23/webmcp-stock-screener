// Creating or updating a watchlist, as an operation the workbench registry
// owns (T-1014-7). "Upsert" here is a replace for the fields that define a
// watchlist's kind, not a patch: when the caller supplies membership or a
// screener reference, that value becomes the whole new definition. `name` is
// the one exception -- left untouched when omitted, so a membership-only or
// a screener-only update never silently blanks a watchlist's name.
//
// Application layer: use case over the watchlist domain plus EPIC-1006's
// operation registry. No I/O of its own -- time arrives through a Clock.
import type { IdSequencer, ResourceId } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { Revision, WorkspaceDocument } from '../../domain/workspace';
import type { MutationDraft } from '../../application/revisionService';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import { readScreener } from '../../../screener/state';
import { screenerReachesWatchlist } from '../domain/cycles';
import { readWatchlist, writeWatchlist } from '../domain/watchlist';
import type { Watchlist, WatchlistKind, WatchlistMember } from '../domain/watchlist';

export const WATCHLIST_UPSERT_KIND = 'watchlist.upsert';

export interface UpsertWatchlistInput {
	watchlistId?: ResourceId;
	name?: string;
	kind: WatchlistKind;
	// Static only. Present: replaces the whole membership. Absent on an
	// update: leaves existing membership untouched.
	instrumentIds?: string[];
	// Dynamic only.
	screenerId?: ResourceId;
	screenerRevision?: Revision;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function nameIssues(input: UpsertWatchlistInput, isCreate: boolean): string[] {
	if (input.name === undefined) {
		return isCreate ? ['name: required when creating a watchlist.'] : [];
	}
	return isNonEmptyString(input.name) ? [] : ['name: expected a non-empty string.'];
}

function staticIssues(
	input: UpsertWatchlistInput,
	existing: Watchlist | null,
	isCreate: boolean
): string[] {
	if (input.instrumentIds === undefined) {
		if (!isCreate && existing?.kind === 'dynamic') {
			return [
				'instrument_ids: required when converting a dynamic watchlist to static -- there is ' +
					'no prior membership to fall back to.'
			];
		}
		return [];
	}
	if (
		!Array.isArray(input.instrumentIds) ||
		!input.instrumentIds.every((id) => isNonEmptyString(id))
	) {
		return ['instrument_ids: expected an array of instrument IDs.'];
	}
	return [];
}

function dynamicIssues(
	input: UpsertWatchlistInput,
	doc: WorkspaceDocument,
	watchlistId: ResourceId | undefined,
	isCreate: boolean
): string[] {
	if (!isNonEmptyString(input.screenerId)) {
		return ['screener_id: required for a dynamic watchlist.'];
	}
	const screener = readScreener(doc, input.screenerId);
	if (!screener) {
		return [`screener_id: "${input.screenerId}" is not a screener in this workspace.`];
	}
	if (input.screenerRevision !== undefined && typeof input.screenerRevision !== 'number') {
		return ['screener_revision: expected a number.'];
	}
	// A brand-new watchlist ID cannot yet be referenced by any screener's
	// universe (IDs are minted, never caller-chosen), so a cycle is
	// structurally impossible on creation -- only an existing ID can already
	// sit inside some screener's universe.watchlists.
	if (!isCreate && watchlistId && screenerReachesWatchlist(doc, input.screenerId, watchlistId)) {
		return [
			`screener_id: making watchlist "${watchlistId}" dynamic on screener "${input.screenerId}" ` +
				"would create a cycle -- that screener's universe already reaches this watchlist, " +
				'directly or through another dynamic watchlist.'
		];
	}
	return [];
}

function validateUpsertWatchlist(input: UpsertWatchlistInput, doc: WorkspaceDocument): string[] {
	const isCreate = input.watchlistId === undefined;
	const existing = isCreate ? null : readWatchlist(doc, input.watchlistId as ResourceId);
	const issues: string[] = [];
	if (!isCreate && !existing) {
		issues.push(`watchlist_id: "${input.watchlistId}" is not a watchlist in this workspace.`);
	}
	issues.push(...nameIssues(input, isCreate));
	if (input.kind !== 'static' && input.kind !== 'dynamic') {
		issues.push(`kind: "${String(input.kind)}" must be "static" or "dynamic".`);
		return issues;
	}
	if (input.kind === 'static') {
		issues.push(...staticIssues(input, existing, isCreate));
	} else {
		issues.push(...dynamicIssues(input, doc, input.watchlistId, isCreate));
	}
	return issues;
}

// Preserves an existing member's own addedAt/source when its instrument ID
// persists across a replace -- a rename or a re-supply of the same list must
// not reset a member's provenance to "manual, right now".
function buildStaticMembers(
	instrumentIds: string[],
	existingMembers: readonly WatchlistMember[],
	now: string
): WatchlistMember[] {
	const byId = new Map(existingMembers.map((m) => [m.instrumentId, m]));
	const seen = new Set<string>();
	const members: WatchlistMember[] = [];
	for (const instrumentId of instrumentIds) {
		if (seen.has(instrumentId)) {
			continue;
		}
		seen.add(instrumentId);
		members.push(
			byId.get(instrumentId) ?? { instrumentId, addedAt: now, source: { kind: 'manual' } }
		);
	}
	return members;
}

function nextWatchlist(
	input: UpsertWatchlistInput,
	existing: Watchlist | null,
	watchlistId: ResourceId,
	doc: WorkspaceDocument,
	now: string
): Watchlist {
	const createdAt = existing?.createdAt ?? now;
	const name = input.name ?? existing?.name ?? '';
	if (input.kind === 'dynamic') {
		const screenerId = input.screenerId as ResourceId;
		const screenerRevision = input.screenerRevision ?? readScreener(doc, screenerId)?.revision ?? 1;
		return {
			watchlistId,
			name,
			kind: 'dynamic',
			screenerId,
			screenerRevision,
			createdAt,
			updatedAt: now
		};
	}
	const existingMembers = existing?.kind === 'static' ? existing.members : [];
	const members =
		input.instrumentIds !== undefined
			? buildStaticMembers(input.instrumentIds, existingMembers, now)
			: existingMembers;
	return { watchlistId, name, kind: 'static', members, createdAt, updatedAt: now };
}

function applyUpsertWatchlist(
	input: UpsertWatchlistInput,
	doc: WorkspaceDocument,
	ids: IdSequencer,
	now: string
): MutationDraft {
	const isCreate = input.watchlistId === undefined;
	const watchlistId = input.watchlistId ?? ids.next('watchlist');
	const existing = isCreate ? null : readWatchlist(doc, watchlistId);
	const next = nextWatchlist(input, existing, watchlistId, doc, now);
	const document = writeWatchlist(doc, next);
	const verb = isCreate ? 'Created' : 'Updated';
	return {
		document,
		affectedIds: [watchlistId],
		diffSummary: `${verb} ${next.kind} watchlist "${next.name}" (${watchlistId}).`,
		inverse: {
			// The pre-mutation document already is the correct prior state,
			// whether this was a create (watchlistId absent from it) or an
			// update (existing entry present in it) -- mirrors
			// chartAnnotations.ts's and captureSetup.ts's own inverse pattern.
			document: doc,
			affectedIds: [watchlistId],
			diffSummary: existing
				? `Reverted watchlist ${watchlistId} to its prior state.`
				: `Removed watchlist ${watchlistId}.`
		}
	};
}

export const UPSERT_WATCHLIST_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		watchlist_id: {
			type: 'string',
			description: 'Omit to create a new watchlist; supply to update one in place.'
		},
		name: {
			type: 'string',
			description: 'Required when creating. Omit on an update to leave the name unchanged.'
		},
		kind: { type: 'string', enum: ['static', 'dynamic'] },
		instrument_ids: {
			type: 'array',
			items: { type: 'string' },
			description:
				'Static only. Replaces the whole membership. Omit on an update to leave membership ' +
				'unchanged.'
		},
		screener_id: {
			type: 'string',
			description: 'Dynamic only: the screener this watchlist follows.'
		},
		screener_revision: {
			type: 'number',
			description: "Dynamic only. Defaults to the screener's current revision."
		},
		expected_revision: { type: 'number' },
		idempotency_key: { type: 'string' }
	},
	required: ['kind']
};

export function createUpsertWatchlistOperation(deps: {
	clock: Clock;
}): OperationDefinition<UpsertWatchlistInput> {
	return {
		kind: WATCHLIST_UPSERT_KIND,
		inputSchema: UPSERT_WATCHLIST_SCHEMA,
		validate: validateUpsertWatchlist,
		describe: (input) =>
			input.watchlistId
				? `Update watchlist ${input.watchlistId}.`
				: `Create a ${input.kind} watchlist named "${input.name}".`,
		apply: (input, doc, ids) => applyUpsertWatchlist(input, doc, ids, deps.clock.now())
	};
}

// Idempotent so a tool factory can guarantee its operation exists without
// fighting a composition root that registered it first.
export function ensureUpsertWatchlistOperation(
	registry: OperationRegistry,
	deps: { clock: Clock }
): void {
	if (!registry.get(WATCHLIST_UPSERT_KIND)) {
		registry.register(createUpsertWatchlistOperation(deps));
	}
}
