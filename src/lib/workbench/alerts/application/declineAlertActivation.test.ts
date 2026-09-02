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
import { declineAlertActivation, type DeclineAlertActivationDeps } from './declineAlertActivation';

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

describe('declineAlertActivation', () => {
	let deps: DeclineAlertActivationDeps;
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

	it('leaves the alert a draft (AC4)', () => {
		const outcome = declineAlertActivation(deps, WORKSPACE_ID, 'alert_1');
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.alert.state).toBe('draft');
	});

	it('clears the pending activation request (AC4)', () => {
		const outcome = declineAlertActivation(deps, WORKSPACE_ID, 'alert_1');
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.alert.pendingActivation).toBeNull();
	});

	it('a subsequent status read reports the activation was declined (AC4)', () => {
		declineAlertActivation(deps, WORKSPACE_ID, 'alert_1');
		const doc = deps.repository.get(WORKSPACE_ID)!;
		const alert = readAlert(doc, 'alert_1');
		expect(alert?.activationHistory.at(-1)).toEqual({ kind: 'declined', at: NOW, actor: 'human' });
	});

	it('refuses to decline an alert with no pending request', () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.put(
			writeAlert(
				emptyWorkspace(WORKSPACE_ID, 'Test', NOW),
				pendingAlert({ state: 'draft', pendingActivation: null })
			)
		);
		const localDeps: DeclineAlertActivationDeps = {
			repository,
			revisions: createRevisionService({
				repository,
				clock,
				ids: createIdSequencer(),
				idempotency: createIdempotencyCache()
			}),
			clock
		};
		const outcome = declineAlertActivation(localDeps, WORKSPACE_ID, 'alert_1');
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected failure');
		expect(outcome.reason).toBe('not_pending');
	});

	it('refuses to decline an unknown alert', () => {
		const outcome = declineAlertActivation(deps, WORKSPACE_ID, 'alert_missing');
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected failure');
		expect(outcome.reason).toBe('not_found');
	});

	it('never produces an armed alert, no matter what', () => {
		const outcome = declineAlertActivation(deps, WORKSPACE_ID, 'alert_1');
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.alert.state).not.toBe('armed');
	});
});
