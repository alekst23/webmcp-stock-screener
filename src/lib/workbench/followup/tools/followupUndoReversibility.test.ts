// AC5: every mutation this epic creates is reversible through undo_change
// with its own returned undo token. Driven off the same per-tool fixture
// table AC4 uses (followupMutatingFixtures.ts), so a tool added later that
// forgets to wire a real inverse fails here automatically.
//
// backtest_screener and disable_alert are the two documented exceptions
// (their own source sets undo_token to null on purpose -- see
// backtestScreener.ts's header comment and disableAlert.ts's SAFETY note).
// This suite asserts that exception set is *exactly* those two, not
// whatever happens to be null today.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { undoChange } from '../../application/changeHistory';
import { buildAllFollowupTools, type FollowupSurfaceRuntime } from './registerAllFollowupTools';
import { jsonOf } from './testFixtures';
import { FIXTURES, NEVER_UNDOABLE_TOOLS, buildRuntime } from './followupMutatingFixtures';

describe('AC5: every mutation is reversible through undo_change', () => {
	let runtime: FollowupSurfaceRuntime;
	let byName: Map<string, ToolSpec>;

	beforeEach(() => {
		runtime = buildRuntime();
		byName = new Map(buildAllFollowupTools(runtime).map((t) => [t.name, t]));
	});

	for (const fixture of FIXTURES) {
		if (NEVER_UNDOABLE_TOOLS.has(fixture.name)) {
			it(`${fixture.name}: documented as never undoable (undo_token is always null)`, async () => {
				const input = await fixture.prepare(runtime, byName);
				const result = await byName.get(fixture.name)!.execute(input);
				expect(result.isError, JSON.stringify(jsonOf(result))).toBeUndefined();
				expect(jsonOf(result).undo_token).toBeNull();
			});
			continue;
		}

		it(`${fixture.name}: undo_change restores the pre-call state`, async () => {
			const input = await fixture.prepare(runtime, byName);
			// A fixture may itself mutate the workspace while seeding prerequisites
			// (e.g. save_results_to_watchlist creates the target watchlist first);
			// the reversibility claim under test is about *this* tool's own
			// change, so the baseline is taken right before the call under test,
			// not before its fixture's own setup.
			const baseline = runtime.repository.get(runtime.workspaceId)!;
			const baselineSnapshot = JSON.stringify(baseline);

			const result = await byName.get(fixture.name)!.execute(input);
			expect(result.isError, JSON.stringify(jsonOf(result))).toBeUndefined();
			const payload = jsonOf(result);
			const undoToken = payload.undo_token as string | null;
			expect(undoToken, `${fixture.name} must return a non-null undo_token`).not.toBeNull();

			const afterCall = runtime.repository.get(runtime.workspaceId)!;
			expect(JSON.stringify(afterCall)).not.toBe(baselineSnapshot);

			const undone = undoChange(undoToken!, {
				history: runtime.history,
				revisionService: runtime.revisions,
				clock: runtime.clock,
				context: { actor: 'agent' }
			});
			expect(undone.undoToken, 'undoing a mutation is itself undoable (redo)').not.toBeNull();

			const restored = runtime.repository.get(runtime.workspaceId)!;
			// Revision always advances forward (undo is a new, higher revision
			// whose content matches the prior state) -- so content, not the
			// revision number itself, is what "restored" means here.
			const { revision: _r1, ...restoredContent } = restored;
			const { revision: _r2, ...baselineContent } = baseline;
			expect(restoredContent).toEqual(baselineContent);
			expect(restored.revision).toBeGreaterThan(afterCall.revision);
		});
	}

	it('the never-undoable exception set is exactly {backtest_screener, disable_alert}', () => {
		expect([...NEVER_UNDOABLE_TOOLS].sort()).toEqual(['backtest_screener', 'disable_alert']);
	});
});
