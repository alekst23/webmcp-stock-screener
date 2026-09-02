import { describe, expect, it } from 'vitest';
import { createIdSequencer } from '../../domain/ids';
import type { StudyInstance, StudyTransition } from './studies';
import {
	addStudy,
	normalizeStudies,
	removeStudy,
	reorderStudies,
	setStudyEnabled,
	sortStudiesForDisplay,
	toggleStudy,
	updateStudyParams,
	validateStudyInstance
} from './studies';

function study(overrides: Partial<StudyInstance> = {}): StudyInstance {
	return {
		id: 'study_1',
		catalogItemId: 'study.sma',
		params: { period: 50 },
		pane: 'price_overlay',
		order: 0,
		enabled: true,
		...overrides
	};
}

function expectOk(transition: StudyTransition): Extract<StudyTransition, { ok: true }> {
	if (!transition.ok) {
		throw new Error(`expected a successful transition, got: ${transition.issues.join('; ')}`);
	}
	return transition;
}

function expectFailed(transition: StudyTransition): string[] {
	if (transition.ok) {
		throw new Error('expected the transition to be rejected');
	}
	return transition.issues;
}

// A chart with a 50 SMA and a 200 SMA overlaid, plus an RSI in its own pane.
function threeStudies(): StudyInstance[] {
	return [
		study({ id: 'study_1', params: { period: 50 }, order: 0 }),
		study({ id: 'study_2', params: { period: 200 }, order: 1 }),
		study({
			id: 'study_3',
			catalogItemId: 'study.rsi',
			params: { period: 14 },
			pane: 'sub_pane',
			order: 0
		})
	];
}

describe('addStudy', () => {
	it('appends a study at the end of its pane', () => {
		const result = expectOk(addStudy([study()], study({ id: 'study_2', order: 1 })));
		expect(result.studies.map((s) => s.id)).toEqual(['study_1', 'study_2']);
	});

	it('gives two instances of the same catalog item distinct IDs and both survive', () => {
		const result = expectOk(
			addStudy([study()], study({ id: 'study_2', params: { period: 200 }, order: 1 }))
		);
		expect(result.studies.map((s) => s.params.period)).toEqual([50, 200]);
		expect(new Set(result.studies.map((s) => s.id)).size).toBe(2);
	});

	it('inserts at an explicit position within the pane', () => {
		const result = expectOk(addStudy([study()], study({ id: 'study_2', order: 0 })));
		expect(result.studies.map((s) => s.id)).toEqual(['study_2', 'study_1']);
		expect(result.studies.map((s) => s.order)).toEqual([0, 1]);
	});

	it('rejects a duplicate study ID and leaves the prior list untouched', () => {
		const before = [study()];
		const issues = expectFailed(addStudy(before, study({ catalogItemId: 'study.ema' })));
		expect(issues).toEqual(['study.id: "study_1" is already a study on this chart.']);
		expect(before).toEqual([study()]);
	});

	it('rejects an out-of-bounds display order naming the permitted range', () => {
		const issues = expectFailed(addStudy([study()], study({ id: 'study_2', order: 9 })));
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain('study.order');
		expect(issues[0]).toContain('expected 0 to 1');
	});

	it('rejects a non-finite parameter value naming the parameter', () => {
		const issues = expectFailed(addStudy([], study({ params: { period: Number.NaN } })));
		expect(issues[0]).toContain('study.params.period');
	});

	it('rejects an unknown pane', () => {
		const issues = expectFailed(
			addStudy([], study({ pane: 'floating' as unknown as StudyInstance['pane'] }))
		);
		expect(issues[0]).toContain('study.pane');
	});
});

describe('ID stability across update, toggle and reorder', () => {
	it('updating parameters keeps the instance ID and merges rather than replaces', () => {
		const result = expectOk(updateStudyParams(threeStudies(), 'study_1', { period: 20 }));
		const updated = result.studies.find((s) => s.id === 'study_1');
		expect(updated?.id).toBe('study_1');
		expect(updated?.params).toEqual({ period: 20 });
		expect(result.changes).toEqual(['study_1.period: 50 -> 20']);
	});

	it('toggling off and back on keeps the ID and the parameters', () => {
		const off = expectOk(toggleStudy(threeStudies(), 'study_2'));
		const on = expectOk(toggleStudy(off.studies, 'study_2'));
		const roundTripped = on.studies.find((s) => s.id === 'study_2');
		expect(off.studies.find((s) => s.id === 'study_2')?.enabled).toBe(false);
		expect(roundTripped?.enabled).toBe(true);
		expect(roundTripped?.params).toEqual({ period: 200 });
	});

	it('reordering changes no instance ID', () => {
		const before = threeStudies();
		const result = expectOk(reorderStudies(before, ['study_2', 'study_1', 'study_3']));
		expect(new Set(result.studies.map((s) => s.id))).toEqual(new Set(before.map((s) => s.id)));
		expect(result.studies.map((s) => s.id)).toEqual(['study_2', 'study_1', 'study_3']);
	});

	it('reordering renumbers display order within each pane independently', () => {
		const result = expectOk(reorderStudies(threeStudies(), ['study_3', 'study_2', 'study_1']));
		const byId = new Map(result.studies.map((s) => [s.id, s]));
		expect(byId.get('study_3')?.order).toBe(0);
		expect(byId.get('study_2')?.order).toBe(0);
		expect(byId.get('study_1')?.order).toBe(1);
	});

	it('rejects a partial ordering, naming the study left out', () => {
		const issues = expectFailed(reorderStudies(threeStudies(), ['study_2', 'study_1']));
		expect(issues).toEqual(['ordered_ids: "study_3" is missing; supply the complete ordering.']);
	});

	it('rejects an unknown or repeated ID in the ordering', () => {
		const issues = expectFailed(reorderStudies(threeStudies(), ['study_1', 'study_1', 'study_9']));
		expect(issues.some((i) => i.includes('"study_1" appears more than once'))).toBe(true);
		expect(issues.some((i) => i.includes('"study_9" is not a study on this chart'))).toBe(true);
	});
});

