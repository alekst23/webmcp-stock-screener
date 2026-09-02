// The only implementation of ../ports.ts's ResultsReader (T-1010-2).
// Composes over the existing PinnedRunStore (src/lib/screener/ports.ts) --
// getRun and getMatches only -- rather than declaring a second run-read
// contract. No Clock, no execute path: nothing in this file can produce a
// fresher run than the one already pinned under `runId`.

import type { ResourceId } from '../../workbench/domain/ids';
import type { PinnedRunStore, RunNotAvailable } from '../../screener/ports';
import type { ScreenerRun } from '../../screener/run';
import {
	buildResultsPage,
	decodeCursor,
	resolvePageSize,
	type TickerResolver
} from '../domain/page';
import type { PageRequest, ResultsPageOutcome, ResultsReader, RunMetadata } from '../ports';

export interface ResultsReaderOptions {
	// Resolves an instrument ID to a display ticker. Defaults to a resolver
	// that always reports "unresolved" (`null`) -- an honest absence rather
	// than a fabricated symbol -- since resolving a real ticker is an async
	// catalog read (discovery's InstrumentDirectory) that this read-only,
	// synchronous contract does not perform itself.
	resolveTicker?: TickerResolver;
}

function isRunNotAvailable<T>(value: T | RunNotAvailable): value is RunNotAvailable {
	return typeof value === 'object' && value !== null && 'available' in value;
}

function toRunMetadata(run: ScreenerRun): RunMetadata {
	return {
		runId: run.runId,
		screenerId: run.screenerId,
		screenerRevision: run.screenerRevision,
		universeCount: run.universeCount,
		matchedCount: run.matchedCount,
		returnedCount: run.returnedCount,
		truncated: run.truncated,
		rankingApplied: run.rankingApplied,
		normalization: run.normalization,
		warnings: run.warnings,
		provenance: run.provenance,
		createdAt: run.createdAt
	};
}

export function createResultsReader(
	store: PinnedRunStore,
	options: ResultsReaderOptions = {}
): ResultsReader {
	const resolveTicker: TickerResolver = options.resolveTicker ?? (() => null);

	function getRunMetadata(runId: ResourceId): RunMetadata | RunNotAvailable {
		const run = store.getRun(runId);
		return isRunNotAvailable(run) ? run : toRunMetadata(run);
	}

	function getResultsPage(runId: ResourceId, request: PageRequest = {}): ResultsPageOutcome {
		const pageSize = resolvePageSize(request.pageSize);
		if (typeof pageSize !== 'number') {
			return pageSize;
		}

		const run = store.getRun(runId);
		if (isRunNotAvailable(run)) {
			return run;
		}

		let offset = 0;
		if (request.cursor !== undefined) {
			const decoded = decodeCursor(request.cursor, runId);
			if ('rejected' in decoded) {
				return decoded;
			}
			offset = decoded.offset;
		}

		const matches = store.getMatches(runId, offset, pageSize);
		if (isRunNotAvailable(matches)) {
			return matches;
		}

		return buildResultsPage({ run, matches, offset, pageSize, resolveTicker });
	}

	return { getRunMetadata, getResultsPage };
}
