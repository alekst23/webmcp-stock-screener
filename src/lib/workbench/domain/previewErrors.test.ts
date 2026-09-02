import { describe, expect, it } from 'vitest';
import { SAFETY_ERROR_REASONS, SafetyError } from './previewErrors';
import type { SafetyErrorReason } from './previewErrors';
import type { OperationFailure } from './preview';

function everyFactoryInstance(): SafetyError[] {
	return [
		SafetyError.unknownPreview('preview_1'),
		SafetyError.expiredPreview('preview_1'),
		SafetyError.staleRevision(4, 6),
		SafetyError.preconditionMismatch(2, 4, 6),
		SafetyError.alreadyApplied('preview_1'),
		SafetyError.notApplicable([{ index: 0, kind: 'set_filter', reason: 'bad threshold' }]),
		SafetyError.invalidInput('batch must contain at least one operation')
	];
}

describe('SAFETY_ERROR_REASONS', () => {
	it('enumerates exactly the seven cases preview and apply can return', () => {
		expect(SAFETY_ERROR_REASONS, 'the error set is enumerable by a caller').toEqual([
			'unknown_preview',
			'expired_preview',
			'stale_revision',
			'precondition_mismatch',
			'already_applied',
			'not_applicable',
			'invalid_input'
		]);
	});

	it('has no duplicate entries', () => {
		expect(
			new Set(SAFETY_ERROR_REASONS).size,
			'each reason appears once so enumeration is a clean set'
		).toBe(SAFETY_ERROR_REASONS.length);
	});

	it('has a named constructor for every reason it lists', () => {
		const produced = everyFactoryInstance().map((err) => err.reason);
		expect(
			[...produced].sort(),
			'no reason is listed without a factory that can produce it'
		).toEqual([...SAFETY_ERROR_REASONS].sort());
	});
});

describe('SafetyError distinguishability', () => {
	it('is a real Error, so it is catchable and carries a stack', () => {
		const err = SafetyError.unknownPreview('preview_1');
		expect(err instanceof Error, 'SafetyError extends Error').toBe(true);
		expect(err instanceof SafetyError, 'instanceof narrows to SafetyError').toBe(true);
		expect(typeof err.stack, 'a thrown SafetyError reports where it came from').toBe('string');
		expect(err.name, 'the error names itself').toBe('SafetyError');
	});

	it('lets a caller branch on instanceof plus reason', () => {
		const reasons = everyFactoryInstance().map((err) =>
			err instanceof SafetyError ? err.reason : 'not-a-safety-error'
		);
		expect(reasons, 'each case is distinguishable without parsing a message').toEqual([
			'unknown_preview',
			'expired_preview',
			'stale_revision',
			'precondition_mismatch',
			'already_applied',
			'not_applicable',
			'invalid_input'
		]);
	});

	it('lets a caller branch on the wire payload the same way', () => {
		const wireReasons = everyFactoryInstance().map((err) => err.toWireError().error);
		expect(wireReasons, 'the wire error code is the reason itself').toEqual([
			...SAFETY_ERROR_REASONS
		]);
	});

	it('always emits a non-empty message alongside the code', () => {
		for (const err of everyFactoryInstance()) {
			const wire = err.toWireError();
			expect(wire.message.length > 0, `${err.reason} carries a human-readable message`).toBe(true);
			expect(wire.message, 'the wire message matches the Error message').toBe(err.message);
		}
	});
});

describe('SafetyError.unknownPreview', () => {
	it('names the preview id in its message and wire fields', () => {
		const err = SafetyError.unknownPreview('preview_42');
		expect(err.message.includes('preview_42'), 'the message names the missing preview').toBe(true);
		expect(err.toWireError(), 'the wire payload carries the preview id').toMatchObject({
			error: 'unknown_preview',
			preview_id: 'preview_42'
		});
	});
});

