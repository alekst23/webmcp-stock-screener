// A fixture-backed AlertHistoricalDataPort (T-1014-8). Mirrors
// chart/infra/inMemoryChartSeries.ts's convention: `createInMemoryAlertHistoricalData({})`
// with no fixture is a real, honest implementation of the port -- it reports
// zero firings over zero resolved instruments with a warning explaining that
// no historical data source is configured, rather than fabricating data. It is
// the safe default this ticket wires by default (registerAlertTools.ts); a
// real historical evaluation pipeline is a separate, later workstream.
//
// With an injected fixture, it also serves as the test double the preview
// use case's tests exercise the noisy / never-fires / mixed scenarios
// against -- a fake with real (if simplified) behaviour, per the project's
// "test fake with real behaviour" rule for a Protocol implementation.
import type { UniverseSpec } from '../../../screener/definition';
import type {
	AlertHistoricalDataPort,
	AlertHistoricalEvaluation,
	AlertPreviewWindow
} from '../domain/alertPreview';

// Monday-Friday between start and end, inclusive. A deliberate approximation
// -- no exchange holiday calendar is consulted -- documented as such rather
// than passed off as exact; a preview is a cheap read, not the backtest
// engine's calendar-aware evaluation.
export function countWeekdays(window: AlertPreviewWindow): number {
	const start = new Date(`${window.start}T00:00:00Z`);
	const end = new Date(`${window.end}T00:00:00Z`);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
		return 0;
	}
	let count = 0;
	for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
		const day = d.getUTCDay();
		if (day !== 0 && day !== 6) {
			count += 1;
		}
	}
	return count;
}

function everyWeekday(window: AlertPreviewWindow): string[] {
	const days: string[] = [];
	const start = new Date(`${window.start}T00:00:00Z`);
	const end = new Date(`${window.end}T00:00:00Z`);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
		return days;
	}
	for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
		const day = d.getUTCDay();
		if (day !== 0 && day !== 6) {
			days.push(d.toISOString().slice(0, 10));
		}
	}
	return days;
}

const NO_SOURCE_WARNING = 'No historical market-data source is configured for alert preview.';

export interface InMemoryAlertHistoricalDataFixture {
	// The full resolvable universe for this fixture, regardless of criteria --
	// a fake, not a real universe resolver.
	instrumentIds: string[];
	// Decides, per instrument and evaluated day, whether the condition held.
	// Absent means "never fires" (a valid, non-error scenario per AC7).
	fires?(instrumentId: string, date: string): boolean;
}

export function createInMemoryAlertHistoricalData(
	fixture?: InMemoryAlertHistoricalDataFixture
): AlertHistoricalDataPort {
	return {
		async resolveUniverse(_universe: UniverseSpec): Promise<string[]> {
			return fixture ? [...fixture.instrumentIds] : [];
		},
		async evaluate(input): Promise<AlertHistoricalEvaluation> {
			const evaluatedDays = countWeekdays(input.window);
			if (!fixture) {
				return { firings: [], evaluatedDays, warnings: [NO_SOURCE_WARNING] };
			}
			const days = everyWeekday(input.window);
			const firings: AlertHistoricalEvaluation['firings'] = [];
			for (const instrumentId of input.instrumentIds) {
				for (const date of days) {
					if (fixture.fires?.(instrumentId, date)) {
						firings.push({ instrumentId, firedAt: date });
					}
				}
			}
			return { firings, evaluatedDays, warnings: [] };
		}
	};
}
