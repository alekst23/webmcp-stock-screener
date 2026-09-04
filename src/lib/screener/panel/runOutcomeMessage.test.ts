// T-0020-15 (post-review fix): runOutcomeMessage is the pure logic behind
// FilterBuilderPanel.svelte's inline failure banner -- covered directly here
// so every branch (ok/complete, ok/refused, error, no_screener) is proven
// without mounting the component. FilterBuilderPanel.test.ts separately
// proves the message actually renders from a real handleRun()-shaped click.
import { describe, expect, it } from 'vitest';
import { runOutcomeMessage } from './runOutcomeMessage';
import { makeScreenerRun, type ScreenerRunOutcome } from '../run';
import { makeProvenance } from '../../workbench/domain/provenance';
import { emptyFilterTree } from '../definition';
import { PROBLEM_CODES } from '../validation';

function completeOutcome(): ScreenerRunOutcome {
	return makeScreenerRun({
		runId: 'run_1',
		screenerId: 'screener_1',
		screenerRevision: 1,
		status: 'complete',
		universeCount: 1,
		matchedCount: 0,
		returnedCount: 0,
		truncated: false,
		rankingApplied: false,
		normalization: null,
		warnings: [],
		provenance: makeProvenance({
			asOf: '2026-09-04T14:30:00.000Z',
			sourceId: 'src.fixture',
			sourceLabel: 'Fixture',
			liveness: 'end_of_day',
			timezone: 'America/New_York'
		}),
		matches: [],
		rejectedEvaluations: {},
		filterTree: emptyFilterTree('filter_root'),
		rankingSpec: null,
		createdAt: '2026-09-04T14:30:05.000Z'
	});
}

describe('runOutcomeMessage', () => {
	it('returns null for a completed run -- nothing to show', () => {
		const result = { status: 'ok' as const, outcome: completeOutcome() };
		expect(runOutcomeMessage(result), 'a successful run has nothing to explain').toBeNull();
	});

	it('surfaces the refusal problems for a refused run', () => {
		const result = {
			status: 'ok' as const,
			outcome: {
				status: 'refused' as const,
				screenerId: 'screener_1',
				screenerRevision: 1,
				problems: [
					{
						severity: 'blocking' as const,
						code: PROBLEM_CODES.invalidParameter,
						nodeIds: [],
						universeCriteria: [],
						message: 'Fixture blocking problem.'
					}
				]
			}
		};
		const message = runOutcomeMessage(result);
		expect(message, 'a refused run must explain why').not.toBeNull();
		expect(message).toContain('Fixture blocking problem.');
	});

	it('surfaces the error message for an evaluation-port error', () => {
		const result = { status: 'error' as const, message: 'Market data unavailable.' };
		expect(runOutcomeMessage(result)).toBe('Market data unavailable.');
	});

	it('surfaces a message for the defense-in-depth no_screener case', () => {
		const result = { status: 'no_screener' as const };
		expect(runOutcomeMessage(result), 'no_screener must not render as silence').not.toBeNull();
	});
});
