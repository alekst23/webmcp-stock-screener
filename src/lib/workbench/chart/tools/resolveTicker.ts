// `resolve_ticker`: mints a provisional InstrumentRef from a bare ticker.
//
// This project has no live reference-data source -- no company name,
// exchange MIC, country, currency, ISIN/FIGI service exists anywhere in the
// codebase (see src/lib/discovery/ports.ts and
// docs/design/discovery-and-catalog/technical.md: sourcing that is
// deliberately future, unowned work). bind_panel_source's chart 'instrument'
// source type doesn't need that full shape though -- only
// {instrument_id, symbol, exchange, asset_type} (chart/application/
// chartSource.ts), validated on shape alone (chart/domain/instrument.ts's
// validateInstrumentRef): exchange just needs to be a non-empty string and
// assetType one of a fixed enum, no real listing data required. So rather
// than stand up a real search here (or repurpose webmcp/discovery, which is
// that future work's deliberately-deferred seam), this mints that minimal
// shape straight from the ticker text and says so -- whether the ticker
// actually has data is discovered downstream, when the chart is bound and
// rendered (backend/api/routes/chart.py's 404 on an unknown ticker).
import { isInstrumentId } from '../../../surface/ids';
import { fail, ok } from '../../../webmcp/toolResult';
import type { ToolSpec } from '../../../webmcp/types';
import { ensureModelContext } from '../../../webmcp/bridge';

export const RESOLVE_TICKER_TOOL_NAME = 'resolve_ticker';

// Never collides with a real MIC; four characters to match the
// `inst:XXXX:SYMBOL` shape isInstrumentId requires (surface/ids.ts).
const UNKNOWN_EXCHANGE = 'XUNK';

const DESCRIPTION =
	"Turns a bare ticker into the instrument reference bind_panel_source's chart " +
	'source requires. This project has no live reference-data source (no company ' +
	'name, exchange, or asset-classification service), so this mints a provisional ' +
	'reference from the ticker text alone -- asset type is assumed "equity", the ' +
	`exchange is reported as "${UNKNOWN_EXCHANGE}" (unknown) -- and does not confirm ` +
	'the ticker actually has data. Whether it does is discovered only once the chart ' +
	'is bound and rendered. Pass this result directly as bind_panel_source\'s ' +
	'source.ref, with source.type "instrument".';

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		ticker: {
			type: 'string',
			minLength: 1,
			description: 'The ticker to resolve, e.g. "STX" or "MOCK13".'
		}
	},
	required: ['ticker']
};

function readTicker(input: unknown): string | null {
	if (!input || typeof input !== 'object') {
		return null;
	}
	const raw = (input as Record<string, unknown>).ticker;
	if (typeof raw !== 'string') {
		return null;
	}
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function buildResolveTickerTool(): ToolSpec {
	return {
		name: RESOLVE_TICKER_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: async (rawInput: unknown) => {
			const ticker = readTicker(rawInput);
			if (!ticker) {
				return fail('"ticker" is required and must be a non-empty string.');
			}
			const symbol = ticker.toUpperCase();
			const instrumentId = `inst:${UNKNOWN_EXCHANGE}:${symbol}`;
			if (!isInstrumentId(instrumentId)) {
				return fail(`"${ticker}" cannot be turned into a valid instrument reference.`, {
					ticker
				});
			}
			return ok({
				instrument: {
					instrument_id: instrumentId,
					symbol,
					exchange: UNKNOWN_EXCHANGE,
					asset_type: 'equity'
				},
				note:
					'Provisional reference minted from the ticker text, not resolved against a ' +
					'reference-data source. Existence is confirmed only once bound and rendered.'
			});
		}
	};
}

export async function registerResolveTickerTool(): Promise<void> {
	const mc = ensureModelContext();
	const spec = buildResolveTickerTool();
	await mc.registerTool({
		name: spec.name,
		description: spec.description,
		inputSchema: spec.inputSchema,
		execute: spec.execute
	});
}
