import { describe, expect, it } from 'vitest';
import { collectAffectedIds } from './preview';
import type { DiffEntry } from './preview';
import { diffWorkspaces, summarizeDiff } from './workspaceDiff';
import { emptyWorkspace } from './workspace';
import type { LayoutEntry, PanelRecord, WorkspaceDocument } from './workspace';

function base(): WorkspaceDocument {
	return emptyWorkspace('ws_1', 'Research', '2026-01-01T00:00:00.000Z');
}

function panel(id: string, overrides: Partial<PanelRecord> = {}): PanelRecord {
	return {
		id,
		kind: 'chart',
		title: id,
		collapsed: false,
		visible: true,
		boundResourceId: null,
		config: {},
		...overrides
	};
}

function layout(panelId: string, overrides: Partial<LayoutEntry> = {}): LayoutEntry {
	return { panelId, col: 0, row: 0, width: 4, height: 3, ...overrides };
}

function withPanels(doc: WorkspaceDocument, panels: PanelRecord[]): WorkspaceDocument {
	return { ...doc, panels };
}

function entryFor(diff: readonly DiffEntry[], id: string): DiffEntry | undefined {
	return diff.find((entry) => entry.id === id);
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	for (const child of Object.values(value as Record<string, unknown>)) {
		deepFreeze(child);
	}
	return Object.freeze(value);
}

