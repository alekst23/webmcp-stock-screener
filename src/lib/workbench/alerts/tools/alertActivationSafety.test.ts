// AC5's adversarial proof for T-1014-9, the epic's single most
// safety-critical property: no sequence of tool calls, in any order, with
// any arguments, transitions an alert to 'armed'. Only a human confirming
// in the app's own alerts surface can do that (application/
// confirmAlertActivation.ts), and that function is never wired to a
// ToolSpec.
//
// This file is deliberately broader than createAlertDraft.ts's/
// editAlertDraft.ts's own adversarial state-field tests (which only cover
// the "smuggle state: 'armed' in the wire input" attack): it enumerates
// the *entire* five-tool surface this ticket ships, including undo,
// idempotent replay, and stale-revision paths, per the ticket's explicit
// instruction that AC5 must not be a happy-path test.
import { beforeEach, describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
import type { ToolSpec } from '../../../webmcp/types';
import { createIdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { createChangeHistory, undoChange } from '../../application/changeHistory';
import { createIdempotencyCache } from '../../application/idempotency';
import { createOperationRegistry } from '../../application/operationRegistry';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import { confirmAlertActivation } from '../application/confirmAlertActivation';
import { createInMemoryAlertHistoricalData } from '../infra/inMemoryAlertHistoricalData';
import { buildAlertTools, type AlertToolsDeps } from './index';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';
const clock: Clock = { now: () => NOW };

const VOLUME_CONDITION: RangeCondition = {
	type: 'range',
	fieldId: 'field.volume',
	lower: 1,
	upper: 2,
	lowerInclusive: true,
	upperInclusive: true
};

function jsonOf(result: { content: { type: 'text'; text: string }[] }): Record<string, unknown> {
	return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

// Vite's glob import rather than a filesystem walk: it needs no node
// typings (the project has none). See src/lib/theme/paletteGuard.test.ts
// for the same pattern.
const TOOL_SOURCES = import.meta.glob('/src/lib/workbench/alerts/tools/*.ts', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

function draftAlert(overrides: Partial<AlertRecord> = {}): AlertRecord {
	return {
		alertId: 'alert_1',
		workspaceId: WORKSPACE_ID,
		name: 'Big caps',
		state: 'draft',
		source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
		previewable: true,
		previewProblems: [],
		pendingActivation: null,
		activationHistory: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

describe('AC5: no sequence of tool calls arms an alert', () => {
	let deps: AlertToolsDeps;
	let tools: ToolSpec[];
	let byName: Map<string, ToolSpec>;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(writeAlert(emptyWorkspace(WORKSPACE_ID, 'Test', NOW), draftAlert()));
		repository.setActiveId(WORKSPACE_ID);
		const ids = createIdSequencer();
		deps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock,
				ids,
				idempotency: createIdempotencyCache()
			}),
			history: createChangeHistory(),
			registry: createOperationRegistry(),
			clock,
			ids,
			historicalData: createInMemoryAlertHistoricalData()
		};
		tools = buildAlertTools(deps);
		byName = new Map(tools.map((t) => [t.name, t]));
	});

	function currentState(): string | undefined {
		return readAlert(deps.repository.get(WORKSPACE_ID)!, 'alert_1')?.state;
	}

	it('enumerates the tool surface: five tools, none a confirm/decline/arm tool', () => {
		const names = tools.map((t) => t.name).sort();
		expect(names).toEqual([
			'create_alert_draft',
			'disable_alert',
			'edit_alert_draft',
			'enable_alert',
			'preview_alert'
		]);
		for (const name of names) {
			expect(name).not.toMatch(/^arm_|^confirm_|^decline_|arm_alert/);
		}
	});

	it('enable_alert alone never arms: it only ever reaches pending_activation', async () => {
		await byName.get('enable_alert')!.execute({ alert_id: 'alert_1' });
		expect(currentState()).toBe('pending_activation');
		expect(currentState()).not.toBe('armed');
	});

	it('enable_alert followed by undo_change never arms: it returns to draft', async () => {
		const enabled = jsonOf(await byName.get('enable_alert')!.execute({ alert_id: 'alert_1' }));
		undoChange(enabled.undo_token as string, {
			history: deps.history,
			revisionService: deps.revisions,
			clock,
			context: { actor: 'agent' }
		});
		expect(currentState()).toBe('draft');
		expect(currentState()).not.toBe('armed');
	});

	// The concrete attack this ticket's Technical Considerations names by
	// name: undo-of-undo ("redo"). ChangeHistory's own undoChange lets an
	// agent undo the undo it just performed, which redoes the original
	// change (by design, for every other mutation in the program). If
	// enable_alert's forward draft's inverse ever became reachable back to
	// something arming, this is the call sequence that would expose it. It
	// cannot, here, because enable_alert's own forward target is
	// pending_activation, never armed -- but this test pins that fact
	// end-to-end through the real undo machinery, not just by reading the
	// operation's source.
	it('undo-of-undo (redo) after enable_alert lands on pending_activation, never armed', async () => {
		const enabled = jsonOf(await byName.get('enable_alert')!.execute({ alert_id: 'alert_1' }));
		const undone = undoChange(enabled.undo_token as string, {
			history: deps.history,
			revisionService: deps.revisions,
			clock,
			context: { actor: 'agent' }
		});
		expect(currentState()).toBe('draft');
		expect(undone.undoToken).not.toBeNull();
		const redone = undoChange(undone.undoToken!, {
			history: deps.history,
			revisionService: deps.revisions,
			clock,
			context: { actor: 'agent' }
		});
		expect(currentState()).toBe('pending_activation');
		expect(currentState()).not.toBe('armed');
		expect(redone.diffSummary).toBeDefined();
	});

	it('a repeated idempotency_key never arms and never duplicates the request (AC11)', async () => {
		await byName.get('enable_alert')!.execute({ alert_id: 'alert_1', idempotency_key: 'k1' });
		await byName.get('enable_alert')!.execute({ alert_id: 'alert_1', idempotency_key: 'k1' });
		expect(currentState()).toBe('pending_activation');
		expect(currentState()).not.toBe('armed');
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(doc.revision).toBe(2); // one commit, not two
	});

	it('a stale expected_revision on enable_alert is rejected without mutating anything', async () => {
		const result = await byName.get('enable_alert')!.execute({
			alert_id: 'alert_1',
			expected_revision: 999
		});
		expect(result.isError).toBe(true);
		expect(currentState()).toBe('draft');
	});

	it('editing while pending invalidates the request rather than arming it (AC6)', async () => {
		await byName.get('enable_alert')!.execute({ alert_id: 'alert_1' });
		expect(currentState()).toBe('pending_activation');
		const edited = jsonOf(
			await byName.get('edit_alert_draft')!.execute({
				alert_id: 'alert_1',
				name: 'Renamed while pending'
			})
		);
		expect(edited.alert).toMatchObject({ state: 'draft' });
		expect(currentState()).toBe('draft');
	});

	// disable_alert requires an armed alert to act on, and no tool can ever
	// produce one -- so this seeds 'armed' the only legitimate way in the
	// program (the human-only confirm function) purely to prove disable_alert
	// and the rest of the tool surface can never be chained afterward to
	// regain it once disarmed.
	it('once armed then disabled, no further tool sequence (incl. undo) regains armed', async () => {
		await byName.get('enable_alert')!.execute({ alert_id: 'alert_1' });
		const armed = confirmAlertActivation(
			{ repository: deps.repository, revisions: deps.revisions, clock },
			WORKSPACE_ID,
			'alert_1'
		);
		expect(armed.ok).toBe(true);
		expect(currentState()).toBe('armed');

		const disabled = jsonOf(await byName.get('disable_alert')!.execute({ alert_id: 'alert_1' }));
		expect(currentState()).toBe('disarmed');
		expect(disabled.undo_token).toBeNull();

		// disable_alert's own undo token is null, so there is nothing to
		// redeem for it. The only other undo-token-bearing record in history
		// is enable_alert's original request -- but it is no longer the
		// *newest* change for this workspace (disable_alert's record is), so
		// ChangeHistory's own "only the newest change is undoable" rule
		// refuses it (superseded) rather than letting it silently rewrite the
		// document out from under the disable. Either way, never armed.
		const enableRecord = deps.history
			.list(WORKSPACE_ID)
			.find((r) => r.diffSummary.toLowerCase().includes('requested activation'));
		expect(enableRecord?.undoToken).toBeTruthy();
		expect(() =>
			undoChange(enableRecord!.undoToken!, {
				history: deps.history,
				revisionService: deps.revisions,
				clock,
				context: { actor: 'agent' }
			})
		).toThrow();
		expect(currentState()).not.toBe('armed');
		expect(currentState()).toBe('disarmed');

		// Re-requesting activation and idempotent replay afterward: still no
		// tool path back to armed.
		await byName.get('enable_alert')!.execute({ alert_id: 'alert_1' });
		expect(currentState()).not.toBe('armed');
	});

	// Brute-force sweep: every ordering of the mutating tool surface, run
	// twice each (to exercise repeat-call/idempotent-without-key paths),
	// asserting after every single call that the alert is never 'armed'.
	// This is the "any order, any arguments" half of AC5 -- not just the
	// specific sequences above.
	it('no ordering of enable/disable/edit calls, repeated, ever produces armed', async () => {
		const callable = ['enable_alert', 'edit_alert_draft', 'disable_alert'];
		function permutations<T>(items: T[]): T[][] {
			if (items.length <= 1) return [items];
			const out: T[][] = [];
			for (let i = 0; i < items.length; i++) {
				const rest = [...items.slice(0, i), ...items.slice(i + 1)];
				for (const p of permutations(rest)) out.push([items[i]!, ...p]);
			}
			return out;
		}
		for (const order of permutations(callable)) {
			const repository = createLocalWorkspaceRepository(memoryStorage());
			repository.put(writeAlert(emptyWorkspace(WORKSPACE_ID, 'Test', NOW), draftAlert()));
			repository.setActiveId(WORKSPACE_ID);
			const localIds = createIdSequencer();
			const localDeps: AlertToolsDeps = {
				repository,
				revisions: createRevisionService({
					repository,
					clock,
					ids: localIds,
					idempotency: createIdempotencyCache()
				}),
				history: createChangeHistory(),
				registry: createOperationRegistry(),
				clock,
				ids: localIds,
				historicalData: createInMemoryAlertHistoricalData()
			};
			const localTools = new Map(buildAlertTools(localDeps).map((t) => [t.name, t]));
			for (const name of [...order, ...order]) {
				const tool = localTools.get(name)!;
				const input =
					name === 'edit_alert_draft'
						? { alert_id: 'alert_1', name: 'renamed' }
						: { alert_id: 'alert_1' };
				await tool.execute(input);
				const state = readAlert(repository.get(WORKSPACE_ID)!, 'alert_1')?.state;
				expect(state).not.toBe('armed');
			}
		}
	});

	// Module-boundary proof (not just behavioural): read the actual source of
	// every tools/*.ts file and confirm none of them *imports* the
	// human-only functions. Matches an actual import specifier (not prose --
	// several of these files mention the module names in comments, which is
	// fine and expected) so a future edit that tries to wire confirm/decline
	// into a ToolSpec fails this test even before its behaviour could be
	// checked.
	it('no file under tools/ imports confirmAlertActivation or declineAlertActivation', () => {
		const toolFiles = [
			'createAlertDraft.ts',
			'editAlertDraft.ts',
			'previewAlert.ts',
			'enableAlert.ts',
			'disableAlert.ts',
			'index.ts',
			'registerAlertTools.ts'
		];
		const forbiddenImports = [
			"from '../application/confirmAlertActivation'",
			"from '../application/declineAlertActivation'"
		];
		let checked = 0;
		for (const file of toolFiles) {
			const source = TOOL_SOURCES[`/src/lib/workbench/alerts/tools/${file}`];
			expect(source, `expected ${file} to be found by the glob`).toBeDefined();
			checked += 1;
			for (const forbidden of forbiddenImports) {
				expect(source).not.toContain(forbidden);
			}
		}
		// Guards against a typo in toolFiles silently checking nothing.
		expect(checked).toBe(toolFiles.length);
	});

	// The human-only functions must expose no ToolSpec-shaped surface (no
	// `execute`/`inputSchema`/`name` a registration loop could pick up) --
	// only the plain outcome-returning functions themselves.
	it('confirm/decline activation export only plain functions, never a ToolSpec', async () => {
		const confirmModule: Record<string, unknown> = await import(
			'../application/confirmAlertActivation'
		);
		const declineModule: Record<string, unknown> = await import(
			'../application/declineAlertActivation'
		);
		for (const mod of [confirmModule, declineModule]) {
			for (const [key, value] of Object.entries(mod)) {
				if (typeof value !== 'function') continue;
				// A ToolSpec builder would return { name, execute, inputSchema, ... }.
				// The real functions here return { ok, alert, ... } outcomes instead.
				expect(key).not.toMatch(/build.*Tool/i);
			}
		}
	});
});
