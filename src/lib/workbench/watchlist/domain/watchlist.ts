// Watchlist domain model (T-1014-7): a named, addressable set of
// instruments that survives a single result set. Two kinds, deliberately
// never conflated (this ticket's Technical Considerations): a *static*
// watchlist holds a fixed membership list; a *dynamic* one holds no
// membership of its own at all -- it is defined by a screener revision, and
// resolving what currently belongs to it is a read concern for whichever
// panel renders it (EPIC-1007), never something this module computes or
// stores. That absence is what makes AC8's static/dynamic distinction
// structurally impossible to contradict: a dynamic watchlist simply has no
// membership array a save could disagree with.
//
// Domain layer: pure construction, validation and serialization, no I/O.
// Lives inside WorkspaceDocument.extensions, mirroring
// chart/domain/capturedSetup.ts and screener/state.ts's own pattern.
import type { ResourceId } from '../../domain/ids';
import { parseId } from '../../domain/ids';
import type { MarketDataProvenance } from '../../domain/provenance';
import { toWireProvenance } from '../../domain/provenance';
import type { Revision, WorkspaceDocument } from '../../domain/workspace';

export type WatchlistKind = 'static' | 'dynamic';

// Where one member came from, carried on the member itself rather than in a
// gathered aside: a watchlist can accumulate members from several saved runs
// over its life, and "where did this name come from" (the ticket's user
// story) is a per-name question, not a whole-watchlist one. A run-sourced
// member also carries that run's full MarketDataProvenance envelope, which
// is what satisfies AC10 for watchlist contents without a second lookup back
// to a run that may since have been evicted.
export type WatchlistMemberSource =
	| { kind: 'manual' }
	| {
			kind: 'run';
			runId: ResourceId;
			// The pinned run's own timestamp -- not when it was saved here.
			runCreatedAt: string;
			provenance: MarketDataProvenance;
	  };

export interface WatchlistMember {
	instrumentId: string;
	addedAt: string;
	source: WatchlistMemberSource;
}

interface WatchlistBase {
	watchlistId: ResourceId;
	name: string;
	createdAt: string;
	updatedAt: string;
}

export interface StaticWatchlist extends WatchlistBase {
	kind: 'static';
	members: WatchlistMember[];
}

export interface DynamicWatchlist extends WatchlistBase {
	kind: 'dynamic';
	screenerId: ResourceId;
	screenerRevision: Revision;
}

export type Watchlist = StaticWatchlist | DynamicWatchlist;

export const WATCHLIST_EXTENSION_KEY = 'watchlists';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function watchlistMap(doc: WorkspaceDocument): Record<string, unknown> {
	const raw = doc.extensions[WATCHLIST_EXTENSION_KEY];
	return isRecord(raw) ? raw : {};
}

function normalizeSource(value: unknown): WatchlistMemberSource {
	if (
		isRecord(value) &&
		value.kind === 'run' &&
		typeof value.runId === 'string' &&
		typeof value.runCreatedAt === 'string' &&
		isRecord(value.provenance)
	) {
		return {
			kind: 'run',
			runId: value.runId,
			runCreatedAt: value.runCreatedAt,
			// Passed through as stored rather than re-validated field by field:
			// provenance is another epic's contract (workbench/domain/provenance.ts),
			// and re-checking its shape here would be a second, drifting
			// definition of it -- mirrors capturedSetup.ts's own normalize choice.
			provenance: value.provenance as unknown as MarketDataProvenance
		};
	}
	return { kind: 'manual' };
}

function normalizeMember(value: unknown): WatchlistMember | null {
	if (
		!isRecord(value) ||
		typeof value.instrumentId !== 'string' ||
		value.instrumentId.length === 0
	) {
		return null;
	}
	return {
		instrumentId: value.instrumentId,
		addedAt: typeof value.addedAt === 'string' ? value.addedAt : '',
		source: normalizeSource(value.source)
	};
}

function normalizeMembers(value: unknown): WatchlistMember[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: WatchlistMember[] = [];
	for (const entry of value) {
		const member = normalizeMember(entry);
		if (member) {
			out.push(member);
		}
	}
	return out;
}

// Never throws: a corrupt or foreign entry normalizes to null rather than
// breaking every other watchlist in the workspace, mirroring
// capturedSetup.ts's normalize-on-read discipline.
export function normalizeWatchlist(value: unknown): Watchlist | null {
	if (
		!isRecord(value) ||
		typeof value.watchlistId !== 'string' ||
		value.watchlistId.length === 0 ||
		typeof value.name !== 'string' ||
		typeof value.createdAt !== 'string' ||
		typeof value.updatedAt !== 'string'
	) {
		return null;
	}
	const base = {
		watchlistId: value.watchlistId,
		name: value.name,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt
	};
	if (value.kind === 'dynamic') {
		if (typeof value.screenerId !== 'string' || typeof value.screenerRevision !== 'number') {
			return null;
		}
		return {
			...base,
			kind: 'dynamic',
			screenerId: value.screenerId,
			screenerRevision: value.screenerRevision
		};
	}
	if (value.kind === 'static') {
		return { ...base, kind: 'static', members: normalizeMembers(value.members) };
	}
	return null;
}

export function readWatchlist(doc: WorkspaceDocument, watchlistId: ResourceId): Watchlist | null {
	const raw = watchlistMap(doc)[watchlistId];
	if (raw === undefined) {
		return null;
	}
	const normalized = normalizeWatchlist(raw);
	// A stored entry whose own ID no longer matches its map key is corrupt --
	// treat it as absent rather than returning a watchlist under the wrong ID.
	return normalized && normalized.watchlistId === watchlistId ? normalized : null;
}

