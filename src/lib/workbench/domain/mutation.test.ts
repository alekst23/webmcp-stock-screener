import { describe, expect, it } from 'vitest';
import { buildEnvelope, toWireEnvelope } from './mutation';

describe('buildEnvelope', () => {
	it('carries every required field', () => {
		const envelope = buildEnvelope({
			changeId: 'change_1',
			newRevision: 2,
			affectedIds: ['panel_chart_1'],
			diffSummary: 'Added a chart panel.',
			warnings: ['no expected_revision supplied'],
			undoToken: 'undo_1'
		});
		expect(envelope).toEqual({
			changeId: 'change_1',
			newRevision: 2,
			affectedIds: ['panel_chart_1'],
			diffSummary: 'Added a chart panel.',
			warnings: ['no expected_revision supplied'],
			undoToken: 'undo_1'
		});
	});

	it('defaults warnings to an empty list rather than leaving it undefined', () => {
		const envelope = buildEnvelope({
			changeId: 'change_1',
			newRevision: 2,
			affectedIds: [],
			diffSummary: 'Did a thing.'
		});
		expect(envelope.warnings).toEqual([]);
	});

	it('defaults an omitted undo token to null, distinguishable from an empty string', () => {
		const envelope = buildEnvelope({
			changeId: 'change_1',
			newRevision: 2,
			affectedIds: [],
			diffSummary: 'Did an unreversible thing.'
		});
		expect(envelope.undoToken).toBeNull();
		expect(envelope.undoToken).not.toBe('');
	});
});

describe('toWireEnvelope', () => {
	it('serializes to the exact snake_case field names the design doc specifies', () => {
		const envelope = buildEnvelope({
			changeId: 'change_1',
			newRevision: 2,
			affectedIds: ['panel_chart_1'],
			diffSummary: 'Added a chart panel.',
			warnings: ['a warning'],
			undoToken: 'undo_1'
		});
		expect(toWireEnvelope(envelope)).toEqual({
			change_id: 'change_1',
			new_revision: 2,
			affected_ids: ['panel_chart_1'],
			diff_summary: 'Added a chart panel.',
			warnings: ['a warning'],
			undo_token: 'undo_1'
		});
	});

	it('serializes a null undo token as null, not omitted', () => {
		const envelope = buildEnvelope({
			changeId: 'change_1',
			newRevision: 2,
			affectedIds: [],
			diffSummary: 'Did an unreversible thing.'
		});
		const wire = toWireEnvelope(envelope);
		expect(wire.undo_token).toBeNull();
		expect('undo_token' in wire).toBe(true);
	});
});
