// In-memory PinnedRunStore (T-1009-9): the store half of the pinned-run
// contract ports.ts declares. putRun is the only way a run enters the
// store -- there is deliberately no execute/refresh member anywhere in this
// file, which is the structural half of EPIC-1010's "no silent rerun"
// guarantee (ports.ts's own comment on PinnedRunStore).
//
// Domain-adjacent infra: implements ports.ts's PinnedRunStore. Must not
// import from src/lib/webmcp/ (layering rule for this file).

import type { ResourceId } from '../workbench/domain/ids';
import {
	keepMostRecentRun,
	type PinnedRunStore,
	type RunNotAvailable,
	type RunRetentionPolicy
} from './ports';
import type { ScreenerMatch, ScreenerRun } from './run';

export interface PinnedRunStoreOptions {
	// Decides whether a stored run may be reclaimed. Defaults to ports.ts's
	// keepMostRecentRun (T-0026-6): only one panel is ever bound to a run in
	// this surface, so keeping anything behind the most recently pinned run
	// serves nothing and just accumulates for the life of the session.
	// Eviction is an explicit, observable error (AC5/AC11), not a silent
	// drop. A constructor parameter, not a hard-coded rule, so a caller that
	// legitimately wants different retention (e.g. keepAllRuns) can still
	// opt in without a PinnedRunStore change.
	policy?: RunRetentionPolicy;
	// Injectable for deterministic eviction-order tests; defaults to the
	// wall clock, matching engine.ts's `now` convention.
	now?: () => Date;
}

function notAvailable(runId: ResourceId, reason: RunNotAvailable['reason']): RunNotAvailable {
	return {
		available: false,
		runId,
		reason,
		message:
			reason === 'evicted'
				? `Run ${runId} is no longer available: it was evicted under the store's retention policy.`
				: `Run ${runId} is no longer available: no run with that id was ever stored here.`
	};
}

function isRunNotAvailable(value: ScreenerRun | RunNotAvailable): value is RunNotAvailable {
	return 'available' in value;
}

export function createPinnedRunStore(options: PinnedRunStoreOptions = {}): PinnedRunStore {
	const policy = options.policy ?? keepMostRecentRun;
	const now = options.now ?? (() => new Date());
	// Map insertion order doubles as retention order (oldest first); reversed
	// below to give the most-recently-stored run index 0, matching
	// RunRetentionPolicy's documented `index` convention.
	const runs = new Map<ResourceId, ScreenerRun>();
	// Remembers ids this store itself reclaimed, so a later read can still
	// tell "evicted" apart from "never minted" (AC5/AC11) even though the
	// run object itself is gone.
	const evictedIds = new Set<ResourceId>();

	function sweep(): void {
		const nowIso = now().toISOString();
		const mostRecentFirst = [...runs.keys()].reverse();
		mostRecentFirst.forEach((runId, index) => {
			const run = runs.get(runId);
			if (run && policy.shouldEvict(run, nowIso, index)) {
				runs.delete(runId);
				evictedIds.add(runId);
			}
		});
	}

	function getRun(runId: ResourceId): ScreenerRun | RunNotAvailable {
		sweep();
		const run = runs.get(runId);
		if (run) {
			return run;
		}
		return notAvailable(runId, evictedIds.has(runId) ? 'evicted' : 'unknown');
	}

	return {
		putRun(run: ScreenerRun): void {
			// A run under this id is no longer "evicted" once a fresh one is
			// stored -- ids are never reused by ids.ts's IdSequencer, so this
			// only matters for a test double calling putRun() twice.
			evictedIds.delete(run.runId);
			runs.set(run.runId, run);
		},
		getRun,
		getMatches(
			runId: ResourceId,
			offset: number,
			limit: number
		): ScreenerMatch[] | RunNotAvailable {
			const result = getRun(runId);
			if (isRunNotAvailable(result)) {
				return result;
			}
			const start = Math.max(0, offset);
			return result.matches.slice(start, start + Math.max(0, limit));
		}
	};
}
