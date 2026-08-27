import { describe, it } from 'vitest';

// These tests target the real fetch-based ResearchEngine implementation
// (built in this ticket) wired to the live FastAPI backend from T-1001-2/
// T-1001-3/T-1001-4 — not the placeholder fake in tools.test.ts. They
// re-verify tools.test.ts's availability/error-handling guarantees still
// hold against the real thing, per AC2/AC5, and add the end-to-end session
// scenario that only becomes possible once the real engine exists.

describe('real engine tool availability', () => {
	it('unlocks analysis tools once a real findInstances call produces a result set', () => {
		throw new Error('not implemented');
	});
});

describe('real engine expression validation', () => {
	it('returns the shared function catalog when defineStudy rejects an unsupported expression', () => {
		throw new Error('not implemented');
	});
});

describe('end-to-end research session', () => {
	it('completes define study, define setup, find instances, sample, measure, and grid entirely via tool calls', () => {
		throw new Error('not implemented');
	});
});