export function readWatchlists(doc: WorkspaceDocument): Watchlist[] {
	const out: Watchlist[] = [];
	for (const entry of Object.values(watchlistMap(doc))) {
		const watchlist = normalizeWatchlist(entry);
		if (watchlist) {
			out.push(watchlist);
		}
	}
	return out;
}

// Pure: never mutates `doc`, its `extensions` object, or the watchlist map
// inside it -- each is shallow-cloned before the new entry is added.
export function writeWatchlist(doc: WorkspaceDocument, watchlist: Watchlist): WorkspaceDocument {
	const map = { ...watchlistMap(doc), [watchlist.watchlistId]: watchlist };
	return { ...doc, extensions: { ...doc.extensions, [WATCHLIST_EXTENSION_KEY]: map } };
}

// Pure: a no-op copy when the ID was never present.
export function removeWatchlist(
	doc: WorkspaceDocument,
	watchlistId: ResourceId
): WorkspaceDocument {
	const map = { ...watchlistMap(doc) };
	delete map[watchlistId];
	return { ...doc, extensions: { ...doc.extensions, [WATCHLIST_EXTENSION_KEY]: map } };
}

// High-water mark for `createIdSequencer`, so a reloaded workspace never
// mints a watchlist ID an existing entry already holds.
export function watchlistIdSeed(doc: WorkspaceDocument): Record<string, number> {
	const seed: Record<string, number> = {};
	for (const watchlistId of Object.keys(watchlistMap(doc))) {
		const parsed = parseId(watchlistId);
		if (!parsed || parsed.kind !== 'watchlist') {
			continue;
		}
		const key = parsed.discriminator ? `watchlist:${parsed.discriminator}` : 'watchlist';
		seed[key] = Math.max(seed[key] ?? 0, parsed.sequence);
	}
	return seed;
}

function dedupeByInstrumentId(members: WatchlistMember[]): WatchlistMember[] {
	const seen = new Set<string>();
	const out: WatchlistMember[] = [];
	for (const member of members) {
		if (seen.has(member.instrumentId)) {
			continue;
		}
		seen.add(member.instrumentId);
		out.push(member);
	}
	return out;
}

// A dynamic watchlist has no membership of its own -- converting one to
// static (save_results_to_watchlist's AC8 path) starts from an empty static
// shell that keeps the same ID, name and createdAt, never from a fabricated
// membership. A static watchlist passes through unchanged.
export function asStaticBase(watchlist: Watchlist): StaticWatchlist {
	if (watchlist.kind === 'static') {
		return watchlist;
	}
	return {
		watchlistId: watchlist.watchlistId,
		name: watchlist.name,
		kind: 'static',
		members: [],
		createdAt: watchlist.createdAt,
		updatedAt: watchlist.updatedAt
	};
}

export interface AddMembersResult {
	watchlist: StaticWatchlist;
	addedCount: number;
	alreadyPresentCount: number;
}

// Adds `incoming` members to a static watchlist's membership, deduplicated
// by instrument ID (AC7): `incoming` is de-duplicated against itself first,
// so a duplicate within one call's own selection can't be double-counted,
// then against the existing membership -- an instrument already present
// keeps its original member record (its earlier source/addedAt is the truer
// provenance) and is only counted, never overwritten.
// `addedCount + alreadyPresentCount` always equals the de-duplicated
// incoming count.
export function addMembers(
	watchlist: StaticWatchlist,
	incoming: WatchlistMember[]
): AddMembersResult {
	const existingIds = new Set(watchlist.members.map((m) => m.instrumentId));
	const added: WatchlistMember[] = [];
	let alreadyPresentCount = 0;
	for (const member of dedupeByInstrumentId(incoming)) {
		if (existingIds.has(member.instrumentId)) {
			alreadyPresentCount += 1;
			continue;
		}
		added.push(member);
	}
	return {
		watchlist: { ...watchlist, members: [...watchlist.members, ...added] },
		addedCount: added.length,
		alreadyPresentCount
	};
}

function toWireSource(source: WatchlistMemberSource): Record<string, unknown> {
	if (source.kind === 'manual') {
		return { kind: 'manual' };
	}
	return {
		kind: 'run',
		run_id: source.runId,
		run_created_at: source.runCreatedAt,
		provenance: toWireProvenance(source.provenance)
	};
}

function toWireMember(member: WatchlistMember): Record<string, unknown> {
	return {
		instrument_id: member.instrumentId,
		added_at: member.addedAt,
		source: toWireSource(member.source)
	};
}

// The single snake_case serializer for a watchlist. Static and dynamic
// share the base fields; only the kind-specific tail differs, so a reader
// never has to guess which fields a given `kind` carries.
export function toWireWatchlist(watchlist: Watchlist): Record<string, unknown> {
	const base = {
		watchlist_id: watchlist.watchlistId,
		name: watchlist.name,
		kind: watchlist.kind,
		created_at: watchlist.createdAt,
		updated_at: watchlist.updatedAt
	};
	if (watchlist.kind === 'dynamic') {
		return {
			...base,
			screener_id: watchlist.screenerId,
			screener_revision: watchlist.screenerRevision
		};
	}
	return { ...base, members: watchlist.members.map(toWireMember) };
}
