// Tests for the ONLY function in the program that can write 'armed'
// (T-1014-9 AC3, AC7). Uses the real repository/revisionService stack
// (rather than fakes) so a passing test also exercises the exact commit
// path this function takes in the running app.
import { beforeEach, describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { createIdSequencer } from '../../domain/ids';
import { createIdempotencyCache } from '../../application/idempotency';
import { createRevisionService } from '../../application/revisionService';
import { createLocalWorkspaceRepository } from '../../infra/workspaceRepository';
import { memoryStorage } from '../../testSupport';
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import { computeActivationExpiry } from '../domain/alertActivation';
import { confirmAlertActivation, type ConfirmAlertActivationDeps } from './confirmAlertActivation';

const NOW = '2026-09-02T00:00:00.000Z';
const WORKSPACE_ID = 'workspace_1';

const VOLUME_CONDITION: RangeCondition = {
	type: 'range',
	fieldId: 'field.volume',
	lower: 1,
	upper: 2,
	lowerInclusive: true,
	upperInclusive: true
};

function pendingAlert(overrides: Partial<AlertRecord> = {}): AlertRecord {
	return {
		alertId: 'alert_1',
		workspaceId: WORKSPACE_ID,
		name: 'Big caps',
		state: 'pending_activation',
		source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
		previewable: true,
		previewProblems: [],
		pendingActivation: { requestedAt: NOW, expiresAt: computeActivationExpiry(NOW) },
		activationHistory: [{ kind: 'requested', at: NOW, actor: 'agent' }],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

describe('confirmAlertActivation', () => {
	let deps: ConfirmAlertActivationDeps;
	let clock: Clock;

	beforeEach(() => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		clock = { now: () => NOW };
		repository.put(writeAlert(emptyWorkspace(WORKSPACE_ID, 'Test', NOW), pendingAlert()));
		deps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock,
				ids: createIdSequencer(),
				idempotency: createIdempotencyCache()
			}),
			clock
		};
	});

	it('transitions a pending activation request to armed', () => {
		const outcome = confirmAlertActivation(deps, WORKSPACE_ID, 'alert_1');
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.alert.state).toBe('armed');
	});

	it('clears the pending activation request', () => {
		const outcome = confirmAlertActivation(deps, WORKSPACE_ID, 'alert_1');
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.alert.pendingActivation).toBeNull();
	});

	it('records who confirmed and when as an activation history entry (AC3)', () => {
		const outcome = confirmAlertActivation(deps, WORKSPACE_ID, 'alert_1');
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.alert.activationHistory).toEqual([
			{ kind: 'requested', at: NOW, actor: 'agent' },
			{ kind: 'confirmed', at: NOW, actor: 'human' }
		]);
	});

	it('persists the armed state onto the workspace, readable independently', () => {
		confirmAlertActivation(deps, WORKSPACE_ID, 'alert_1');
		const doc = deps.repository.get(WORKSPACE_ID)!;
		expect(readAlert(doc, 'alert_1')?.state).toBe('armed');
	});

	it('bumps the workspace revision', () => {
		const before = deps.repository.get(WORKSPACE_ID)!.revision;
		const outcome = confirmAlertActivation(deps, WORKSPACE_ID, 'alert_1');
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.newRevision).toBe(before + 1);
	});

	it('refuses to confirm an alert with no pending request', () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(
			writeAlert(
				emptyWorkspace(WORKSPACE_ID, 'Test', NOW),
				pendingAlert({ state: 'draft', pendingActivation: null })
			)
		);
		const localDeps: ConfirmAlertActivationDeps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock,
				ids: createIdSequencer(),
				idempotency: createIdempotencyCache()
			}),
			clock
		};
		const outcome = confirmAlertActivation(localDeps, WORKSPACE_ID, 'alert_1');
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected failure');
		expect(outcome.reason).toBe('not_pending');
	});

	it('refuses to confirm an unknown alert', () => {
		const outcome = confirmAlertActivation(deps, WORKSPACE_ID, 'alert_missing');
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected failure');
		expect(outcome.reason).toBe('not_found');
	});

	// AC7: an expired request cannot be confirmed.
	it('refuses to confirm an expired request, leaving the alert pending, not armed', () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const expiredNow = computeActivationExpiry(NOW); // exactly the expiry instant: expired
		repository.put(
			writeAlert(
				emptyWorkspace(WORKSPACE_ID, 'Test', NOW),
				pendingAlert({ pendingActivation: { requestedAt: NOW, expiresAt: expiredNow } })
			)
		);
		const localClock: Clock = { now: () => expiredNow };
		const localDeps: ConfirmAlertActivationDeps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock: localClock,
				ids: createIdSequencer(),
				idempotency: createIdempotencyCache()
			}),
			clock: localClock
		};
		const outcome = confirmAlertActivation(localDeps, WORKSPACE_ID, 'alert_1');
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected failure');
		expect(outcome.reason).toBe('expired');
		expect(readAlert(repository.get(WORKSPACE_ID)!, 'alert_1')?.state).toBe('pending_activation');
	});

	// SAFETY-CRITICAL: this function's dependency shape has no ChangeHistory
	// at all -- it structurally cannot append to the ledger undo_change reads
	// from. See alertActivationSafety.test.ts for the end-to-end proof that
	// a confirmed alert's undo token is never discoverable through
	// undo_change.
	it('accepts no ChangeHistory dependency to append to the ledger undo_change reads', () => {
		expect(Object.keys(deps).sort()).toEqual(['clock', 'repository', 'revisions']);
	});
});
