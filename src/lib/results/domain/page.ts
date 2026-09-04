// The bounded results page (T-1010-2): what a page of an already-pinned
// screener run's results *is* -- row shape, result-ID minting, the cursor
// that resumes a stable traversal, and the page-size bound the page model
// enforces on itself. This is the layer EPIC-1010's `get_screener_results`
// reads verbatim; T-1010-4 projects these rows through a table
// configuration and computed columns, it does not redefine them.
//
// Domain layer: no I/O, no import from ../ports, ../application, or
// src/lib/webmcp/. Everything a page needs (the run, its matches, a ticker
// lookup) is passed in already-resolved.

import { mintId, type ResourceId } from '../../workbench/domain/ids';
import { toWireProvenance, type MarketDataProvenance } from '../../workbench/domain/provenance';
import type { ScreenerMatch, ScreenerRun } from '../../screener/run';

// spec.md Open Question 4's assumption: default 25 rows, hard maximum 200.
// Declared here so every caller (the application layer, and any future
// tool-layer schema) clamps -- or rather refuses to clamp -- against the
// same numbers.
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

// One row of a results page. Deliberately narrow: identity plus the
// display-only ticker plus the two scalars every match already carries
// (rank, compositeScore). `nodeEvaluations` (T-1010-3's explain scope) and
// a full column projection (T-1010-4) are not this ticket's job -- both
// stay reachable from the pinned run itself for the tickets that need them.
export interface ResultRow {
	// Stable per-row identifier (AC2). Never reused, never renumbered: see
	// mintResultId below for why it is derived from `rank`, not a sequencer.
	resultId: ResourceId;
	// Stable identifier of the matched instrument. Never the ticker.
	instrumentId: string;
	// Display attribute only (AC2) -- never used as, or accepted in place
	// of, an identifier. `null` when the caller's ticker lookup could not
	// resolve one; an honest absence, not a fabricated symbol.
	ticker: string | null;
	// The full instrument reference (T-0026-3), carried straight off the
	// match rather than through the ticker resolver above: ScreenerMatch now
	// sources these itself (screener/run.ts), so a row needs no second
	// lookup to expose them on the wire.
	symbol: string;
	exchange: string;
	assetType: string;
	name: string;
	rank: number;
	compositeScore: number | null;
}

// A bounded page of an existing run's results (AC1). `total` is the count
// of rows actually retrievable through this run -- `returnedCount`, i.e.
// `matches.length` -- not `matchedCount`, which can exceed what was stored
// once a run was truncated; paging must never promise a row that isn't
// there. `offset` is the zero-based position of `rows[0]` within the run's
// one fixed match order. `nextCursor` is absent (null) on the last page.
export interface ResultsPage {
	runId: ResourceId;
	rows: ResultRow[];
	total: number;
	offset: number;
	pageSize: number;
	nextCursor: string | null;
	// The pinned run's own provenance, carried verbatim (AC3, AC4) -- never
	// regenerated at read time. See resultsReader.ts for why no Clock
	// dependency exists anywhere in this area.
	provenance: MarketDataProvenance;
}

// Ranks are unique, contiguous from 1, and permanently fixed for a pinned
// run (run.ts's makeScreenerRun enforces this at construction and a run's
// `matches` never change after minting). Using `rank` as mintId's sequence
// number -- instead of ids.ts's mutable IdSequencer -- makes result-ID
// minting a pure, idempotent function of (runId, rank): the same row gets
// the same result_id every time a page is re-read, which a stateful
// sequencer could not guarantee for a read-only, freely re-callable
// operation like this one.
export function mintResultId(runId: ResourceId, rank: number): ResourceId {
	return mintId('result', rank, runId);
}

// Resolves a caller-supplied ticker for display. Kept as an injected
// function rather than a lookup this module performs itself: resolving a
// ticker from an instrument ID is an async catalog read (discovery's
// InstrumentDirectory), and the domain layer must not perform I/O.
export type TickerResolver = (instrumentId: string) => string | null;

export function buildRow(
	runId: ResourceId,
	match: ScreenerMatch,
	resolveTicker: TickerResolver
): ResultRow {
	return {
		resultId: mintResultId(runId, match.rank),
		instrumentId: match.instrumentId,
		ticker: resolveTicker(match.instrumentId),
		symbol: match.symbol,
		exchange: match.exchange,
		assetType: match.assetType,
		name: match.name,
		rank: match.rank,
		compositeScore: match.compositeScore
	};
}

// Why a page larger than MAX_PAGE_SIZE cannot exist (AC9): the only page
// constructor throws rather than silently truncating or accepting it. A
// caller-facing rejection (naming the maximum, never clamping) is a
// separate concern -- see resolvePageSize below -- this is the
// programmer-error guard behind it, in the same style as run.ts's
// makeScreenerRun.
export function makeResultsPage(input: ResultsPage): ResultsPage {
	if (input.rows.length > MAX_PAGE_SIZE) {
		throw new Error(
			`makeResultsPage: a page cannot hold more than ${MAX_PAGE_SIZE} rows, got ${input.rows.length}.`
		);
	}
	if (input.offset < 0) {
		throw new Error(`makeResultsPage: offset must be >= 0, got ${input.offset}.`);
	}
	if (input.total < 0) {
		throw new Error(`makeResultsPage: total must be >= 0, got ${input.total}.`);
	}
	return { ...input };
}

