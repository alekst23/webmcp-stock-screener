import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPanelStatus, formatPanelStatus, isMockPanel } from './panelStatus';

const REAL_PANEL = {
	as_of: '2026-08-31',
	first_date: '2016-01-04',
	ticker_count: 6268,
	row_count: 12_000_000,
	source: 'object-store'
};

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => response as Response)
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('panel status', () => {
	it('maps the backend snake_case shape onto the UI shape', async () => {
		stubFetch({ ok: true, json: async () => REAL_PANEL });

		const status = await fetchPanelStatus({ baseUrl: 'http://api.test' });

		expect(status).toEqual({
			asOf: '2026-08-31',
			firstDate: '2016-01-04',
			tickerCount: 6268,
			rowCount: 12_000_000,
			source: 'object-store'
		});
	});

	it('requests the panel endpoint on the configured base URL', async () => {
		stubFetch({ ok: true, json: async () => REAL_PANEL });

		await fetchPanelStatus({ baseUrl: 'http://api.test' });

		expect(fetch).toHaveBeenCalledWith('http://api.test/api/research/panel');
	});

	it('throws when the backend has no panel loaded', async () => {
		stubFetch({ ok: false, status: 503, statusText: 'Service Unavailable' });

		await expect(fetchPanelStatus({ baseUrl: 'http://api.test' })).rejects.toThrow('503');
	});

	it('shows the as-of date for a real panel', () => {
		const text = formatPanelStatus({
			asOf: '2026-08-31',
			firstDate: '2016-01-04',
			tickerCount: 6268,
			rowCount: 12_000_000,
			source: 'object-store'
		});

		expect(text).toContain('2026-08-31');
		expect(text).not.toContain('Synthetic');
	});

	// A synthetic panel described in the same words as real market data is
	// exactly the misreading this surface exists to prevent.
	it('names synthetic data as synthetic rather than dating it like real data', () => {
		const status = {
			asOf: '2025-12-31',
			firstDate: '2023-01-03',
			tickerCount: 25,
			rowCount: 19550,
			source: 'mock'
		};

		expect(formatPanelStatus(status)).toContain('Not real market data');
		expect(isMockPanel(status)).toBe(true);
	});
});
