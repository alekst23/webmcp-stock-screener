// AC6: an adversarial test enumerating the FULL registered follow-up
// surface confirms no sequence of tool calls transitions an alert to
// 'armed' without a human confirmation. This is the epic's central safety
// property (alerts/tools/alertActivationSafety.test.ts already proves it
// for the five-tool alert surface in isolation); this file extends that
// proof to the whole ~14-tool surface T-1014-11 registers together,
// including cross-tool interleaving and the global (not per-resource)
// undo/redo history no single tool group's own test can see.
import { describe, expect, it } from 'vitest';
import type { ToolSpec } from '../../../webmcp/types';
import { readAlert } from '../../alerts/domain/alert';
import { buildAllFollowupTools, type FollowupSurfaceRuntime } from './registerAllFollowupTools';
import { jsonOf } from './testFixtures';
import { RANGE_CONDITION, buildRuntime } from './followupMutatingFixtures';

// Every production source file under a tool group this ticket registers.
// Deliberately excludes *.test.ts and this ticket's own test-support
// modules (testFixtures.ts / followupMutatingFixtures.ts), which
// legitimately import confirmAlertActivation to *seed* an armed alert for
// a test -- that is not wiring it to a ToolSpec, which is what this check
// actually forbids.
const TOOL_SOURCES = {
	...import.meta.glob('/src/lib/workbench/followup/tools/*.ts', {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	...import.meta.glob('/src/lib/workbench/screener/tools/*.ts', {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	...import.meta.glob('/src/lib/workbench/similarity/refinement/tools/*.ts', {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	...import.meta.glob('/src/lib/workbench/backtest/tools/*.ts', {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	...import.meta.glob('/src/lib/workbench/watchlist/tools/*.ts', {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	...import.meta.glob('/src/lib/workbench/alerts/tools/*.ts', {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	...import.meta.glob('/src/lib/workbench/export/tools/*.ts', {
		query: '?raw',
		import: 'default',
		eager: true
	})
} as Record<string, string>;

const FORBIDDEN_IMPORTS = [
	"from '../application/confirmAlertActivation'",
	"from '../application/declineAlertActivation'",
	"from '../../alerts/application/confirmAlertActivation'",
	"from '../../alerts/application/declineAlertActivation'"
];

function alertState(runtime: FollowupSurfaceRuntime, alertId: string): string | undefined {
	return readAlert(runtime.repository.get(runtime.workspaceId)!, alertId)?.state;
}

async function seedDraftAlert(byName: Map<string, ToolSpec>): Promise<string> {
	const result = jsonOf(
		await byName
			.get('create_alert_draft')!
			.execute({ name: 'Alert', conditions: [RANGE_CONDITION] })
	);
	return (result.alert as { alert_id: string }).alert_id;
}

describe('AC6: no sequence of tool calls arms an alert, across the full registered surface', () => {
	it('the registered surface contains no arm_/confirm_/decline_-named tool', () => {
		const runtime = buildRuntime();
		const names = buildAllFollowupTools(runtime).map((t) => t.name);
		for (const name of names) {
			expect(name).not.toMatch(/^arm_|^confirm_|^decline_|arm_alert/);
		}
	});

	it('no production source file under any registered tool group imports confirmAlertActivation/declineAlertActivation', () => {
		const files = Object.entries(TOOL_SOURCES).filter(([path]) => !path.endsWith('.test.ts'));
		expect(files.length).toBeGreaterThan(20); // guards against a glob pattern typo matching nothing
		for (const [path, source] of files) {
			for (const forbidden of FORBIDDEN_IMPORTS) {
				expect(source, `${path} must not import a human-only activation function`).not.toContain(
					forbidden
				);
			}
		}
	});

	it('enable_alert alone, through the full surface, only ever reaches pending_activation', async () => {
		const runtime = buildRuntime();
		const byName = new Map(buildAllFollowupTools(runtime).map((t) => [t.name, t]));
		const alertId = await seedDraftAlert(byName);
		await byName.get('enable_alert')!.execute({ alert_id: alertId });
		expect(alertState(runtime, alertId)).toBe('pending_activation');
	});

	it('an unrelated mutation between enable_alert and its own undo supersedes the token, cross-tool -- never arms', async () => {
		const runtime = buildRuntime();
		const byName = new Map(buildAllFollowupTools(runtime).map((t) => [t.name, t]));
		const alertId = await seedDraftAlert(byName);

		const enabled = jsonOf(await byName.get('enable_alert')!.execute({ alert_id: alertId }));
		expect(alertState(runtime, alertId)).toBe('pending_activation');

		// A completely unrelated tool, from a different group entirely, commits
		// a change in between -- proving the supersession rule
		// alertActivationSafety.test.ts observed within the alerts module alone
		// also holds across tool-group boundaries.
		await byName.get('create_computed_field')!.execute({
			name: 'Unrelated field',
			expression: { kind: 'field_ref', fieldId: 'field.price.close' }
		});

		const { undoChange } = await import('../../application/changeHistory');
		expect(() =>
			undoChange(enabled.undo_token as string, {
				history: runtime.history,
				revisionService: runtime.revisions,
				clock: runtime.clock,
				context: { actor: 'agent' }
			})
		).toThrow();
		expect(alertState(runtime, alertId)).not.toBe('armed');
		expect(alertState(runtime, alertId)).toBe('pending_activation');
	});

	it('once armed via the human-only path then disabled, no further call on the full surface regains armed', async () => {
		const runtime = buildRuntime();
		const byName = new Map(buildAllFollowupTools(runtime).map((t) => [t.name, t]));
		const alertId = await seedDraftAlert(byName);
		await byName.get('enable_alert')!.execute({ alert_id: alertId });

		// The only legitimate way 'armed' is ever reached in this program: a
		// human confirming, never a ToolSpec. Seeding it here is what makes the
		// rest of this test a proof about *disable_alert and everything after
		// it*, not a claim that armed is unreachable at all.
		const { confirmAlertActivation } =
			await import('../../alerts/application/confirmAlertActivation');
		const armed = confirmAlertActivation(
			{ repository: runtime.repository, revisions: runtime.revisions, clock: runtime.clock },
			runtime.workspaceId,
			alertId
		);
		expect(armed.ok).toBe(true);
		expect(alertState(runtime, alertId)).toBe('armed');

		await byName.get('disable_alert')!.execute({ alert_id: alertId });
		expect(alertState(runtime, alertId)).toBe('disarmed');

		// Sweep the rest of the surface -- alert tools and a couple of
		// unrelated tools -- and confirm none of it ever regains armed.
		const attempts: Array<[string, Record<string, unknown>]> = [
			['enable_alert', { alert_id: alertId }],
			['edit_alert_draft', { alert_id: alertId, name: 'x' }],
			['disable_alert', { alert_id: alertId }],
			[
				'create_computed_field',
				{ name: 'x2', expression: { kind: 'field_ref', fieldId: 'field.price.close' } }
			],
			['upsert_watchlist', { kind: 'static', name: 'wl', instrument_ids: [] }]
		];
		for (const [name, input] of attempts) {
			await byName.get(name)!.execute(input);
			expect(alertState(runtime, alertId), `${name} must never regain armed`).not.toBe('armed');
		}
	});

	// The "any order, any arguments" half of AC6, extended past the alerts
	// module's own tools: a mixed pool including one tool from a different
	// group, every ordering, repeated (idempotent-without-key replay path).
	it('no ordering of a mixed alert/non-alert tool pool, repeated, ever produces armed', async () => {
		function permutations<T>(items: T[]): T[][] {
			if (items.length <= 1) return [items];
			const out: T[][] = [];
			for (let i = 0; i < items.length; i++) {
				const rest = [...items.slice(0, i), ...items.slice(i + 1)];
				for (const p of permutations(rest)) out.push([items[i]!, ...p]);
			}
			return out;
		}

		const pool = ['enable_alert', 'disable_alert', 'edit_alert_draft', 'create_computed_field'];
		for (const order of permutations(pool)) {
			const runtime = buildRuntime();
			const byName = new Map(buildAllFollowupTools(runtime).map((t) => [t.name, t]));
			const alertId = await seedDraftAlert(byName);
			for (const name of [...order, ...order]) {
				const input =
					name === 'edit_alert_draft'
						? { alert_id: alertId, name: 'renamed' }
						: name === 'create_computed_field'
							? { name: 'x', expression: { kind: 'field_ref', fieldId: 'field.price.close' } }
							: { alert_id: alertId };
				await byName.get(name)!.execute(input);
				expect(alertState(runtime, alertId)).not.toBe('armed');
			}
		}
	});
});
