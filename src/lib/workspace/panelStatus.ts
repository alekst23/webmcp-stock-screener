// T-0001-9 AC4: how current the loaded price panel is.
//
// A dedicated GET rather than a field on getWorkspace: getWorkspace runs
// purely client-side and never touches the network (docs/plan.md's
// "Sessions" section), so it has nothing to say about server-side data.
// backend/api/routes/panel.py serves this (bug fix, see git history:
// T-1015-4 deleted the original backend/api/routes/research.py's
// GET /api/research/panel without noticing this live new-surface caller;
// panel.py is the new-surface replacement).

// T-1015-5: used to be shared with apiEngine.ts's networked tool calls via
// webmcp/types.ts's ApiClientConfig, which also carried an
// instanceSetStorage hook that module never used. Now that apiEngine.ts is
// gone, this is the only remaining consumer -- defined locally, narrowed to
// the one field this module reads.
export interface ApiClientConfig {
	baseUrl: string;
}

// backend/domain/models/panel.py's PanelStatus (snake_case on the wire,
// matching the Pydantic model directly -- same convention as apiEngine.ts's
// Backend* shapes).
export interface BackendPanelStatus {
	as_of: string;
	first_date: string;
	ticker_count: number;
	row_count: number;
	source: string;
	// T-0013-5. Optional because a deployed backend from before that ticket
	// answers without them, and a missing notice must read as "nothing to
	// disclose" rather than breaking the status line entirely.
	notices?: string[];
	is_stale?: boolean;
}

export interface PanelStatus {
	asOf: string;
	firstDate: string;
	tickerCount: number;
	rowCount: number;
	source: string;
	notices?: string[];
	isStale?: boolean;
}

export async function fetchPanelStatus(config: ApiClientConfig): Promise<PanelStatus> {
	const response = await fetch(`${config.baseUrl}/api/research/panel`);
	if (!response.ok) {
		throw new Error(`research backend returned ${response.status}: ${response.statusText}`);
	}
	const body = (await response.json()) as BackendPanelStatus;
	return {
		asOf: body.as_of,
		firstDate: body.first_date,
		tickerCount: body.ticker_count,
		rowCount: body.row_count,
		source: body.source,
		notices: body.notices,
		isStale: body.is_stale
	};
}

// Names the mock panel explicitly. A synthetic dataset presented in the same
// words as real market data is exactly the misreading AC4 exists to prevent.
export function formatPanelStatus(status: PanelStatus): string {
	const universe = `${status.tickerCount.toLocaleString()} tickers`;
	const span = `${status.firstDate} to ${status.asOf}`;
	const base =
		status.source === 'mock'
			? `Synthetic demo data — ${universe}, ${span}. Not real market data.`
			: `Price data as of ${status.asOf} — ${universe}, ${span}.`;
	// The backend's own synthetic notice is dropped: this line already says
	// it, in the words this surface has always used, and saying it twice
	// reads as a bug rather than as emphasis.
	const disclosures = (status.notices ?? []).filter((notice) => !notice.startsWith('Synthetic'));
	return disclosures.length ? `${base} ${disclosures.join(' ')}` : base;
}

export function isMockPanel(status: PanelStatus): boolean {
	return status.source === 'mock';
}

// hotfix/marketpane-rebrand: the header now shows a freshness pill instead
// of a permanent synthetic-data banner. `synthetic` stays a distinct state
// from `stale` -- collapsing them would let the one disclosure the spec
// calls "critical to preserve" (mock data must never read like real data)
// drown in an ordinary staleness warning.
export type FreshnessState = 'unknown' | 'synthetic' | 'stale' | 'fresh';

export interface Freshness {
	state: FreshnessState;
	label: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Coarse buckets rather than exact durations -- a researcher scanning the
// header wants "is this fresh enough to trust", not a stopwatch.
function formatElapsed(elapsedMs: number): string {
	const clamped = Math.max(elapsedMs, 0);
	if (clamped < MINUTE_MS) {
		return 'just now';
	}
	if (clamped < HOUR_MS) {
		return `${Math.floor(clamped / MINUTE_MS)}m ago`;
	}
	if (clamped < DAY_MS) {
		return `${Math.floor(clamped / HOUR_MS)}h ago`;
	}
	return `${Math.floor(clamped / DAY_MS)}d ago`;
}

// Replaces the permanent synthetic-data warning banner (T-0001-9 AC4) now
// that the app serves real market data by default. `status === null` covers
// both "still fetching" and "backend has no panel" -- either way, claiming
// an age would be worse than admitting the pill doesn't know one yet.
export function formatFreshness(status: PanelStatus | null, now: Date = new Date()): Freshness {
	if (!status) {
		return { state: 'unknown', label: 'checking…' };
	}
	// A mock panel is disclosed by name rather than dated: an age next to
	// "synthetic" would still tempt a glance-read as if it were a real,
	// merely-old, data pull.
	if (isMockPanel(status)) {
		return { state: 'synthetic', label: 'Synthetic data' };
	}
	const elapsedMs = now.getTime() - new Date(status.asOf).getTime();
	const label = `updated ${formatElapsed(elapsedMs)}`;
	return { state: status.isStale ? 'stale' : 'fresh', label };
}
