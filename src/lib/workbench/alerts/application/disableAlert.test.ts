import { describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import { createDisableAlertOperation } from './disableAlert';

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

function alertRecord(overrides: Partial<AlertRecord> = {}): AlertRecord {
	return {
		alertId: 'alert_1',
		workspaceId: 'workspace_1',
		name: 'Big caps',
		state: 'armed',
		source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
		previewable: true,
		previewProblems: [],
		pendingActivation: null,
		activationHistory: [{ kind: 'confirmed', at: NOW, actor: 'human' }],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

function workspaceWithAlert(overrides: Partial<AlertRecord> = {}) {
	return writeAlert(emptyWorkspace('workspace_1', 'Test', NOW), alertRecord(overrides));
}

describe('alerts.disable_activation operation', () => {
	it('disarms an armed alert immediately, with no confirmation step (AC8)', () => {
		const operation = createDisableAlertOperation({ clock });
		const doc = workspaceWithAlert();
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		expect(readAlert(draft.document, 'alert_1')?.state).toBe('disarmed');
	});

	it('records a "disarmed" activation history entry attributed to the agent', () => {
		const operation = createDisableAlertOperation({ clock });
		const doc = workspaceWithAlert();
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		expect(readAlert(draft.document, 'alert_1')?.activationHistory).toEqual([
			{ kind: 'confirmed', at: NOW, actor: 'human' },
			{ kind: 'disarmed', at: LATER, actor: 'agent' }
		]);
	});

	// SAFETY-CRITICAL (see disableAlert.ts's header comment): disabling must
	// never be undoable, or an agent could reach 'armed' again with two
	// undo_change calls and no human confirmation. This is the single most
	// important assertion in this file.
	it('is never undoable: inverse is always null when actually disarming', () => {
		const operation = createDisableAlertOperation({ clock });
		const doc = workspaceWithAlert();
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		expect(draft.inverse).toBeNull();
	});

	it('is idempotent: disabling an already-disarmed alert succeeds and stays disarmed (AC9)', () => {
		const operation = createDisableAlertOperation({ clock });
		const doc = workspaceWithAlert({ state: 'disarmed' });
		expect(operation.validate({ alertId: 'alert_1' }, doc)).toEqual([]);
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		expect(readAlert(draft.document, 'alert_1')?.state).toBe('disarmed');
	});

	it('is never undoable in the already-disarmed no-op path either', () => {
		const operation = createDisableAlertOperation({ clock });
		const doc = workspaceWithAlert({ state: 'disarmed' });
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		expect(draft.inverse).toBeNull();
	});

	it('does not add a duplicate "disarmed" history entry on the already-disarmed no-op path', () => {
		const operation = createDisableAlertOperation({ clock });
		const doc = workspaceWithAlert({
			state: 'disarmed',
			activationHistory: [
				{ kind: 'confirmed', at: NOW, actor: 'human' },
				{ kind: 'disarmed', at: NOW, actor: 'agent' }
			]
		});
		const draft = operation.apply({ alertId: 'alert_1' }, doc, { next: () => 'unused' });
		expect(readAlert(draft.document, 'alert_1')?.activationHistory).toEqual([
			{ kind: 'confirmed', at: NOW, actor: 'human' },
			{ kind: 'disarmed', at: NOW, actor: 'agent' }
		]);
	});

	it('rejects disabling a draft or a pending-activation alert', () => {
		const operation = createDisableAlertOperation({ clock });
		for (const state of ['draft', 'pending_activation'] as const) {
			const issues = operation.validate({ alertId: 'alert_1' }, workspaceWithAlert({ state }));
			expect(issues.length).toBeGreaterThan(0);
		}
	});

	it('rejects an unknown alert id', () => {
		const operation = createDisableAlertOperation({ clock });
		const issues = operation.validate(
			{ alertId: 'alert_missing' },
			emptyWorkspace('workspace_1', 'Test', NOW)
		);
		expect(issues.length).toBeGreaterThan(0);
	});

	it('ignores an adversarial state field and still disarms rather than arming', () => {
		const operation = createDisableAlertOperation({ clock });
		const doc = workspaceWithAlert();
		const draft = operation.apply(
			// @ts-expect-error -- adversarial: DisableAlertInput has no `state`
			// field.
			{ alertId: 'alert_1', state: 'armed' },
			doc,
			{ next: () => 'unused' }
		);
		expect(readAlert(draft.document, 'alert_1')?.state).toBe('disarmed');
	});
});
