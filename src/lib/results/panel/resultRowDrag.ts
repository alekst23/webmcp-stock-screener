// T-0027-2: builds the `PanelSourceRef` a dragged results row carries.
//
// A ResultRow carries a full instrument reference (T-0026-3 on
// ScreenerMatch, threaded through by results/domain/page.ts) -- symbol,
// exchange, and asset type all come straight off the row rather than a
// second lookup or a provisional placeholder. This project still has no
// live reference-data source (see chart/tools/resolveTicker.ts), so those
// fields carry whatever honest fallback the match itself already applied
// (e.g. an unresolved exchange reads as resolveTicker.ts's "XUNK"
// sentinel) -- this module does not mint its own placeholder on top.
import type { ResultRow } from '../domain/page';
import type { PanelSourceRef } from '../../panels/domain/panel';

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
				symbol: row.symbol,
				exchange: row.exchange,
				asset_type: row.assetType
			}
		}
	};
}
