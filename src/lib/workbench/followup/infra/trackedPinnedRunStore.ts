// A thin observability decorator over the real PinnedRunStore (T-1009-9),
// added by T-1014-11 so the composition root can answer "has any run ever
// been pinned in this session" for AC2's availability gate.
// `screener/ports.ts`'s PinnedRunStore deliberately has no enumeration
// method (its own comment: that structural absence is EPIC-1010's "no
// silent rerun" guarantee), so this wraps rather than extends the port --
// every real read/write still goes straight through to `base` unchanged,
// this file only ever adds a boolean flip on `putRun`.
import type { PinnedRunStore } from '../../../screener/ports';

export interface TrackedPinnedRunStore extends PinnedRunStore {
	// True once any run has ever been pinned in this store, for the life of
	// the process -- never reset by an eviction, matching "was a screener
	// ever run this session" rather than "is a run currently retained".
	hasAnyRun(): boolean;
}

export function createTrackedPinnedRunStore(base: PinnedRunStore): TrackedPinnedRunStore {
	let sawRun = false;
	return {
		putRun(run) {
			sawRun = true;
			base.putRun(run);
		},
		getRun(runId) {
			return base.getRun(runId);
		},
		getMatches(runId, offset, limit) {
			return base.getMatches(runId, offset, limit);
		},
		hasAnyRun() {
			return sawRun;
		}
	};
}
