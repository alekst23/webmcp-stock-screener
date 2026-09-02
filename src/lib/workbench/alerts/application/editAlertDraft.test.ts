import { describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import { createEditAlertDraftOperation, prepareEditAlertDraft } from './editAlertDraft';

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
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

function workspaceWithDraft(overrides: Partial<AlertRecord> = {}) {
	return writeAlert(emptyWorkspace('workspace_1', 'Test', NOW), draftAlert(overrides));
}

describe('prepareEditAlertDraft', () => {
	it('renames without touching the source or previewability', async () => {
		const outcome = await prepareEditAlertDraft(
			{ alert_id: 'alert_1', name: 'Small caps' },
			workspaceWithDraft()
		);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.prepared.name).toBe('Small caps');
		expect(outcome.prepared.source).toEqual({ kind: 'conditions', conditions: [VOLUME_CONDITION] });
	});

	it('replaces the conditions and recomputes previewability', async () => {
		const disjoint: RangeCondition = { ...VOLUME_CONDITION, lower: 100, upper: 200 };
		const outcome = await prepareEditAlertDraft(
			{ alert_id: 'alert_1', conditions: [VOLUME_CONDITION, disjoint] },
			workspaceWithDraft()
		);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.prepared.previewable).toBe(false);
	});

	it('rejects an edit with nothing to change', async () => {
		const outcome = await prepareEditAlertDraft({ alert_id: 'alert_1' }, workspaceWithDraft());
		expect(outcome.ok).toBe(false);
	});

	it('rejects giving both screener_id and conditions', async () => {
		const outcome = await prepareEditAlertDraft(
			{ alert_id: 'alert_1', screener_id: 'screener_1', conditions: [VOLUME_CONDITION] },
			workspaceWithDraft()
		);
		expect(outcome.ok).toBe(false);
	});

	it('rejects editing an unknown alert', async () => {
		const outcome = await prepareEditAlertDraft(
			{ alert_id: 'alert_missing', name: 'x' },
			emptyWorkspace('workspace_1', 'Test', NOW)
		);
		expect(outcome.ok).toBe(false);
	});

	// Currently unreachable through this ticket's tools (nothing produces a
	// non-draft alert), but the guard itself is real and tested directly.
	it('refuses to edit an alert that is not in draft state', async () => {
		const outcome = await prepareEditAlertDraft(
			{ alert_id: 'alert_1', name: 'x' },
			workspaceWithDraft({ state: 'armed' })
		);
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected failure');
		expect(outcome.issues[0]).toContain('armed');
	});
});

describe('alerts.edit_conditions operation', () => {
	it('keeps the alert in draft even when handed an adversarial target state (mutation check)', () => {
		const operation = createEditAlertDraftOperation({ clock });
		const doc = workspaceWithDraft();
		const draft = operation.apply(
			{
				alertId: 'alert_1',
				name: 'Renamed',
				source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
				previewable: true,
				previewProblems: [],
				// @ts-expect-error -- adversarial: EditAlertDraftInput has no `state`
				// field; the assertion below proves the write is hard-coded to draft
				// regardless.
				state: 'armed'
			},
			doc,
			{ next: () => 'unused' }
		);
		expect(readAlert(draft.document, 'alert_1')?.state).toBe('draft');
	});

	it('updates the name and bumps updatedAt without touching createdAt', () => {
		const operation = createEditAlertDraftOperation({ clock });
		const doc = workspaceWithDraft();
		const draft = operation.apply(
			{
				alertId: 'alert_1',
				name: 'Renamed',
				source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
				previewable: true,
				previewProblems: []
			},
			doc,
			{ next: () => 'unused' }
		);
		const stored = readAlert(draft.document, 'alert_1');
		expect(stored?.name).toBe('Renamed');
		expect(stored?.createdAt).toBe(NOW);
		expect(stored?.updatedAt).toBe(LATER);
	});

	it("undoing an edit restores the alert's prior content exactly", () => {
		const operation = createEditAlertDraftOperation({ clock });
		const doc = workspaceWithDraft();
		const draft = operation.apply(
			{
				alertId: 'alert_1',
				name: 'Renamed',
				source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
				previewable: true,
				previewProblems: []
			},
			doc,
			{ next: () => 'unused' }
		);
		expect(readAlert(draft.inverse!.document, 'alert_1')).toEqual(draftAlert());
	});

	it('rejects editing an alert that is not a draft', () => {
		const operation = createEditAlertDraftOperation({ clock });
		const issues = operation.validate(
			{
				alertId: 'alert_1',
				name: 'x',
				source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
				previewable: true,
				previewProblems: []
			},
			workspaceWithDraft({ state: 'disarmed' })
		);
		expect(issues.length).toBeGreaterThan(0);
	});
});
