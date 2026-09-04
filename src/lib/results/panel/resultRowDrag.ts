// T-0027-2: builds the `PanelSourceRef` a dragged results row carries.
//
// This project has no live reference-data source -- no exchange MIC or
// asset-classification service exists anywhere in the codebase (see
// chart/tools/resolveTicker.ts's own header, which documents the identical
// gap for the agent-facing `resolve_ticker` tool and establishes the
// project's convention for it: mint a provisional, honestly-labeled
// InstrumentRef rather than blocking on data this project doesn't have).
// A ResultRow already carries a canonical instrumentId (never a bare
// ticker -- see results/domain/page.ts) but not an exchange or asset type,
// so this follows that same established convention: exchange defaults to
// resolveTicker.ts's own "XUNK" (unknown) sentinel, asset type to
// 'equity'. What actually differs from resolve_ticker.ts is instrumentId
// itself: a screener result's instrumentId is already resolved and
// canonical, so it is carried through unchanged rather than re-minted from
// ticker text.
import type { ResultRow } from '../domain/page';
import type { PanelSourceRef } from '../../panels/domain/panel';

// Matches resolveTicker.ts's own UNKNOWN_EXCHANGE constant and rationale --
// never collides with a real MIC.
export const UNKNOWN_EXCHANGE = 'XUNK';

// The chart source type's own name (chart/tools/chartRendererContract.ts's
// CHART_SOURCE_TYPE) -- not imported directly to avoid a results -> chart
// feature dependency for one string constant; the two are proven to agree
// by chartSource.test.ts and this module's own test.
const INSTRUMENT_SOURCE_TYPE = 'instrument';

export function resultRowToPanelSource(row: ResultRow): PanelSourceRef {
	return {
		type: INSTRUMENT_SOURCE_TYPE,
		ref: {
			instrument: {
				instrument_id: row.instrumentId,
				symbol: row.ticker ?? row.instrumentId,
				exchange: UNKNOWN_EXCHANGE,
				asset_type: 'equity'
			}
		}
	};
}
