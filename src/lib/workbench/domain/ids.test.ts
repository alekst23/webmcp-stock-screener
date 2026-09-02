import { describe, expect, it } from 'vitest';
import { createIdSequencer, isResourceId, mintId, parseId } from './ids';

describe('mintId / parseId', () => {
	it('round-trips an id without a discriminator', () => {
		const id = mintId('workspace', 1);
		expect(id).toBe('workspace_1');
		expect(parseId(id)).toEqual({ kind: 'workspace', sequence: 1 });
	});

	it('round-trips an id with a discriminator', () => {
		const id = mintId('panel', 3, 'chart');
		expect(id).toBe('panel_chart_3');
		expect(parseId(id)).toEqual({ kind: 'panel', discriminator: 'chart', sequence: 3 });
	});

	it('parses a malformed string as null instead of throwing', () => {
		expect(parseId('')).toBeNull();
		expect(parseId('not-an-id')).toBeNull();
		expect(parseId('panel')).toBeNull();
		expect(parseId('bogus_kind_1')).toBeNull();
		expect(parseId('panel_chart_notanumber')).toBeNull();
	});

	it('parses an unrecognized kind as invalid rather than throwing', () => {
		expect(parseId('spaceship_9')).toBeNull();
	});
});

describe('isResourceId', () => {
	it('accepts a valid id of any kind', () => {
		expect(isResourceId('workspace_1')).toBe(true);
	});

	it('accepts a valid id only when it matches the requested kind', () => {
		expect(isResourceId('panel_chart_1', 'panel')).toBe(true);
		expect(isResourceId('panel_chart_1', 'workspace')).toBe(false);
	});

	it('rejects non-strings and malformed strings', () => {
		expect(isResourceId(42)).toBe(false);
		expect(isResourceId(null)).toBe(false);
		expect(isResourceId('not-an-id')).toBe(false);
	});
});

describe('createIdSequencer', () => {
	it('mints increasing sequence numbers per kind', () => {
		const seq = createIdSequencer();
		expect(seq.next('workspace')).toBe('workspace_1');
		expect(seq.next('workspace')).toBe('workspace_2');
	});

	it('keeps separate counters per discriminator', () => {
		const seq = createIdSequencer();
		expect(seq.next('panel', 'chart')).toBe('panel_chart_1');
		expect(seq.next('panel', 'grid')).toBe('panel_grid_1');
		expect(seq.next('panel', 'chart')).toBe('panel_chart_2');
	});

	it('never reuses a sequence number after the resource it named is gone', () => {
		const seq = createIdSequencer();
		const first = seq.next('panel', 'chart');
		// Simulate the panel being deleted: nothing about the sequencer
		// changes, so the next mint must not repeat `first`.
		const second = seq.next('panel', 'chart');
		expect(second).not.toBe(first);
		expect(second).toBe('panel_chart_2');
	});

	it('continues from a seed rather than restarting at 1', () => {
		const seq = createIdSequencer({ workspace: 5, 'panel:chart': 2 });
		expect(seq.next('workspace')).toBe('workspace_6');
		expect(seq.next('panel', 'chart')).toBe('panel_chart_3');
	});
});
