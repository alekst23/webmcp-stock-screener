// T-0001-9 AC4: how current the loaded price panel is.
//
// A dedicated GET rather than a field on getWorkspace: getWorkspace runs
// purely client-side and never touches the network (docs/plan.md's
// "Sessions" section), so it has nothing to say about server-side data.
// backend/api/routes/research.py serves this.
import type { ApiClientConfig } from '../webmcp/types';

// backend/domain/models/panel.py's PanelStatus (snake_case on the wire,
// matching the Pydantic model directly -- same convention as apiEngine.ts's
// Backend* shapes).
export interface BackendPanelStatus {
	as_of: string;
	first_date: string;
	ticker_count: number;
	row_count: number;
	source: string;
}

export interface PanelStatus {
	asOf: string;
	firstDate: string;
	tickerCount: number;
	rowCount: number;
	source: string;
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
		source: body.source
	};
}

// Names the mock panel explicitly. A synthetic dataset presented in the same
// words as real market data is exactly the misreading AC4 exists to prevent.
export function formatPanelStatus(status: PanelStatus): string {
	const universe = `${status.tickerCount.toLocaleString()} tickers`;
	const span = `${status.firstDate} to ${status.asOf}`;
	return status.source === 'mock'
		? `Synthetic demo data — ${universe}, ${span}. Not real market data.`
		: `Price data as of ${status.asOf} — ${universe}, ${span}.`;
}

export function isMockPanel(status: PanelStatus): boolean {
	return status.source === 'mock';
}
