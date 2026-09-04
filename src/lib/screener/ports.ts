// The domain-side ports execution-consuming code is written against
// (T-1009-2), so the evaluation engine (T-1009-7), the validation tool
// (T-1009-8), and the pinned-run store (T-1009-9) share one contract
// instead of each inventing its own. Types only: no I/O, and nothing here
// may import an infra adapter -- dependency direction runs infra -> domain,
// mirroring src/lib/discovery/ports.ts's InstrumentDirectory.

import type { ResourceId } from '../workbench/domain/ids';
import type { MarketDataProvenance } from '../workbench/domain/provenance';
import type { ScreenerDefinition } from './definition';
import type { ScreenerMatch, ScreenerRun, ScreenerRunOutcome } from './run';
import type { ScreenerValidationReport } from './validation';

// validate() and execute() are declared on one port, not two, because both
// need the same market-data access underneath (ScreenerMarketData below) --
// T-1009-7 is expected to implement both off a single adapter, and
// validate-then-execute should never risk disagreeing about what data was
// available.
export interface ScreenerEvaluationPort {
	validate(definition: ScreenerDefinition): Promise<ScreenerValidationReport>;
	execute(input: {
		definition: ScreenerDefinition;
		runId: ResourceId;
	}): Promise<ScreenerRunOutcome>;
}

// One series data point: a bar timestamp paired with its value. Kept to
// exactly this so ScreenerMarketData stays a values-in, values-out port --
// OHLC, bar metadata, or anything richer is a caller-side concern, not
// this port's.
export interface SeriesPoint {
	// ISO-8601 instant the bar closes.
	timestamp: string;
	value: number;
}

// The narrow read surface a filter/ranking evaluation needs, kept small and
// honest rather than a general query engine: resolving a universe, reading
// one field, reading one series, checking a pattern, and reading one study
// output are the five things a Condition variant or a RankingField can ask
// for (see conditions.ts). Do not grow this into anything that accepts a
// caller-supplied query -- that reopens the "no raw SQL or JavaScript"
// property conditions.ts's typed model exists to guarantee.
//
// T-1009-7 ships the real adapter and an honest-unavailability default
// mirroring src/lib/discovery/unavailableDirectory.ts: reporting "this
// source isn't wired up" rather than inventing data. No such adapter or
// dataset belongs in this file.
export interface ScreenerMarketData {
	resolveUniverse(universe: ScreenerDefinition['universe']): Promise<string[]>;
	getFieldValue(instrumentId: string, fieldId: string): Promise<number | string | boolean | null>;
	getSeries(
		instrumentId: string,
		catalogId: string,
		params: Record<string, unknown>
	): Promise<SeriesPoint[]>;
	detectPattern(
		instrumentId: string,
		patternId: string,
		intervalId: string
	): Promise<{ confidence: number } | null>;
	getStudyOutput(
		instrumentId: string,
		studyId: string,
		params: Record<string, unknown>,
		outputName: string
	): Promise<number | string | boolean | null>;
	// The single provenance covering every read this port served during one
	// evaluation. A run stamps this straight onto ScreenerRun.provenance --
	// one run reads one as-of snapshot, so there is exactly one provenance
	// record to produce, not one per field.
	getProvenance(): Promise<MarketDataProvenance>;
}

// Distinguishes "this run is gone" from "this run matched nothing" -- an
// empty ScreenerRun.matches array is a normal, valid outcome (spec.md "Zero
// matches"), so PinnedRunStore reads must not collapse the two into the
// same falsy shape. `reason` says which: 'unknown' for a run_id that was
// never minted by this store, 'evicted' for one that existed and was later
// reclaimed under a RunRetentionPolicy.
export interface RunNotAvailable {
	available: false;
	runId: ResourceId;
	reason: 'unknown' | 'evicted';
	message: string;
}

// Decides whether a stored run may be reclaimed. Pluggable rather than a
// hard-coded TTL so the cross-epic retention decision (spec.md Open
// Question 1, "to be confirmed with EPIC-1010") can change later without
// touching any PinnedRunStore call site. `index` is the run's position in
// retention order (0 = most recently stored), letting a count-based policy
// be expressed without the store exposing its internal structure.
export interface RunRetentionPolicy {
	shouldEvict(run: ScreenerRun, now: string, index: number): boolean;
}

// Retains every run for the life of the workspace session -- the working
// assumption from spec.md Open Question 1 before T-0026-6 settled the
// cross-epic retention decision (see keepMostRecentRun below, the actual
// default as of T-0026-6). Still available for a caller that legitimately
// wants every run kept (e.g. testSupport.ts's testPinnedRunStore, which
// seeds several runs a test then reads back), just not the default.
export const keepAllRuns: RunRetentionPolicy = {
	shouldEvict(): boolean {
		return false;
	}
};

// T-0026-6: the PinnedRunStore construction default. Only one panel is
// ever bound to a run in this surface (the results_table panel rebinds to
// whatever run_screener most recently produced), so every run behind the
// most recent one serves nothing and would otherwise accumulate for the
// life of the session. `index` 0 is the most-recently-stored run
// (RunRetentionPolicy's own documented convention); evicting every other
// index keeps exactly one.
export const keepMostRecentRun: RunRetentionPolicy = {
	shouldEvict(_run, _now, index): boolean {
		return index > 0;
	}
};

// The read/write boundary EPIC-1010 reads runs through (T-1009-9
// implements it). `putRun` is the only way a run enters the store -- it
// persists a run that was already computed by ScreenerEvaluationPort.execute,
// it does not compute one. Deliberately absent: any operation that executes
// or re-executes a screener. That structural absence -- not a runtime check
// -- is EPIC-1010's "no silent rerun" guarantee (spec.md "Retrievable
// without rerun"): code holding only a PinnedRunStore has no call it can
// make that produces fresh numbers under an old handle.
export interface PinnedRunStore {
	putRun(run: ScreenerRun): void;
	getRun(runId: ResourceId): ScreenerRun | RunNotAvailable;
	getMatches(runId: ResourceId, offset: number, limit: number): ScreenerMatch[] | RunNotAvailable;
}
