// Typed errors a rejected mutation raises (T-1006-2). Callers branch on
// `instanceof`/error type, never on parsing a message string. Every error
// serializes to a consistent machine-readable failure shape via
// `toWireError()`, suitable for returning from a WebMCP tool.
import type { ResourceId } from './ids';
import type { Revision } from './workspace';

export interface WireError {
	error: string;
	message: string;
	[field: string]: unknown;
}

export class RevisionConflictError extends Error {
	readonly expectedRevision: Revision;
	readonly currentRevision: Revision;
	readonly affectedIds: ResourceId[];

	constructor(expectedRevision: Revision, currentRevision: Revision, affectedIds: ResourceId[]) {
		super(
			`Expected revision ${expectedRevision} but the workspace is at revision ${currentRevision}.`
		);
		this.name = 'RevisionConflictError';
		this.expectedRevision = expectedRevision;
		this.currentRevision = currentRevision;
		this.affectedIds = affectedIds;
	}

	toWireError(): WireError {
		return {
			error: 'revision_conflict',
			message: this.message,
			expected_revision: this.expectedRevision,
			current_revision: this.currentRevision,
			affected_ids: this.affectedIds
		};
	}
}

export class IdempotencyConflictError extends Error {
	readonly idempotencyKey: string;

	constructor(idempotencyKey: string) {
		super(`Idempotency key "${idempotencyKey}" was already used for a different request.`);
		this.name = 'IdempotencyConflictError';
		this.idempotencyKey = idempotencyKey;
	}

	toWireError(): WireError {
		return {
			error: 'idempotency_conflict',
			message: this.message,
			idempotency_key: this.idempotencyKey
		};
	}
}

export type UndoTokenErrorReason = 'unknown' | 'already_redeemed' | 'superseded';

export class UndoTokenError extends Error {
	readonly reason: UndoTokenErrorReason;

	constructor(reason: UndoTokenErrorReason, message?: string) {
		super(message ?? `Undo token error: ${reason}`);
		this.name = 'UndoTokenError';
		this.reason = reason;
	}

	toWireError(): WireError {
		return {
			error: 'undo_token_error',
			message: this.message,
			reason: this.reason
		};
	}
}

export class OperationValidationError extends Error {
	readonly issues: string[];

	constructor(issues: string[], message?: string) {
		super(message ?? `Operation validation failed: ${issues.join('; ')}`);
		this.name = 'OperationValidationError';
		this.issues = issues;
	}

	toWireError(): WireError {
		return {
			error: 'operation_validation_error',
			message: this.message,
			issues: this.issues
		};
	}
}
