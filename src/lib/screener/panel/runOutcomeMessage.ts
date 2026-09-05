// Pure discrimination of runScreenerByHuman's RunScreenerByHumanResult into
// the one-line message FilterBuilderPanel.svelte shows for a non-successful
// human-triggered run (post-review fix, EPIC-0020: the return value used to
// be discarded entirely, leaving a refused/errored run with zero
// explanation to the person who clicked Run). No Svelte, no I/O -- so the
// three non-happy branches are unit-testable without mounting the panel.
import type { RunScreenerByHumanResult } from '../../panels/shell/panelController';

// Returns null when the run completed successfully (nothing to show --
// FilterBuilderPanel.svelte clears any prior message in that case), or a
// short human-readable explanation for every other outcome.
export function runOutcomeMessage(result: RunScreenerByHumanResult): string | null {
	if (result.status === 'error') {
		return result.message;
	}
	// Not normally reachable -- the Run button stays disabled whenever
	// `disabledReason` covers this case -- but handled gracefully rather
	// than assumed impossible, since disabledReason and this result can
	// only be checked against each other, never proven in sync statically.
	if (result.status === 'no_screener') {
		return 'No screener is currently defined.';
	}
	if (result.outcome.status === 'refused') {
		const problems = result.outcome.problems.map((problem) => problem.message).join('; ');
		return problems ? `Run refused: ${problems}` : 'Run refused.';
	}
	return null;
}