// Requesting more than MAX_PAGE_SIZE names the maximum rather than being
// silently clamped (AC9); requesting a negative or non-finite size is
// rejected the same way rather than coerced into something plausible.
export interface PageSizeRejected {
	rejected: true;
	reason: 'page_size_exceeded' | 'page_size_invalid';
	requested: number;
	max: number;
	message: string;
}

export function resolvePageSize(requested: number | undefined): number | PageSizeRejected {
	if (requested === undefined) {
		return DEFAULT_PAGE_SIZE;
	}
	if (!Number.isInteger(requested) || requested < 1) {
		return {
			rejected: true,
			reason: 'page_size_invalid',
			requested,
			max: MAX_PAGE_SIZE,
			message: `Requested page size ${requested} is invalid: it must be a positive integer.`
		};
	}
	if (requested > MAX_PAGE_SIZE) {
		return {
			rejected: true,
			reason: 'page_size_exceeded',
			requested,
			max: MAX_PAGE_SIZE,
			message: `Requested page size ${requested} exceeds the maximum of ${MAX_PAGE_SIZE}.`
		};
	}
	return requested;
}

// Opaque resume token: version tag + runId + offset. Not base64 -- a
// resource ID (ids.ts's grammar) is already ASCII letters/digits/
// underscores, so a plain delimiter the grammar can never produce ('~') is
// enough to make this safe to split back apart, with no encoding library
// and no Unicode edge cases to get wrong.
const CURSOR_TAG = 'rc1';
const CURSOR_DELIMITER = '~';

export interface ResultsCursor {
	runId: ResourceId;
	offset: number;
}

export function encodeCursor(cursor: ResultsCursor): string {
	return [CURSOR_TAG, cursor.runId, String(cursor.offset)].join(CURSOR_DELIMITER);
}

export type CursorRejectionReason = 'malformed' | 'run_mismatch';

export interface CursorRejected {
	rejected: true;
	reason: 'invalid_cursor';
	cursorReason: CursorRejectionReason;
	cursor: string;
	message: string;
}

// Never throws: an unparseable or foreign-run cursor is a typed rejection,
// never silently reinterpreted as the first page (that would violate the
// stable-traversal guarantee this cursor exists to provide).
export function decodeCursor(
	cursor: string,
	expectedRunId: ResourceId
): ResultsCursor | CursorRejected {
	const parts = cursor.split(CURSOR_DELIMITER);
	const [tag, runId, offsetPart] = parts;
	const malformed =
		parts.length !== 3 || tag !== CURSOR_TAG || !runId || !offsetPart || !/^\d+$/.test(offsetPart);
	if (malformed) {
		return {
			rejected: true,
			reason: 'invalid_cursor',
			cursorReason: 'malformed',
			cursor,
			message: `Cursor "${cursor}" could not be parsed. Request the first page (omit the cursor) and page forward from there.`
		};
	}
	if (runId !== expectedRunId) {
		return {
			rejected: true,
			reason: 'invalid_cursor',
			cursorReason: 'run_mismatch',
			cursor,
			message: `Cursor "${cursor}" belongs to a different run than the one requested (${expectedRunId}).`
		};
	}
	return { runId, offset: Number.parseInt(offsetPart, 10) };
}

// Builds one page from a run's already-fetched slice of matches (AC1, AC7).
// `matches` must be exactly the rows for this page (the caller -- the
// application layer -- is responsible for slicing via PinnedRunStore); this
// function only assembles them into the documented page shape and computes
// the next cursor. `total` is the run's returnedCount, passed in rather
// than re-derived, so an empty-run page (AC7) and a mid-run page share one
// code path.
export function buildResultsPage(input: {
	run: ScreenerRun;
	matches: ScreenerMatch[];
	offset: number;
	pageSize: number;
	resolveTicker: TickerResolver;
}): ResultsPage {
	const { run, matches, offset, pageSize, resolveTicker } = input;
	const rows = matches.map((match) => buildRow(run.runId, match, resolveTicker));
	const nextOffset = offset + rows.length;
	const hasNextPage = nextOffset < run.returnedCount;
	return makeResultsPage({
		runId: run.runId,
		rows,
		total: run.returnedCount,
		offset,
		pageSize,
		nextCursor: hasNextPage ? encodeCursor({ runId: run.runId, offset: nextOffset }) : null,
		provenance: run.provenance
	});
}

// The single snake_case serializer for a row, matching run.ts's
// toWireScreenerMatch convention.
export function toWireResultRow(row: ResultRow): Record<string, unknown> {
	return {
		result_id: row.resultId,
		instrument_id: row.instrumentId,
		ticker: row.ticker,
		symbol: row.symbol,
		exchange: row.exchange,
		asset_type: row.assetType,
		name: row.name,
		rank: row.rank,
		composite_score: row.compositeScore
	};
}

// The single snake_case serializer for a page, delegating to
// toWireProvenance so this module never re-implements provenance's wire
// shape (matching run.ts's toWireScreenerRun).
export function toWireResultsPage(page: ResultsPage): Record<string, unknown> {
	return {
		run_id: page.runId,
		rows: page.rows.map(toWireResultRow),
		total: page.total,
		offset: page.offset,
		page_size: page.pageSize,
		next_cursor: page.nextCursor,
		provenance: toWireProvenance(page.provenance)
	};
}
