import { describe, expect, it } from 'vitest';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError,
	StorageWriteError,
	UndoTokenError
} from '../../workbench/domain/errors';
import { createLocalWorkspaceRepository } from '../../workbench/infra/workspaceRepository';
import { memoryStorage } from '../../workbench/testSupport';
import {
	readOptionalNumber,
	readOptionalString,
	readString,
	resolveWorkspaceId,
	toErrorResult
} from './support';

function jsonOf(result: { content: { text: string }[] }): unknown {
	const first = result.content[0];
	if (!first) {
		throw new Error('ToolResult carried no content.');
	}
	return JSON.parse(first.text);
}

describe('toErrorResult', () => {
	it('test_toErrorResult_revisionConflictError_mapsToWireError', () => {
		const err = new RevisionConflictError(2, 3, ['scr_1']);
		const result = toErrorResult(err);
		expect(result.isError, 'a mapped typed error should be a tool failure').toBe(true);
		const payload = jsonOf(result) as Record<string, unknown>;
		expect(payload.error, 'expected the typed wire error code').toBe('revision_conflict');
		expect(payload.expected_revision, 'expected the conflict detail preserved').toBe(2);
	});

	it('test_toErrorResult_idempotencyConflictError_mapsToWireError', () => {
		const result = toErrorResult(new IdempotencyConflictError('key_1'));
		const payload = jsonOf(result) as Record<string, unknown>;
		expect(payload.error, 'expected the idempotency_conflict wire code').toBe(
			'idempotency_conflict'
		);
	});

	it('test_toErrorResult_undoTokenError_mapsToWireError', () => {
		const result = toErrorResult(new UndoTokenError('unknown'));
		const payload = jsonOf(result) as Record<string, unknown>;
		expect(payload.error, 'expected the undo_token_error wire code').toBe('undo_token_error');
	});

	it('test_toErrorResult_operationValidationError_mapsToWireError', () => {
		const result = toErrorResult(new OperationValidationError(['bad input']));
		const payload = jsonOf(result) as Record<string, unknown>;
		expect(payload.error, 'expected the operation_validation_error wire code').toBe(
			'operation_validation_error'
		);
	});

	it('test_toErrorResult_storageWriteError_mapsToWireError', () => {
		const result = toErrorResult(new StorageWriteError('disk full'));
		const payload = jsonOf(result) as Record<string, unknown>;
		expect(payload.error, 'expected the storage_write_failed wire code').toBe(
			'storage_write_failed'
		);
	});

	it('test_toErrorResult_plainError_fallsBackToMessage', () => {
		const result = toErrorResult(new Error('boom'));
		expect(result.isError, 'a generic Error should still be a tool failure').toBe(true);
		const payload = jsonOf(result) as Record<string, unknown>;
		expect(payload.error, 'expected the plain Error message as the wire error').toBe('boom');
	});

	it('test_toErrorResult_nonErrorThrown_stringifiesTheValue', () => {
		const result = toErrorResult('a rejected promise reason that is not an Error');
		const payload = jsonOf(result) as Record<string, unknown>;
		expect(
			payload.error,
			'a non-Error rejection reason (e.g. from a fake ScreenerMarketData) must still ' +
				'produce a readable tool error, never propagate as-is'
		).toBe('a rejected promise reason that is not an Error');
	});
});

describe('resolveWorkspaceId', () => {
	it('test_resolveWorkspaceId_explicitWorkspaceId_returnsIt', () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const id = resolveWorkspaceId({ repository }, { workspace_id: 'workspace_explicit' });
		expect(id, 'an explicit string workspace_id should win over the active workspace').toBe(
			'workspace_explicit'
		);
	});

	it('test_resolveWorkspaceId_noWorkspaceId_fallsBackToActiveWorkspace', () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.setActiveId('workspace_active');
		const id = resolveWorkspaceId({ repository }, {});
		expect(id, 'an omitted workspace_id should fall back to the active workspace').toBe(
			'workspace_active'
		);
	});

	it('test_resolveWorkspaceId_nonStringWorkspaceId_fallsBackToActiveWorkspace', () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		repository.setActiveId('workspace_active');
		const id = resolveWorkspaceId({ repository }, { workspace_id: 42 });
		expect(id, 'a non-string workspace_id must not be trusted as an id').toBe('workspace_active');
	});

	it('test_resolveWorkspaceId_noActiveWorkspace_returnsNull', () => {
		const repository = createLocalWorkspaceRepository(memoryStorage());
		const id = resolveWorkspaceId({ repository }, {});
		expect(id, 'with nothing active and nothing supplied, there is no workspace to resolve').toBe(
			null
		);
	});
});

describe('readString', () => {
	it('test_readString_stringValue_returnsIt', () => {
		expect(readString('scr_1'), 'a string value should pass through unchanged').toBe('scr_1');
	});

	it('test_readString_missingOrNonString_returnsEmptyString', () => {
		expect(readString(undefined), 'a missing value should read as empty string').toBe('');
		expect(readString(42), 'a non-string value should read as empty string').toBe('');
	});
});

describe('readOptionalString', () => {
	it('test_readOptionalString_stringValue_returnsIt', () => {
		expect(readOptionalString('key_1'), 'a string value should pass through unchanged').toBe(
			'key_1'
		);
	});

	it('test_readOptionalString_missingOrNonString_returnsUndefined', () => {
		expect(
			readOptionalString(undefined),
			'a missing value should read as undefined, not a default string'
		).toBeUndefined();
		expect(readOptionalString(7), 'a non-string value should read as undefined').toBeUndefined();
	});
});

describe('readOptionalNumber', () => {
	it('test_readOptionalNumber_numberValue_returnsIt', () => {
		expect(readOptionalNumber(3), 'a number value should pass through unchanged').toBe(3);
	});

	it('test_readOptionalNumber_missingOrNonNumber_returnsUndefined', () => {
		expect(
			readOptionalNumber(undefined),
			'a missing value should read as undefined, not a default number'
		).toBeUndefined();
		expect(readOptionalNumber('3'), 'a non-number value should read as undefined').toBeUndefined();
	});
});
