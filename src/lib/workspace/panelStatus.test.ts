import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPanelStatus, formatFreshness, formatPanelStatus, isMockPanel } from './panelStatus';

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
	// T-0013-5: a degraded panel still answers, and says so in the same line
	// the as-of date lives in -- a notice somewhere else is a notice nobody
	// reads next to the result it qualifies.
	it('appends the backend degradation notices to the status line', () => {
		const text = formatPanelStatus({
			asOf: '2026-08-20',
			firstDate: '2016-01-04',
			tickerCount: 6268,
			rowCount: 12_000_000,
			source: 'object-store',
			isStale: true,
			notices: [
				'Panel is 8 sessions behind: the newest bar is 2026-08-20.',
				'Universe incomplete: 1 ticker range could not be read (AAPL..ADBE).'
			]
		});

		expect(text).toContain('8 sessions behind');
		expect(text).toContain('AAPL..ADBE');
		expect(text).toContain('2026-08-20');
	});

	it('does not say "synthetic" twice when the backend also says it', () => {
		const text = formatPanelStatus({
			asOf: '2025-12-31',
			firstDate: '2023-01-03',
			tickerCount: 25,
			rowCount: 19550,
			source: 'mock',
			notices: ['Synthetic demo data — not real market data.']
		});

		expect(text.match(/Synthetic/g)).toHaveLength(1);
		expect(text).toContain('Not real market data');
	});

	it('carries the notices through the fetch mapping', async () => {
		stubFetch({
			ok: true,
			json: async () => ({
				...REAL_PANEL,
				is_stale: true,
				notices: ['Panel is 8 sessions behind.']
			})
		});

		const status = await fetchPanelStatus({ baseUrl: 'http://api.test' });

		expect(status.isStale).toBe(true);
		expect(status.notices).toEqual(['Panel is 8 sessions behind.']);
	});
});

// hotfix/marketpane-rebrand: the header pill that replaces the permanent
// synthetic-data banner. The critical invariant carried over from that
// banner is that synthetic data must still be named as synthetic -- these
// scenarios exist to catch a regression that quietly folds "synthetic" into
// the same bucket as "stale", which would be the disclosure this feature is
// required to preserve silently disappearing.
describe('formatFreshness', () => {
	const NOW = new Date('2026-09-02T12:00:00Z');

	it('reports unknown with no panel loaded yet, rather than guessing an age', () => {
		expect(formatFreshness(null, NOW)).toEqual({ state: 'unknown', label: 'checking…' });
	});

	it('names a synthetic panel as synthetic, not by age', () => {
		const status = {
			asOf: '2026-09-02T10:00:00Z',
			firstDate: '2023-01-03',
			tickerCount: 25,
			rowCount: 19550,
			source: 'mock'
		};

		const freshness = formatFreshness(status, NOW);

		expect(freshness.state).toBe('synthetic');
		expect(freshness.label).toBe('Synthetic data');
	});

	it('marks a real but stale panel as stale rather than presenting it as fresh', () => {
		const status = {
			asOf: '2026-09-02T10:00:00Z',
			firstDate: '2016-01-04',
			tickerCount: 6268,
			rowCount: 12_000_000,
			source: 'object-store',
			isStale: true
		};

		const freshness = formatFreshness(status, NOW);

		expect(freshness.state).toBe('stale');
		expect(freshness.label).toBe('updated 2h ago');
	});

	// The invariant most at risk of silent regression: a synthetic panel that
	// also happens to be stale must still read as synthetic, not stale --
	// syntheticity is the stronger disclosure and must never be demoted to
	// an ordinary staleness warning.
	it('keeps a synthetic panel distinguishable from a merely stale one, even when both are old', () => {
		const stalePanel = {
			asOf: '2026-08-20T10:00:00Z',
			firstDate: '2016-01-04',
			tickerCount: 6268,
			rowCount: 12_000_000,
			source: 'object-store',
			isStale: true
		};
		const staleSyntheticPanel = { ...stalePanel, source: 'mock' };

		const staleFreshness = formatFreshness(stalePanel, NOW);
		const syntheticFreshness = formatFreshness(staleSyntheticPanel, NOW);

		expect(staleFreshness.state).toBe('stale');
		expect(syntheticFreshness.state).toBe('synthetic');
		expect(syntheticFreshness.state).not.toBe(staleFreshness.state);
	});

	it('reports fresh for a recent, non-stale real panel', () => {
		const status = {
			asOf: '2026-09-02T11:55:00Z',
			firstDate: '2016-01-04',
			tickerCount: 6268,
			rowCount: 12_000_000,
			source: 'object-store'
		};

		expect(formatFreshness(status, NOW)).toEqual({ state: 'fresh', label: 'updated 5m ago' });
	});
});
