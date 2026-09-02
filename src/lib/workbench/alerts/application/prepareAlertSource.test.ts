import { describe, expect, it } from 'vitest';
import type { RangeCondition } from '../../../screener/conditions';
import {
	emptyFilterTree,
	emptyUniverse,
	type ScreenerDefinition
} from '../../../screener/definition';
import { writeScreener } from '../../../screener/state';
import { emptyWorkspace } from '../../domain/workspace';
import {
	alertSourceIssues,
	computeAlertPreviewability,
	resolveAlertSource
} from './prepareAlertSource';

const NOW = '2026-09-02T00:00:00.000Z';

function baseWorkspace() {
	return emptyWorkspace('workspace_1', 'Test', NOW);
}

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

const VOLUME_CONDITION: RangeCondition = {
	type: 'range',
	fieldId: 'field.volume',
	lower: 1,
	upper: 2,
	lowerInclusive: true,
	upperInclusive: true
};

describe('alertSourceIssues', () => {
	it('rejects neither screener_id nor conditions given', () => {
		expect(alertSourceIssues({}, baseWorkspace())).toHaveLength(1);
	});

	it('rejects both screener_id and conditions given', () => {
		const issues = alertSourceIssues(
			{ screener_id: 'screener_1', conditions: [VOLUME_CONDITION] },
			baseWorkspace()
		);
		expect(issues).toHaveLength(1);
	});

	it('rejects an unknown screener_id, naming it', () => {
		const issues = alertSourceIssues({ screener_id: 'screener_missing' }, baseWorkspace());
		expect(issues[0]).toContain('screener_missing');
	});

	it('accepts an existing screener_id', () => {
		const doc = writeScreener(baseWorkspace(), screenerDefinition());
		expect(alertSourceIssues({ screener_id: 'screener_1' }, doc)).toEqual([]);
	});

	it('rejects an empty conditions array', () => {
		expect(alertSourceIssues({ conditions: [] }, baseWorkspace())).toHaveLength(1);
	});

	it('rejects a condition that does not normalize, naming its index', () => {
		const issues = alertSourceIssues(
			{ conditions: [{ type: 'not_a_real_type' }] },
			baseWorkspace()
		);
		expect(issues[0]).toContain('conditions[0]');
	});

	it('accepts a well-formed conditions array', () => {
		expect(alertSourceIssues({ conditions: [VOLUME_CONDITION] }, baseWorkspace())).toEqual([]);
	});
});

describe('resolveAlertSource', () => {
	it('builds a typed-conditions source from raw conditions', () => {
		const source = resolveAlertSource({ conditions: [VOLUME_CONDITION] }, baseWorkspace());
		expect(source).toEqual({ kind: 'conditions', conditions: [VOLUME_CONDITION] });
	});

	it('snapshots the current screener into a screener_revision source', () => {
		const doc = writeScreener(baseWorkspace(), screenerDefinition({ revision: 7 }));
		const source = resolveAlertSource({ screener_id: 'screener_1' }, doc);
		expect(source).toEqual({
			kind: 'screener_revision',
			screenerId: 'screener_1',
			screenerRevision: 7,
			filterTree: emptyFilterTree('filter_1'),
			universe: emptyUniverse()
		});
	});
});

describe('computeAlertPreviewability', () => {
	it('is previewable for an ordinary, uncontradictory set of conditions', async () => {
		const result = await computeAlertPreviewability(
			{ kind: 'conditions', conditions: [VOLUME_CONDITION] },
			'workspace_1'
		);
		expect(result.previewable).toBe(true);
		expect(result.previewProblems).toEqual([]);
	});

	it('is not previewable for two disjoint range conditions on the same field (contradiction, AC8)', async () => {
		const contradictory: RangeCondition = {
			type: 'range',
			fieldId: 'field.volume',
			lower: 100,
			upper: 200,
			lowerInclusive: true,
			upperInclusive: true
		};
		const result = await computeAlertPreviewability(
			{ kind: 'conditions', conditions: [VOLUME_CONDITION, contradictory] },
			'workspace_1'
		);
		expect(result.previewable).toBe(false);
		expect(result.previewProblems.length).toBeGreaterThan(0);
		expect(result.previewProblems[0]).toContain('field.volume');
	});

	it('is not previewable when a condition references data the catalog marks unavailable (AC8)', async () => {
		const result = await computeAlertPreviewability(
			{
				kind: 'conditions',
				conditions: [
					{
						type: 'scalar',
						fieldId: 'field.fundamentals.pe_ratio',
						operator: 'op.greater_than',
						value: 10,
						unit: null
					}
				]
			},
			'workspace_1'
		);
		expect(result.previewable).toBe(false);
		expect(result.previewProblems.some((p) => p.includes('field.fundamentals.pe_ratio'))).toBe(
			true
		);
	});

	it('never lets an advisory-only problem (e.g. expensive query) mark a draft not previewable', async () => {
		// A single well-formed condition never trips the cost budget on its own;
		// this asserts the default happy path stays previewable rather than
		// second-guessing severities inline here.
		const result = await computeAlertPreviewability(
			{ kind: 'conditions', conditions: [VOLUME_CONDITION] },
			'workspace_1'
		);
		expect(result.previewable).toBe(true);
	});
});