describe('diffWorkspaces', () => {
	it('reports added, removed and updated entities by their stable id', () => {
		const before = withPanels(base(), [panel('panel_keep'), panel('panel_gone')]);
		const after = withPanels(base(), [
			panel('panel_keep', { title: 'Renamed' }),
			panel('panel_new')
		]);
		const diff = diffWorkspaces(before, after);
		expect(
			diff.map((entry) => [entry.change, entry.entityType, entry.id]),
			'each changed entity is reported once, keyed by its stable id'
		).toEqual([
			['updated', 'panels', 'panel_keep'],
			['added', 'panels', 'panel_new'],
			['removed', 'panels', 'panel_gone']
		]);
	});

	it('leaves fields empty for added and removed entities', () => {
		const before = withPanels(base(), [panel('panel_gone')]);
		const after = withPanels(base(), [panel('panel_new')]);
		const diff = diffWorkspaces(before, after);
		expect(
			diff.every((entry) => entry.fields.length === 0),
			'a whole-entity add or remove has no per-field detail to report'
		).toBe(true);
	});

	it('names only the changed fields of an updated entity, with before and after', () => {
		const before = withPanels(base(), [panel('panel_1', { title: 'Old', collapsed: false })]);
		const after = withPanels(base(), [panel('panel_1', { title: 'New', collapsed: true })]);
		const diff = diffWorkspaces(before, after);
		expect(
			diff[0]?.fields,
			'unchanged fields are omitted; changed ones carry before/after'
		).toEqual([
			{ field: 'collapsed', before: false, after: true },
			{ field: 'title', before: 'Old', after: 'New' }
		]);
	});

	it('detects nested field changes structurally rather than by reference', () => {
		const before = withPanels(base(), [panel('panel_1', { config: { period: 14 } })]);
		const same = withPanels(base(), [panel('panel_1', { config: { period: 14 } })]);
		const changed = withPanels(base(), [panel('panel_1', { config: { period: 20 } })]);
		expect(
			diffWorkspaces(before, same),
			'structurally equal nested config is not a change'
		).toEqual([]);
		expect(
			diffWorkspaces(before, changed)[0]?.fields,
			'a nested value change is reported as a change to its owning field'
		).toEqual([{ field: 'config', before: { period: 14 }, after: { period: 20 } }]);
	});

	it('produces an empty diff for two identical states', () => {
		const before = withPanels(base(), [panel('panel_1'), panel('panel_2')]);
		const after = withPanels(base(), [panel('panel_1'), panel('panel_2')]);
		expect(
			diffWorkspaces(before, after),
			'identical states diff to nothing, not to a list of unchanged entities'
		).toEqual([]);
	});

	it('excludes revision and updatedAt, which the revision service stamps at commit', () => {
		const before = base();
		const after = { ...base(), revision: 7, updatedAt: '2026-06-06T12:00:00.000Z' };
		expect(
			diffWorkspaces(before, after),
			'bookkeeping stamps are not effects of the batch, so every diff would otherwise be dirty'
		).toEqual([]);
	});

	it('collects scalar workspace changes onto a single workspace entry', () => {
		const before = base();
		const after = { ...base(), name: 'Renamed', activeSymbol: 'AAPL', screenerId: 'scr_1' };
		const diff = diffWorkspaces(before, after);
		expect(diff.length, 'scalar changes collapse into one workspace entry').toBe(1);
		expect(diff[0]?.change, 'a workspace whose scalars moved is an update').toBe('updated');
		expect(diff[0]?.entityType, 'the workspace itself is its own entity type').toBe('workspace');
		expect(diff[0]?.id, 'the workspace entry is keyed by the workspace id').toBe('ws_1');
		expect(
			diff[0]?.fields.map((field) => field.field),
			'workspace fields are reported sorted by name'
		).toEqual(['activeSymbol', 'name', 'screenerId']);
	});

	it('diffs entries identified by a single trailing-Id property rather than id', () => {
		const before = { ...base(), layout: [layout('panel_1'), layout('panel_2')] };
		const after = {
			...base(),
			layout: [layout('panel_1', { col: 6 }), layout('panel_3')]
		};
		const diff = diffWorkspaces(before, after);
		expect(
			diff.map((entry) => [entry.change, entry.id]),
			'layout entries key off panelId, so they diff without being named in the source'
		).toEqual([
			['updated', 'panel_1'],
			['added', 'panel_3'],
			['removed', 'panel_2']
		]);
		expect(entryFor(diff, 'panel_1')?.fields, 'only the moved coordinate is reported').toEqual([
			{ field: 'col', before: 0, after: 6 }
		]);
	});

	it('reports an array element with no derivable identity positionally', () => {
		// Two *Id properties and no id: identity is ambiguous, so it is refused.
		const ambiguous = (source: string, target: string) => ({
			sourcePanelId: source,
			targetPanelId: target
		});
		const before = { ...base(), extensions: { bridges: [ambiguous('a', 'b')] } };
		const after = { ...base(), extensions: { bridges: [ambiguous('a', 'c')] } };
		const diff = diffWorkspaces(before, after);
		expect(diff.length, 'the change surfaces on the workspace entry, not as its own entity').toBe(
			1
		);
		expect(
			diff[0]?.fields.map((field) => field.field),
			'an unidentifiable element is compared positionally rather than dropped'
		).toEqual(['extensions.bridges[0]']);
	});

	it('reports a non-array extension value as an extensions-prefixed field change', () => {
		const before = { ...base(), extensions: { alerts: { muted: false } } };
		const after = { ...base(), extensions: { alerts: { muted: true } } };
		const diff = diffWorkspaces(before, after);
		expect(diff[0]?.entityType, 'a non-collection extension lands on the workspace entry').toBe(
			'workspace'
		);
		expect(diff[0]?.fields, 'the field is namespaced by its extension key').toEqual([
			{ field: 'extensions.alerts', before: { muted: false }, after: { muted: true } }
		]);
	});

	it('diffs a novel extension entity kind the source never names', () => {
		const study = (id: string, period: number) => ({ id, period });
		const before = {
			...base(),
			extensions: { studies: [study('study_a', 14), study('study_b', 9)] }
		};
		const after = {
			...base(),
			extensions: { studies: [study('study_a', 21), study('study_c', 5)] }
		};
		const diff = diffWorkspaces(before, after);
		expect(
			diff.map((entry) => [entry.change, entry.entityType, entry.id]),
			'a kind contributed by a later epic appears in the diff with no edit to the differ'
		).toEqual([
			['updated', 'extensions.studies', 'study_a'],
			['added', 'extensions.studies', 'study_c'],
			['removed', 'extensions.studies', 'study_b']
		]);
		expect(entryFor(diff, 'study_a')?.fields, 'its changed fields are reported too').toEqual([
			{ field: 'period', before: 14, after: 21 }
		]);
	});

	it('orders the workspace entry first, then collections by entity type', () => {
		const before = {
			...base(),
			panels: [panel('panel_1')],
			layout: [layout('panel_1')],
			extensions: { studies: [{ id: 'study_a', period: 14 }] }
		};
		const after = {
			...base(),
			name: 'Renamed',
			panels: [panel('panel_1'), panel('panel_2')],
			layout: [layout('panel_1', { row: 2 })],
			extensions: { studies: [{ id: 'study_a', period: 21 }] }
		};
		expect(
			diffWorkspaces(before, after).map((entry) => entry.entityType),
			'ordering is pinned: workspace first, then collections in sorted key order'
		).toEqual(['workspace', 'extensions.studies', 'layout', 'panels']);
	});

	it('is deterministic across property and array construction order', () => {
		const before = {
			...base(),
			panels: [panel('panel_stable'), panel('panel_edit', { title: 'Old' }), panel('panel_gone')],
			extensions: { studies: [{ id: 'study_a', period: 14 }] }
		};
		// Same content, different key insertion order and a repositioned
		// (unchanged) panel: neither may reach the output.
		const afterA: WorkspaceDocument = {
			...base(),
			name: 'Renamed',
			activeSymbol: 'AAPL',
			panels: [
				panel('panel_stable'),
				{ ...panel('panel_edit'), title: 'New', collapsed: true },
				panel('panel_added')
			],
			// The two new keys arrive in opposite insertion orders in afterB, which
			// is what an unsorted field walk would leak into the output.
			extensions: { studies: [{ id: 'study_a', period: 21, zeta: 2, alpha: 1 }] }
		};
		const afterB: WorkspaceDocument = {
			...base(),
			activeSymbol: 'AAPL',
			name: 'Renamed',
			panels: [
				{
					collapsed: true,
					title: 'New',
					visible: true,
					config: {},
					boundResourceId: null,
					kind: 'chart',
					id: 'panel_edit'
				},
				panel('panel_added'),
				panel('panel_stable')
			],
			extensions: { studies: [{ alpha: 1, period: 21, zeta: 2, id: 'study_a' }] }
		};
		const diffA = diffWorkspaces(before, afterA);
		const diffB = diffWorkspaces(before, afterB);
		expect(diffA, 'ordering must not depend on object-key iteration or insertion timing').toEqual(
			diffB
		);
		expect(diffA, 'repeated calls on the same inputs are stable').toEqual(
			diffWorkspaces(before, afterA)
		);
		expect(
			diffA.map((entry) => entry.id),
			'the pinned order is workspace, then sorted collections, then removals last'
		).toEqual(['ws_1', 'study_a', 'panel_edit', 'panel_added', 'panel_gone']);
		expect(
			entryFor(diffA, 'study_a')?.fields.map((field) => field.field),
			'fields are sorted by name, not by the order the keys happened to be written'
		).toEqual(['alpha', 'period', 'zeta']);
	});

	it('does not mutate either input document', () => {
		const before = deepFreeze(withPanels(base(), [panel('panel_1', { title: 'Old' })]));
		const after = deepFreeze(withPanels(base(), [panel('panel_1', { title: 'New' })]));
		const beforeSnapshot = JSON.stringify(before);
		const afterSnapshot = JSON.stringify(after);
		const diff = diffWorkspaces(before, after);
		expect(diff.length, 'the diff still reports the change on frozen inputs').toBe(1);
		expect(JSON.stringify(before), 'diffing is pure: the before state is untouched').toBe(
			beforeSnapshot
		);
		expect(JSON.stringify(after), 'diffing is pure: the after state is untouched').toBe(
			afterSnapshot
		);
	});
});

