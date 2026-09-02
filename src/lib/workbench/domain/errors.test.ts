import { describe, expect, it } from 'vitest';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError,
	UndoTokenError
} from './errors';

describe('RevisionConflictError', () => {
	it('carries both the expected and the actual current revision', () => {
		const err = new RevisionConflictError(3, 5, ['panel_chart_1']);
		expect(err.expectedRevision).toBe(3);
		expect(err.currentRevision).toBe(5);
		expect(err.affectedIds).toEqual(['panel_chart_1']);
	});

	it('serializes to a machine-readable failure shape', () => {
		const err = new RevisionConflictError(3, 5, []);
		expect(err.toWireError()).toEqual({
			error: 'revision_conflict',
			message: err.message,
			expected_revision: 3,
			current_revision: 5,
			affected_ids: []
		});
	});
});

describe('IdempotencyConflictError', () => {
	it('carries the offending idempotency key', () => {
		const err = new IdempotencyConflictError('key-123');
		expect(err.idempotencyKey).toBe('key-123');
		expect(err.toWireError()).toMatchObject({
			error: 'idempotency_conflict',
			idempotency_key: 'key-123'
		});
	});
});

describe('UndoTokenError', () => {
	it.each(['unknown', 'already_redeemed', 'superseded'] as const)(
		'states which reason applies: %s',
		(reason) => {
			const err = new UndoTokenError(reason);
			expect(err.reason).toBe(reason);
			expect(err.toWireError()).toMatchObject({ error: 'undo_token_error', reason });
		}
	);
});

describe('OperationValidationError', () => {
	it('carries the validation issues', () => {
		const err = new OperationValidationError(['missing field: symbol']);
		expect(err.issues).toEqual(['missing field: symbol']);
		expect(err.toWireError()).toMatchObject({
			error: 'operation_validation_error',
			issues: ['missing field: symbol']
		});
	});
});

describe('every typed error', () => {
	it('branches on error type rather than on the message text', () => {
		const errors: Error[] = [
			new RevisionConflictError(1, 2, []),
			new IdempotencyConflictError('k'),
			new UndoTokenError('unknown'),
			new OperationValidationError(['x'])
		];
		const kinds = errors.map((e) => {
			if (e instanceof RevisionConflictError) return 'revision';
			if (e instanceof IdempotencyConflictError) return 'idempotency';
			if (e instanceof UndoTokenError) return 'undo';
			if (e instanceof OperationValidationError) return 'validation';
			return 'unknown';
		});
		expect(kinds).toEqual(['revision', 'idempotency', 'undo', 'validation']);
	});
});
