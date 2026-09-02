import { describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
import type { Clock } from '../../domain/ports';
import { emptyWorkspace } from '../../domain/workspace';
import { readAlert } from '../domain/alert';
import { createCreateAlertDraftOperation, prepareCreateAlertDraft } from './createAlertDraft';

const NOW = '2026-09-02T00:00:00.000Z';
const clock: Clock = { now: () => NOW };

function baseWorkspace() {
	return emptyWorkspace('workspace_1', 'Test', NOW);
}

const VOLUME_CONDITION: RangeCondition = {
	type: 'range',
	fieldId: 'field.volume',
	lower: 1,
	upper: 2,
	lowerInclusive: true,
	upperInclusive: true
};

describe('prepareCreateAlertDraft', () => {
	it('resolves a well-formed conditions request', async () => {
		const outcome = await prepareCreateAlertDraft(
			{ name: 'Big caps', conditions: [VOLUME_CONDITION] },
			baseWorkspace()
		);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.prepared.name).toBe('Big caps');
		expect(outcome.prepared.previewable).toBe(true);
	});

	it('reports structural issues without touching previewability for a bad request', async () => {
		const outcome = await prepareCreateAlertDraft({ name: '' }, baseWorkspace());
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected failure');
		expect(outcome.issues.length).toBeGreaterThan(0);
	});

	it('marks a contradictory draft not previewable, naming the problem (AC8)', async () => {
		const disjoint: RangeCondition = { ...VOLUME_CONDITION, lower: 100, upper: 200 };
		const outcome = await prepareCreateAlertDraft(
			{ name: 'Contradiction', conditions: [VOLUME_CONDITION, disjoint] },
			baseWorkspace()
		);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error('expected ok');
		expect(outcome.prepared.previewable).toBe(false);
		expect(outcome.prepared.previewProblems.length).toBeGreaterThan(0);
	});
});

describe('alerts.create_draft operation', () => {
	it('always writes state "draft", even if asked to write something else (mutation check for the safety property)', () => {
		const operation = createCreateAlertDraftOperation({ clock });
		const doc = baseWorkspace();
		const draft = operation.apply(
			{
				name: 'Big caps',
				source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
				previewable: true,
				previewProblems: [],
				// @ts-expect-error -- adversarial: CreateAlertDraftInput has no `state`
				// field at all, so this can only reach apply() through an unsafe cast;
				// the assertion below is what actually proves state is hard-coded.
				state: 'armed'
			},
			doc,
			{ next: () => 'alert_1' }
		);
		const stored = readAlert(draft.document, 'alert_1');
		expect(stored?.state).toBe('draft');
	});

	it('creates a new alert and its inverse discards exactly that alert', () => {
		const operation = createCreateAlertDraftOperation({ clock });
		const doc = baseWorkspace();
		const draft = operation.apply(
			{
				name: 'Big caps',
				source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
				previewable: true,
				previewProblems: []
			},
			doc,
			{ next: () => 'alert_1' }
		);
		expect(readAlert(draft.document, 'alert_1')?.name).toBe('Big caps');
		expect(draft.inverse?.document).toBe(doc);
		expect(readAlert(draft.inverse!.document, 'alert_1')).toBeNull();
	});

	it('rejects a missing name', () => {
		const operation = createCreateAlertDraftOperation({ clock });
		const issues = operation.validate(
			{
				name: '',
				source: { kind: 'conditions', conditions: [VOLUME_CONDITION] },
				previewable: true,
				previewProblems: []
			},
			baseWorkspace()
		);
		expect(issues.length).toBeGreaterThan(0);
	});

	it('rejects a source naming a screener the workspace does not have', () => {
		const operation = createCreateAlertDraftOperation({ clock });
		const issues = operation.validate(
			{
				name: 'Big caps',
				source: {
					kind: 'screener_revision',
					screenerId: 'screener_missing',
					screenerRevision: 1,
					filterTree: { nodeId: 'filter_1', kind: 'group', op: 'and', enabled: true, children: [] },
					universe: {
						assetClass: '',
						exchanges: [],
						countries: [],
						sectors: [],
						industries: [],
						indexes: [],
						watchlists: [],
						liquidity: { minPrice: null, minAverageVolume: null, minMarketCap: null },
						exclusions: { instrumentIds: [], sectorIds: [], industryIds: [] }
					}
				},
				previewable: true,
				previewProblems: []
			},
			baseWorkspace()
		);
		expect(issues.length).toBeGreaterThan(0);
	});
});
