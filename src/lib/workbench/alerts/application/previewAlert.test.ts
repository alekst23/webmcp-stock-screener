import { describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
import { emptyWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import { writeAlert, type AlertRecord } from '../domain/alert';
import { createInMemoryAlertHistoricalData } from '../infra/inMemoryAlertHistoricalData';
import { previewAlert, type PreviewAlertDeps } from './previewAlert';

const NOW = '2026-09-02T00:00:00.000Z';

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

function repositoryOf(doc: WorkspaceDocument) {
	return {
		get: (id: string) => (id === doc.id ? doc : null),
		getActiveId: () => doc.id
	};
}

function depsWithPort(
	doc: WorkspaceDocument,
	port: PreviewAlertDeps['port'] = createInMemoryAlertHistoricalData()
): PreviewAlertDeps {
	return { repository: repositoryOf(doc), port, clock: { now: () => NOW } };
}

describe('previewAlert', () => {
	it('rejects an unknown alert id', async () => {
		const doc = emptyWorkspace('workspace_1', 'Test', NOW);
		const outcome = await previewAlert(depsWithPort(doc), doc.id, { alertId: 'alert_missing' });
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected failure');
		expect(outcome.reason).toBe('unknown_alert');
	});

	it('reports zero firings plainly, not an error, for a never-fires alert (AC7)', async () => {
		const doc = writeAlert(emptyWorkspace('workspace_1', 'Test', NOW), draftAlert());
		const outcome = await previewAlert(
			depsWithPort(doc, createInMemoryAlertHistoricalData({ instrumentIds: ['inst:A'] })),
			doc.id,
			{ alertId: 'alert_1' }
		);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok || outcome.kind !== 'evaluated')
			throw new Error('expected an evaluated preview');
		expect(outcome.report.firingCount).toBe(0);
	});

	it('reports a noisy alert with the observed rate (AC6)', async () => {
		const doc = writeAlert(emptyWorkspace('workspace_1', 'Test', NOW), draftAlert());
		const noisyPort = createInMemoryAlertHistoricalData({
			instrumentIds: ['inst:A', 'inst:B', 'inst:C'],
			fires: () => true
		});
		const outcome = await previewAlert(depsWithPort(doc, noisyPort), doc.id, {
			alertId: 'alert_1',
			window: { start: '2026-06-01', end: '2026-06-05' }
		});
		expect(outcome.ok).toBe(true);
		if (!outcome.ok || outcome.kind !== 'evaluated')
			throw new Error('expected an evaluated preview');
		expect(outcome.report.noisy).toBe(true);
		expect(outcome.report.firingRate).toBeGreaterThan(outcome.report.noiseThreshold);
	});

	it('reports counts, instruments and dates for a mixed-firing alert (AC4)', async () => {
		const doc = writeAlert(emptyWorkspace('workspace_1', 'Test', NOW), draftAlert());
		const port = createInMemoryAlertHistoricalData({
			instrumentIds: ['inst:A', 'inst:B'],
			fires: (id, date) => id === 'inst:A' && date === '2026-06-03'
		});
		const outcome = await previewAlert(depsWithPort(doc, port), doc.id, {
			alertId: 'alert_1',
			window: { start: '2026-06-01', end: '2026-06-05' }
		});
		expect(outcome.ok).toBe(true);
		if (!outcome.ok || outcome.kind !== 'evaluated')
			throw new Error('expected an evaluated preview');
		expect(outcome.report.firingCount).toBe(1);
		expect(outcome.report.instruments).toEqual(['inst:A']);
		expect(outcome.report.firings).toEqual([{ instrumentId: 'inst:A', firedAt: '2026-06-03' }]);
	});

	it('does not evaluate a not-previewable alert, naming the stored problem (AC8)', async () => {
		const doc = writeAlert(
			emptyWorkspace('workspace_1', 'Test', NOW),
			draftAlert({ previewable: false, previewProblems: ['field "x" is unavailable'] })
		);
		let evaluateCalled = false;
		const port = createInMemoryAlertHistoricalData();
		const spyingPort = {
			...port,
			evaluate: (...args: Parameters<typeof port.evaluate>) => {
				evaluateCalled = true;
				return port.evaluate(...args);
			}
		};
		const outcome = await previewAlert(depsWithPort(doc, spyingPort), doc.id, {
			alertId: 'alert_1'
		});
		expect(outcome.ok).toBe(true);
		if (!outcome.ok || outcome.kind !== 'not_previewable')
			throw new Error('expected not_previewable');
		expect(outcome.problems).toEqual(['field "x" is unavailable']);
		expect(evaluateCalled).toBe(false);
	});

	it('does not mutate the workspace document (AC12)', async () => {
		const doc = writeAlert(emptyWorkspace('workspace_1', 'Test', NOW), draftAlert());
		const before = JSON.stringify(doc);
		await previewAlert(depsWithPort(doc), doc.id, { alertId: 'alert_1' });
		expect(JSON.stringify(doc)).toBe(before);
	});

	it('defaults the window when none is given', async () => {
		const doc = writeAlert(emptyWorkspace('workspace_1', 'Test', NOW), draftAlert());
		const outcome = await previewAlert(depsWithPort(doc), doc.id, { alertId: 'alert_1' });
		expect(outcome.ok).toBe(true);
		if (!outcome.ok || outcome.kind !== 'evaluated')
			throw new Error('expected an evaluated preview');
		expect(outcome.report.window.end).toBe('2026-09-02');
	});

	it('rejects a window wider than the preview cap', async () => {
		const doc = writeAlert(emptyWorkspace('workspace_1', 'Test', NOW), draftAlert());
		const outcome = await previewAlert(depsWithPort(doc), doc.id, {
			alertId: 'alert_1',
			window: { start: '2020-01-01', end: '2026-01-01' }
		});
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected failure');
		expect(outcome.reason).toBe('invalid_window');
	});

	it('rejects an end before start', async () => {
		const doc = writeAlert(emptyWorkspace('workspace_1', 'Test', NOW), draftAlert());
		const outcome = await previewAlert(depsWithPort(doc), doc.id, {
			alertId: 'alert_1',
			window: { start: '2026-06-05', end: '2026-06-01' }
		});
		expect(outcome.ok).toBe(false);
	});
});
