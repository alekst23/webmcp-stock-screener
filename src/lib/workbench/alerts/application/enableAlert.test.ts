import { describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { computeActivationExpiry } from '../domain/alertActivation';
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import { createEnableAlertOperation } from './enableAlert';

const NOW = '2026-09-02T00:00:00.000Z';
const LATER = '2026-09-02T01:00:00.000Z';
const clock: Clock = { now: () => LATER };

const VOLUME_CONDITION: RangeCondition = {
	type: 'range',
	fieldId: 'field.volume',
	lower: 1,
	upper: 2,
	lowerInclusive: true,
	upperInclusive: true
};

function draftAlert(overrides: Partial<AlertRecord> = {}): AlertRecord {
	return {
		alertId: 'alert_1',
		workspaceId: 'workspace_1',
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

function workspaceWithAlert(overrides: Partial<AlertRecord> = {}) {
	return writeAlert(emptyWorkspace('workspace_1', 'Test', NOW), draftAlert(overrides));
}

describe('alerts.enable_activation operation', () => {
	it('transitions a draft to pending_activation, never armed (mutation check)', () => {
		const operation = createEnableAlertOperation({ clock });
		const doc = workspaceWithAlert();
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		const stored = readAlert(draft.document, 'alert_1');
		expect(stored?.state).toBe('pending_activation');
		expect(stored?.state).not.toBe('armed');
	});

	it('records a pending activation request with requestedAt and a bounded expiresAt', () => {
		const operation = createEnableAlertOperation({ clock });
		const doc = workspaceWithAlert();
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		const stored = readAlert(draft.document, 'alert_1');
		expect(stored?.pendingActivation).toEqual({
			requestedAt: LATER,
			expiresAt: computeActivationExpiry(LATER)
		});
	});

	it('appends a "requested" activation history entry attributed to the agent', () => {
		const operation = createEnableAlertOperation({ clock });
		const doc = workspaceWithAlert();
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		expect(readAlert(draft.document, 'alert_1')?.activationHistory).toEqual([
			{ kind: 'requested', at: LATER, actor: 'agent' }
		]);
	});

	it('states in its diffSummary that the alert is not armed', () => {
		const operation = createEnableAlertOperation({ clock });
		const doc = workspaceWithAlert();
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		expect(draft.diffSummary.toLowerCase()).toContain('not armed');
	});

	it('ignores an adversarial state: "armed" field and still lands on pending_activation', () => {
		const operation = createEnableAlertOperation({ clock });
		const doc = workspaceWithAlert();
		const draft = operation.apply(
			// @ts-expect-error -- adversarial: EnableAlertInput has no `state`
			// field; the assertion below proves it changes nothing regardless.
			{ alertId: 'alert_1', state: 'armed' },
			doc,
			{ next: () => 'unused' }
		);
		expect(readAlert(draft.document, 'alert_1')?.state).toBe('pending_activation');
	});

	it('rejects requesting activation for a non-draft, non-expired-pending alert', () => {
		const operation = createEnableAlertOperation({ clock });
		for (const state of ['armed', 'disarmed'] as const) {
			const issues = operation.validate({ alertId: 'alert_1' }, workspaceWithAlert({ state }));
			expect(issues.length).toBeGreaterThan(0);
		}
	});

	it('rejects a second request while an existing pending request has not expired', () => {
		const operation = createEnableAlertOperation({ clock });
		// LATER (the clock this operation reads) must fall strictly before the
		// request's expiry for this to exercise "still pending, not expired".
		const farFuture = '2099-01-01T00:00:00.000Z';
		const doc = workspaceWithAlert({
			state: 'pending_activation',
			pendingActivation: { requestedAt: NOW, expiresAt: farFuture }
		});
		const issues = operation.validate({ alertId: 'alert_1' }, doc);
		expect(issues.length).toBeGreaterThan(0);
		expect(issues[0]).toContain('pending');
	});

	it('allows re-requesting once pending has expired, and records the expiry (AC7)', () => {
		const operation = createEnableAlertOperation({ clock });
		const expiredRequest = { requestedAt: NOW, expiresAt: NOW }; // expired as of LATER
		const doc = workspaceWithAlert({
			state: 'pending_activation',
			pendingActivation: expiredRequest,
			activationHistory: [{ kind: 'requested', at: NOW, actor: 'agent' }]
		});
		expect(operation.validate({ alertId: 'alert_1' }, doc)).toEqual([]);
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		const stored = readAlert(draft.document, 'alert_1');
		expect(stored?.state).toBe('pending_activation');
		expect(stored?.pendingActivation).toEqual({
			requestedAt: LATER,
			expiresAt: computeActivationExpiry(LATER)
		});
		expect(stored?.activationHistory).toEqual([
			{ kind: 'requested', at: NOW, actor: 'agent' },
			{ kind: 'expired', at: LATER, actor: 'agent' },
			{ kind: 'requested', at: LATER, actor: 'agent' }
		]);
	});

	it('rejects an unknown alert id', () => {
		const operation = createEnableAlertOperation({ clock });
		const issues = operation.validate(
			{ alertId: 'alert_missing' },
			emptyWorkspace('workspace_1', 'Test', NOW)
		);
		expect(issues.length).toBeGreaterThan(0);
	});

	it("undoing an enable request restores the pre-request document, never 'armed' (AC12)", () => {
		const operation = createEnableAlertOperation({ clock });
		const doc = workspaceWithAlert();
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		expect(draft.inverse).not.toBeNull();
		const restored = readAlert(draft.inverse!.document, 'alert_1');
		expect(restored).toEqual(draftAlert());
		expect(restored?.state).not.toBe('armed');
	});
});