describe('setStudyEnabled and updateStudyParams rejections', () => {
	it('reject an unknown study ID and leave the list unchanged', () => {
		const before = threeStudies();
		expect(expectFailed(setStudyEnabled(before, 'study_9', false))).toEqual([
			'study_id: "study_9" is not a study on this chart.'
		]);
		expect(expectFailed(updateStudyParams(before, 'study_9', { period: 5 }))).toHaveLength(1);
		expect(before).toEqual(threeStudies());
	});

	it('report no change when a study is set to the state it already has', () => {
		const result = expectOk(setStudyEnabled(threeStudies(), 'study_1', true));
		expect(result.changes).toEqual([]);
	});
});

describe('removeStudy', () => {
	it('keeps the remaining IDs and their relative order, closing the order gap', () => {
		const result = expectOk(removeStudy(threeStudies(), 'study_1'));
		expect(result.studies.map((s) => s.id)).toEqual(['study_2', 'study_3']);
		expect(result.studies.find((s) => s.id === 'study_2')?.order).toBe(0);
	});

	it('rejects an unknown study ID', () => {
		expect(expectFailed(removeStudy(threeStudies(), 'study_9'))).toEqual([
			'study_id: "study_9" is not a study on this chart.'
		]);
	});
});

describe('transitions do not mutate their input', () => {
	it('leaves the source array and its studies untouched', () => {
		const before = threeStudies();
		const snapshot = JSON.stringify(before);
		expectOk(updateStudyParams(before, 'study_1', { period: 9 }));
		expectOk(reorderStudies(before, ['study_3', 'study_2', 'study_1']));
		expectOk(removeStudy(before, 'study_2'));
		expect(JSON.stringify(before)).toBe(snapshot);
	});
});

describe('sortStudiesForDisplay', () => {
	it('lists price overlays before sub-panes, each in its own order', () => {
		const sorted = sortStudiesForDisplay([...threeStudies()].reverse());
		expect(sorted.map((s) => s.id)).toEqual(['study_1', 'study_2', 'study_3']);
	});
});

describe('normalizeStudies', () => {
	it('never throws on foreign input', () => {
		expect(() => normalizeStudies(undefined)).not.toThrow();
		expect(normalizeStudies('garbage')).toEqual([]);
	});

	it('drops malformed and duplicate entries while keeping the valid ones', () => {
		const kept = normalizeStudies([
			study(),
			study({ id: 'study_1' }),
			{ id: 'study_4', catalogItemId: '', pane: 'sub_pane', params: {}, enabled: true, order: 0 },
			'nonsense'
		]);
		expect(kept.map((s) => s.id)).toEqual(['study_1']);
	});

	it('round-trips a well-formed list unchanged', () => {
		expect(normalizeStudies(threeStudies())).toEqual(threeStudies());
	});
});

describe('validateStudyInstance', () => {
	it('names every offending field at once', () => {
		const issues = validateStudyInstance(
			{ id: '', catalogItemId: '', pane: 'x', enabled: 1 },
			'study'
		);
		expect(issues).toHaveLength(5);
	});
});

describe('stable IDs from the workspace sequencer', () => {
	it('mints kind-prefixed study IDs that never collide', () => {
		const ids = createIdSequencer();
		const minted = [ids.next('study'), ids.next('study'), ids.next('study')];
		expect(minted).toEqual(['study_1', 'study_2', 'study_3']);
		expect(new Set(minted).size).toBe(3);
	});

	it('does not reissue an ID a removed study held, when seeded from the high-water mark', () => {
		const ids = createIdSequencer({ study: 3 });
		expect(ids.next('study')).toBe('study_4');
	});
});
