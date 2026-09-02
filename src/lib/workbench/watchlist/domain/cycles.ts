// Cycle detection between dynamic watchlists and the screeners that define
// them (this ticket's Technical Considerations): a screener's universe can
// name a watchlist as an input (screener/definition.ts's
// UniverseSpec.watchlists), and a dynamic watchlist names a screener as its
// definition -- so the two graphs can loop back on each other. A screener
// whose universe is (directly, or through a chain of other dynamic
// watchlists) a watchlist defined by that same screener would have no
// coherent membership to resolve, so this is checked before such a
// reference is ever written.
//
// Domain-adjacent: pure over WorkspaceDocument, no I/O. Reads across into
// screener/state.ts the same way results/ and chart/ already read across
// into screener/run.ts and screener/ports.ts -- both are workbench-extension
// data living in the same document, not a layering violation.
import type { ResourceId } from '../../domain/ids';
import type { WorkspaceDocument } from '../../domain/workspace';
import { readScreener } from '../../../screener/state';
import { readWatchlist } from './watchlist';

// True when `screenerId`'s universe reaches `targetWatchlistId`, directly or
// through a chain of other dynamic watchlists' own screener references.
// `visited` stops the walk from looping forever if a cycle already exists
// elsewhere in the graph -- a pre-existing cycle answers "no new cycle from
// this edge" rather than hanging.
export function screenerReachesWatchlist(
	doc: WorkspaceDocument,
	screenerId: ResourceId,
	targetWatchlistId: ResourceId,
	visited: Set<ResourceId> = new Set()
): boolean {
	if (visited.has(screenerId)) {
		return false;
	}
	visited.add(screenerId);
	const screener = readScreener(doc, screenerId);
	if (!screener) {
		return false;
	}
	for (const watchlistId of screener.universe.watchlists) {
		if (watchlistId === targetWatchlistId) {
			return true;
		}
		const watchlist = readWatchlist(doc, watchlistId);
		if (
			watchlist?.kind === 'dynamic' &&
			screenerReachesWatchlist(doc, watchlist.screenerId, targetWatchlistId, visited)
		) {
			return true;
		}
	}
	return false;
}
