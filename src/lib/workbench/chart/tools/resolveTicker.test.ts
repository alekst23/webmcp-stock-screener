import { describe, expect, it } from 'vitest';
import { isInstrumentId } from '../../../surface/ids';
import { validateChartSourceReference } from '../application/chartSource';
import { buildResolveTickerTool, RESOLVE_TICKER_TOOL_NAME } from './resolveTicker';

function parse(text: string): Record<string, unknown> {
	return JSON.parse(text) as Record<string, unknown>;
}

describe('resolve_ticker', () => {
	it('mints a ref that bind_panel_source\'s chart source accepts as-is', async () => {
		const tool = buildResolveTickerTool();
		expect(tool.name).toBe(RESOLVE_TICKER_TOOL_NAME);

		const result = await tool.execute({ ticker: 'STX' });
		expect(result.isError).toBeFalsy();

		const body = parse(result.content[0]!.text);
		const instrument = body.instrument as Record<string, unknown>;
		expect(instrument.instrument_id).toBe('inst:XUNK:STX');
		expect(instrument.symbol).toBe('STX');
		expect(instrument.exchange).toBe('XUNK');
		expect(instrument.asset_type).toBe('equity');
		expect(isInstrumentId(instrument.instrument_id)).toBe(true);

		// The exact registry-facing validator bind_panel_source's chart
		// source type runs the ref through (chart/application/chartSource.ts,
		// via chart/registry/chartPanelKind.ts's adaptSourceType) -- proves
		// the whole `body` is directly usable as source.ref, not just
		// shape-plausible.
		expect(validateChartSourceReference(body)).toEqual([]);
	});

	it('uppercases a lowercase ticker', async () => {
		const tool = buildResolveTickerTool();
		const result = await tool.execute({ ticker: 'mock13' });
		const body = parse(result.content[0]!.text);
		const instrument = body.instrument as Record<string, unknown>;
		expect(instrument.symbol).toBe('MOCK13');
		expect(instrument.instrument_id).toBe('inst:XUNK:MOCK13');
	});

	it('rejects a missing or empty ticker', async () => {
		const tool = buildResolveTickerTool();
		expect((await tool.execute({})).isError).toBe(true);
		expect((await tool.execute({ ticker: '   ' })).isError).toBe(true);
		expect((await tool.execute({ ticker: 42 })).isError).toBe(true);
	});
});
