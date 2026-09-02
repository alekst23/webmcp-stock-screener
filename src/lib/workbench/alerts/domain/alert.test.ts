import { describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
import {
	emptyFilterTree,
	emptyUniverse,
	type ScreenerDefinition
} from '../../../screener/definition';
import { writeScreener } from '../../../screener/state';
import { emptyWorkspace } from '../../domain/workspace';
import type { WorkspaceDocument } from '../../domain/workspace';
import {
	isScreenerSourceSuperseded,
	normalizeAlert,
	readAlert,
	readAlerts,
	snapshotScreenerSource,
	toWireAlert,
	writeAlert,
	type AlertRecord
} from './alert';

const NOW = '2026-09-02T00:00:00.000Z';

const RANGE_CONDITION: RangeCondition = {
	type: 'range',
	fieldId: 'field.volume',
	lower: 1_000_000_000,
	upper: 50_000_000_000,
	lowerInclusive: true,
	upperInclusive: true
};

function baseWorkspace(): WorkspaceDocument {
	return emptyWorkspace('workspace_1', 'Test', NOW);
}

function baseAlert(overrides: Partial<AlertRecord> = {}): AlertRecord {
	return {
		alertId: 'alert_1',
		workspaceId: 'workspace_1',
		name: 'Big caps',
		state: 'draft',
		source: { kind: 'conditions', conditions: [RANGE_CONDITION] },
		previewable: true,
		previewProblems: [],
		pendingActivation: null,
		activationHistory: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

describe('alert storage', () => {
	it('round-trips a written alert through read', () => {
		const doc = writeAlert(baseWorkspace(), baseAlert());
		const read = readAlert(doc, 'alert_1');
		expect(read).toEqual(baseAlert());
	});

	it('never mutates the input document', () => {
		const doc = baseWorkspace();
		const before = JSON.stringify(doc);
		writeAlert(doc, baseAlert());
		expect(JSON.stringify(doc)).toBe(before);
	});

	it('lists every stored alert', () => {
		const doc = writeAlert(
			writeAlert(baseWorkspace(), baseAlert({ alertId: 'alert_1' })),
			baseAlert({ alertId: 'alert_2', name: 'Small caps' })
		);
		expect(
			readAlerts(doc)
				.map((a) => a.alertId)
				.sort()
		).toEqual(['alert_1', 'alert_2']);
	});

	it('returns null for an unknown alert id', () => {
		expect(readAlert(baseWorkspace(), 'alert_missing')).toBeNull();
	});

	it('normalizes a malformed persisted record to null rather than throwing', () => {
		expect(normalizeAlert({ not: 'an alert' })).toBeNull();
		expect(normalizeAlert(null)).toBeNull();
		expect(normalizeAlert('a string')).toBeNull();
	});

	it('normalizes a corrupt source to an empty typed-conditions source rather than breaking', () => {
		const normalized = normalizeAlert({ alertId: 'alert_1', source: { kind: 'nonsense' } });
		expect(normalized?.source).toEqual({ kind: 'conditions', conditions: [] });
	});

	// normalizeAlert must faithfully read back any of the four real states --
	// T-1014-9 writes pending_activation/armed/disarmed records this same
	// reader has to see correctly. The "only draft comes out of this ticket's
	// code" guarantee lives in the write path (every operation here
	// hard-codes the literal 'draft'), not in this reader.
	it('reads back any of the four real states faithfully', () => {
		expect(normalizeAlert({ alertId: 'a', state: 'draft' })?.state).toBe('draft');
		expect(normalizeAlert({ alertId: 'a', state: 'pending_activation' })?.state).toBe(
			'pending_activation'
		);
		expect(normalizeAlert({ alertId: 'a', state: 'armed' })?.state).toBe('armed');
		expect(normalizeAlert({ alertId: 'a', state: 'disarmed' })?.state).toBe('disarmed');
	});

	it('repairs an unrecognized state string to draft rather than trusting it', () => {
		expect(normalizeAlert({ alertId: 'a', state: 'not-a-real-state' })?.state).toBe('draft');
		expect(normalizeAlert({ alertId: 'a' })?.state).toBe('draft');
	});

	it('defaults pendingActivation to null and activationHistory to [] when absent', () => {
		const normalized = normalizeAlert({ alertId: 'a', state: 'draft' });
		expect(normalized?.pendingActivation).toBeNull();
		expect(normalized?.activationHistory).toEqual([]);
	});

	it('round-trips a pending activation request and an activation history', () => {
		const raw = {
			alertId: 'a',
			state: 'pending_activation',
			pendingActivation: { requestedAt: NOW, expiresAt: '2026-09-02T00:15:00.000Z' },
			activationHistory: [{ kind: 'requested', at: NOW, actor: 'agent' }]
		};
		const normalized = normalizeAlert(raw);
		expect(normalized?.pendingActivation).toEqual({
			requestedAt: NOW,
			expiresAt: '2026-09-02T00:15:00.000Z'
		});
		expect(normalized?.activationHistory).toEqual([
			{ kind: 'requested', at: NOW, actor: 'agent' }
		]);
	});

	it('drops a malformed pending activation request and history entry rather than throwing', () => {
		const normalized = normalizeAlert({
			alertId: 'a',
			pendingActivation: { requestedAt: 4 },
			activationHistory: [
				{ kind: 'not-a-real-kind', at: NOW, actor: 'agent' },
				{ kind: 'requested', at: NOW, actor: 'bogus' },
				'not even an object',
				{ kind: 'requested', at: NOW, actor: 'agent' }
			]
		});
		expect(normalized?.pendingActivation).toBeNull();
		expect(normalized?.activationHistory).toEqual([
			{ kind: 'requested', at: NOW, actor: 'agent' }
		]);
	});
});

describe('toWireAlert', () => {
	it('echoes the draft state and reports armed: false for it', () => {
		const wire = toWireAlert(baseAlert());
		expect(wire.state).toBe('draft');
		expect(wire.armed).toBe(false);
	});

	it('reports armed: true only for an alert actually in the armed state', () => {
		const wire = toWireAlert(baseAlert({ state: 'armed' }));
		expect(wire.state).toBe('armed');
		expect(wire.armed).toBe(true);
	});

	it('serializes a pending activation request and the activation history', () => {
		const wire = toWireAlert(
			baseAlert({
				state: 'pending_activation',
				pendingActivation: { requestedAt: NOW, expiresAt: '2026-09-02T00:15:00.000Z' },
				activationHistory: [{ kind: 'requested', at: NOW, actor: 'agent' }]
			})
		);
		expect(wire.pending_activation).toEqual({
			requested_at: NOW,
			expires_at: '2026-09-02T00:15:00.000Z'
		});
		expect(wire.activation_history).toEqual([{ kind: 'requested', at: NOW, actor: 'agent' }]);
	});

	it('serializes pending_activation: null and an empty activation_history for a fresh draft', () => {
		const wire = toWireAlert(baseAlert());
		expect(wire.pending_activation).toBeNull();
		expect(wire.activation_history).toEqual([]);
	});

	it('serializes a conditions source with its typed conditions', () => {
		const wire = toWireAlert(baseAlert());
		expect(wire.source).toEqual({ kind: 'conditions', conditions: [RANGE_CONDITION] });
	});

	it('serializes a screener_revision source in snake_case', () => {
		const source = {
			kind: 'screener_revision' as const,
			screenerId: 'screener_1',
			screenerRevision: 3,
			filterTree: emptyFilterTree('filter_1'),
			universe: emptyUniverse()
		};
		const wire = toWireAlert(baseAlert({ source }));
		expect(wire.source).toEqual({
			kind: 'screener_revision',
			screener_id: 'screener_1',
			screener_revision: 3,
			filter_tree: source.filterTree,
			universe: source.universe
		});
	});
});

function screenerDefinition(overrides: Partial<ScreenerDefinition> = {}): ScreenerDefinition {
	return {
		screenerId: 'screener_1',
		workspaceId: 'workspace_1',
		name: 'My screener',
		revision: 1,
		universe: emptyUniverse(),
		filterTree: emptyFilterTree('filter_1'),
		ranking: null,
		...overrides
	};
}

describe('snapshotScreenerSource', () => {
	it('freezes the current filter tree, universe and revision', () => {
		const doc = writeScreener(baseWorkspace(), screenerDefinition({ revision: 5 }));
		const snapshot = snapshotScreenerSource(doc, 'screener_1');
		expect(snapshot).toEqual({
			kind: 'screener_revision',
			screenerId: 'screener_1',
			screenerRevision: 5,
			filterTree: emptyFilterTree('filter_1'),
			universe: emptyUniverse()
		});
	});

	it('returns null for a screener that does not exist', () => {
		expect(snapshotScreenerSource(baseWorkspace(), 'screener_missing')).toBeNull();
	});

	it('is a frozen copy: editing the live screener afterwards does not change the snapshot', () => {
		const doc = writeScreener(baseWorkspace(), screenerDefinition({ revision: 1 }));
		const snapshot = snapshotScreenerSource(doc, 'screener_1');
		writeScreener(doc, screenerDefinition({ revision: 2, name: 'Renamed' }));
		expect(snapshot?.screenerRevision).toBe(1);
	});
});

describe('isScreenerSourceSuperseded', () => {
	it('is false for a typed-conditions source', () => {
		const doc = baseWorkspace();
		expect(isScreenerSourceSuperseded({ kind: 'conditions', conditions: [] }, doc)).toBe(false);
	});

	it('is false when the live screener is still at the snapshotted revision', () => {
		const doc = writeScreener(baseWorkspace(), screenerDefinition({ revision: 2 }));
		const source = snapshotScreenerSource(doc, 'screener_1')!;
		expect(isScreenerSourceSuperseded(source, doc)).toBe(false);
	});

	it('is true once the live screener has moved past the snapshotted revision', () => {
		let doc = writeScreener(baseWorkspace(), screenerDefinition({ revision: 2 }));
		const source = snapshotScreenerSource(doc, 'screener_1')!;
		doc = writeScreener(doc, screenerDefinition({ revision: 3 }));
		expect(isScreenerSourceSuperseded(source, doc)).toBe(true);
	});

	it('is false when the source screener has since been removed', () => {
		const doc = writeScreener(baseWorkspace(), screenerDefinition({ revision: 2 }));
		const source = snapshotScreenerSource(doc, 'screener_1')!;
		expect(isScreenerSourceSuperseded(source, baseWorkspace())).toBe(false);
	});
});