describe('collectAffectedIds over a real diff', () => {
	it('is the deduplicated set of diff ids in first-appearance order', () => {
		const before = {
			...base(),
			panels: [panel('panel_1'), panel('panel_2')],
			layout: [layout('panel_1')]
		};
		const after = {
			...base(),
			name: 'Renamed',
			panels: [panel('panel_1', { title: 'Chart' })],
			layout: [layout('panel_1', { col: 3 })]
		};
		const diff = diffWorkspaces(before, after);
		expect(
			collectAffectedIds(diff),
			'panel_1 appears in both layout and panels entries but is listed once, in first-appearance order'
		).toEqual(['ws_1', 'panel_1', 'panel_2']);
	});
});

describe('summarizeDiff', () => {
	it('says so rather than returning an empty string for an empty diff', () => {
		const summary = summarizeDiff([]);
		expect(summary, 'an empty diff still needs a readable sentence').toBe('No changes.');
		expect(summary.length, 'the summary is never the empty string').toBeGreaterThan(0);
	});

	it('ignores operation fragments when the structured diff is empty', () => {
		expect(
			summarizeDiff([], ['Added RSI study']),
			'the summary may never describe a change the structured diff does not contain'
		).toBe('No changes.');
	});

	it('uses operation fragments for phrasing when the diff is non-empty', () => {
		const before = base();
		const after = {
			...base(),
			extensions: { studies: [{ id: 'study_rsi', period: 14 }], filters: [{ id: 'flt_rsi' }] }
		};
		const diff = diffWorkspaces(before, after);
		expect(
			summarizeDiff(diff, ['Added RSI study', 'RSI 40-70 filter']),
			'fragments supply the human phrasing the house example shows'
		).toBe('Added RSI study and RSI 40-70 filter');
	});

	it('derives a summary from the diff alone when no fragments are supplied', () => {
		const before = withPanels(base(), [panel('panel_1', { title: 'Old' })]);
		const after = withPanels(base(), [panel('panel_1', { title: 'New' }), panel('panel_2')]);
		expect(
			summarizeDiff(diffWorkspaces(before, after)),
			'the sentence is built from the diff, so it cannot disagree with it'
		).toBe('Updated panel and added panel');
	});

	it('counts grouped changes rather than listing each entity', () => {
		const before = base();
		const after = withPanels(base(), [panel('panel_1'), panel('panel_2'), panel('panel_3')]);
		expect(
			summarizeDiff(diffWorkspaces(before, after)),
			'a group of same-kind changes reads as a count'
		).toBe('Added 3 panels');
	});

	it('degrades a large batch to a remaining-change count instead of growing', () => {
		const before = {
			...base(),
			layout: [layout('panel_a'), layout('panel_b'), layout('panel_c'), layout('panel_d')],
			extensions: { studies: [] as unknown[] }
		};
		const after = {
			...base(),
			panels: [panel('p1'), panel('p2'), panel('p3'), panel('p4'), panel('p5')],
			links: Array.from({ length: 6 }, (_, index) => ({
				id: `link_${index}`,
				sourcePanelId: 'p1',
				targetPanelId: 'p2',
				channel: 'symbol' as const
			})),
			layout: [],
			extensions: { studies: Array.from({ length: 5 }, (_, i) => ({ id: `study_${i}` })) }
		};
		const diff = diffWorkspaces(before, after);
		expect(diff.length, 'the batch touches 20 entities').toBe(20);
		const summary = summarizeDiff(diff);
		expect(summary.length, 'a 20-entity summary stays readable at a glance').toBeLessThan(120);
		expect(summary, 'the tail degrades to a count of the changes not spelled out').toMatch(
			/ and \d+ more changes$/
		);
		expect(summary, 'the remaining count covers the entities the clauses omitted').toBe(
			'Added 5 extensions.studies, removed 4 layout, added 6 links and 5 more changes'
		);
	});

	it('keeps a one-entity remainder singular', () => {
		const diff: DiffEntry[] = [
			{ change: 'added', entityType: 'panels', id: 'p1', fields: [] },
			{ change: 'added', entityType: 'links', id: 'l1', fields: [] },
			{ change: 'added', entityType: 'layout', id: 'p1', fields: [] },
			{ change: 'added', entityType: 'studies', id: 's1', fields: [] }
		];
		expect(summarizeDiff(diff), 'one leftover change is a change, not changes').toBe(
			'Added panel, added link, added layout and 1 more change'
		);
	});

	it('renders at most three fragments before degrading', () => {
		const diff: DiffEntry[] = [
			{ change: 'added', entityType: 'panels', id: 'p1', fields: [] },
			{ change: 'added', entityType: 'panels', id: 'p2', fields: [] }
		];
		expect(
			summarizeDiff(diff, ['one', 'two', 'three', 'four', 'five']),
			'fragment-driven summaries are capped the same way'
		).toBe('One, two, three and 2 more changes');
	});
});