describe('SafetyError.expiredPreview', () => {
	it('is distinguishable from an unknown preview', () => {
		const expired = SafetyError.expiredPreview('preview_42');
		const unknown = SafetyError.unknownPreview('preview_42');
		expect(
			expired.reason,
			'expiry is its own reason so a caller can advise re-previewing'
		).not.toBe(unknown.reason);
		expect(expired.toWireError(), 'the wire payload carries the preview id').toMatchObject({
			error: 'expired_preview',
			preview_id: 'preview_42'
		});
	});
});

describe('SafetyError.staleRevision', () => {
	it('names both the previewed and the current revision in its message', () => {
		const err = SafetyError.staleRevision(4, 7);
		expect(err.message.includes('4'), 'the message names the previewed revision').toBe(true);
		expect(err.message.includes('7'), 'the message names the current revision').toBe(true);
	});

	it('carries both revisions as separate wire fields', () => {
		expect(
			SafetyError.staleRevision(4, 7).toWireError(),
			'both revisions are machine-readable, not only in prose'
		).toEqual({
			error: 'stale_revision',
			message: SafetyError.staleRevision(4, 7).message,
			previewed_revision: 4,
			current_revision: 7
		});
	});
});

describe('SafetyError.preconditionMismatch', () => {
	it('carries the expected, previewed and current revisions', () => {
		const err = SafetyError.preconditionMismatch(2, 4, 7);
		expect(err.toWireError(), 'all three revisions are reported').toMatchObject({
			error: 'precondition_mismatch',
			expected_revision: 2,
			previewed_revision: 4,
			current_revision: 7
		});
	});

	it('is distinguishable from a stale revision', () => {
		expect(
			SafetyError.preconditionMismatch(2, 4, 7).reason,
			'an explicit expectation mismatch is not the same case as a moved revision'
		).not.toBe(SafetyError.staleRevision(4, 7).reason);
	});
});

describe('SafetyError.alreadyApplied', () => {
	it('names the consumed preview', () => {
		const err = SafetyError.alreadyApplied('preview_9');
		expect(err.message.includes('preview_9'), 'the message names the consumed preview').toBe(true);
		expect(err.toWireError(), 'the wire payload carries the preview id').toMatchObject({
			error: 'already_applied',
			preview_id: 'preview_9'
		});
	});
});

describe('SafetyError.notApplicable', () => {
	it('carries every failure that blocked the apply', () => {
		const failures: OperationFailure[] = [
			{ index: 0, kind: 'unknown_kind', reason: 'operation kind is not registered' },
			{ index: 2, kind: 'set_filter', reason: 'threshold must be a number' }
		];
		const wire = SafetyError.notApplicable(failures).toWireError();
		expect(wire.error, 'the reason is not_applicable').toBe('not_applicable');
		expect(wire.failures, 'the blocking failures travel with the error').toEqual(failures);
	});

	it('counts the failures in its message', () => {
		const one = SafetyError.notApplicable([{ index: 0, kind: 'x', reason: 'bad' }]);
		const two = SafetyError.notApplicable([
			{ index: 0, kind: 'x', reason: 'bad' },
			{ index: 1, kind: 'y', reason: 'worse' }
		]);
		expect(one.message.includes('1 validation failure'), 'singular for one failure').toBe(true);
		expect(two.message.includes('2 validation failures'), 'plural for several failures').toBe(true);
	});
});

describe('SafetyError.invalidInput', () => {
	it('uses the caller-supplied message verbatim', () => {
		const err = SafetyError.invalidInput('batch must contain at least one operation');
		expect(err.message, 'the validator owns the wording').toBe(
			'batch must contain at least one operation'
		);
		expect(err.toWireError(), 'no extra fields are invented for this case').toEqual({
			error: 'invalid_input',
			message: 'batch must contain at least one operation'
		});
	});
});

describe('SafetyErrorReason', () => {
	it('accepts every listed reason as a valid value of the type', () => {
		const reasons: SafetyErrorReason[] = [...SAFETY_ERROR_REASONS];
		expect(reasons.length, 'the union and the runtime list stay in step').toBe(
			SAFETY_ERROR_REASONS.length
		);
	});
});
