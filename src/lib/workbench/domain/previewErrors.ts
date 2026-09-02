// The error cases preview and apply can return. A caller branches on
// `instanceof SafetyError` plus `.reason`, or on `toWireError().error` --
// never on parsing a message string.
import type { WireError } from './errors';
import type { ResourceId } from './ids';
import type { Revision } from './workspace';
import type { OperationFailure } from './preview';

export type SafetyErrorReason =
	| 'unknown_preview'
	| 'expired_preview'
	| 'stale_revision'
	| 'precondition_mismatch'
	| 'already_applied'
	| 'not_applicable'
	| 'invalid_input';

// Exported as a value so the set is enumerable by callers building tool
// schemas and by tests asserting no reason was added without a factory.
export const SAFETY_ERROR_REASONS: readonly SafetyErrorReason[] = [
	'unknown_preview',
	'expired_preview',
	'stale_revision',
	'precondition_mismatch',
	'already_applied',
	'not_applicable',
	'invalid_input'
];

type ErrorDetails = Record<string, unknown>;

// Case-specific fields live in `details` rather than in named properties, so
// adding a case costs one factory and no change to the class body.
export class SafetyError extends Error {
	readonly reason: SafetyErrorReason;
	readonly details: ErrorDetails;

	constructor(reason: SafetyErrorReason, message: string, details: ErrorDetails = {}) {
		super(message);
		this.name = 'SafetyError';
		this.reason = reason;
		this.details = details;
	}

	toWireError(): WireError {
		return { error: this.reason, message: this.message, ...this.details };
	}

	static unknownPreview(previewId: ResourceId): SafetyError {
		return new SafetyError('unknown_preview', `No preview found with id "${previewId}".`, {
			preview_id: previewId
		});
	}

	static expiredPreview(previewId: ResourceId): SafetyError {
		return new SafetyError(
			'expired_preview',
			`Preview "${previewId}" has expired; re-preview the batch against the current revision.`,
			{ preview_id: previewId }
		);
	}

	// Names both revisions because the caller's next step is to re-preview,
	// and knowing how far the workspace moved tells it why.
	static staleRevision(previewedRevision: Revision, currentRevision: Revision): SafetyError {
		return new SafetyError(
			'stale_revision',
			`Preview was computed against revision ${previewedRevision} but the workspace is at ` +
				`revision ${currentRevision}; re-preview the batch.`,
			{ previewed_revision: previewedRevision, current_revision: currentRevision }
		);
	}

	static preconditionMismatch(
		expectedRevision: Revision,
		previewedRevision: Revision,
		currentRevision: Revision
	): SafetyError {
		return new SafetyError(
			'precondition_mismatch',
			`Expected revision ${expectedRevision} matches neither the previewed revision ` +
				`${previewedRevision} nor the current revision ${currentRevision}.`,
			{
				expected_revision: expectedRevision,
				previewed_revision: previewedRevision,
				current_revision: currentRevision
			}
		);
	}

	static alreadyApplied(previewId: ResourceId): SafetyError {
		return new SafetyError(
			'already_applied',
			`Preview "${previewId}" was already applied; a preview is consumed once.`,
			{ preview_id: previewId }
		);
	}

	static notApplicable(failures: readonly OperationFailure[]): SafetyError {
		const count = failures.length;
		return new SafetyError(
			'not_applicable',
			`Preview reported ${count} validation ${count === 1 ? 'failure' : 'failures'} and ` +
				`cannot be applied.`,
			{ failures: failures.map((f) => ({ index: f.index, kind: f.kind, reason: f.reason })) }
		);
	}

	static invalidInput(message: string): SafetyError {
		return new SafetyError('invalid_input', message);
	}
}
