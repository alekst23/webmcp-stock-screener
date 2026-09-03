// Wires the safety layer's two use cases -- preview a batch, then apply
// exactly what was previewed -- onto the WebMCP tool surface (T-1013-6).
// Pure wiring: the guarantees themselves (honesty, non-mutation, atomicity,
// freshness, typed-operations-only) live in application/safetyUseCases.ts
// and its collaborators. See docs/design/safety-preview-apply/spec.md.
import { fail, ok } from '../../webmcp/toolResult';
import type { ToolResult, ToolSpec } from '../../webmcp/types';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError,
	StorageWriteError,
	UndoTokenError
} from '../domain/errors';
import { toWireEnvelope } from '../domain/mutation';
import { toWirePreviewResult } from '../domain/preview';
import type { ChangeBatch } from '../domain/preview';
import { SafetyError } from '../domain/previewErrors';
import { applyPreviewedChanges, previewWorkspaceChanges } from '../application/safetyUseCases';
import type { SafetyDeps } from '../application/safetyUseCases';

export interface SafetyToolDeps extends SafetyDeps {}

// A local copy of tools/index.ts's toErrorResult mapping, plus SafetyError:
// that file is EPIC-1006's shared composition-root surface and this ticket
// must touch it minimally, so the mapping is duplicated here in miniature
// rather than imported.
function toErrorResult(err: unknown): ToolResult {
	if (
		err instanceof SafetyError ||
		err instanceof RevisionConflictError ||
		err instanceof IdempotencyConflictError ||
		err instanceof UndoTokenError ||
		err instanceof OperationValidationError ||
		err instanceof StorageWriteError
	) {
		return fail(err.message, err.toWireError());
	}
	return fail(err instanceof Error ? err.message : String(err));
}

// Built from the live registry at buildSafetyTools call time, never at
// module load, so kinds a sibling epic registers after this module is
// imported -- or a test's own throwaway registry -- are described
// accurately. No operation-kind string is literal in this file.
function operationKindSchema(deps: SafetyDeps): object {
	const kinds = deps.registry.kinds();
	if (kinds.length === 0) {
		return {
			type: 'string',
			description: 'A registered operation kind. No operation kinds are currently registered.'
		};
	}
	return {
		type: 'string',
		enum: kinds,
		description: `A registered operation kind. Currently registered: ${kinds.join(', ')}.`
	};
}

function previewDescription(deps: SafetyDeps): string {
	const kinds = deps.registry.kinds();
	const registeredText = kinds.length > 0 ? kinds.join(', ') : '(none registered yet)';
	return (
		'Validates an ordered batch of proposed operations against the current workspace and ' +
		'returns the resulting diff, affected ids, a human-readable summary, warnings and ' +
		'per-operation outcomes -- without changing anything. The batch order is significant: ' +
		"each operation is evaluated against the previous operation's effect, so a later " +
		'operation can depend on an earlier one landing first. Every operation must name a ' +
		'registered kind; a kind not in the registry is reported as a validation failure in the ' +
		`result and is never executed. Currently registered kinds: ${registeredText}.`
	);
}

// Wire `arguments` -> the domain ProposedOperation.input. Structural
// problems (not an array, a missing/non-string kind) are the caller's
// mistake, reported the same way an empty batch is -- as invalid input,
// never forwarded to evaluation.
function toChangeBatch(rawOperations: unknown): ChangeBatch {
	if (!Array.isArray(rawOperations)) {
		throw SafetyError.invalidInput('operations must be an array.');
	}
	return rawOperations.map((entry, index) => {
		if (typeof entry !== 'object' || entry === null) {
			throw SafetyError.invalidInput(`operations[${index}] must be an object.`);
		}
		const kind = (entry as { kind?: unknown }).kind;
		if (typeof kind !== 'string') {
			throw SafetyError.invalidInput(`operations[${index}].kind must be a string.`);
		}
		const args = (entry as { arguments?: unknown }).arguments;
		return { kind, input: args ?? {} };
	});
}

function previewWorkspaceChangesTool(deps: SafetyDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as { operations?: unknown; workspace_id?: unknown };
		try {
			const batch = toChangeBatch(input.operations);
			const result = previewWorkspaceChanges(
				{
					batch,
					workspaceId: typeof input.workspace_id === 'string' ? input.workspace_id : undefined
				},
				deps
			);
			return ok(toWirePreviewResult(result));
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

function applyPreviewedChangesTool(deps: SafetyDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as {
			preview_id?: unknown;
			expected_revision?: unknown;
			idempotency_key?: unknown;
		};
		if (typeof input.preview_id !== 'string') {
			return toErrorResult(
				SafetyError.invalidInput('preview_id is required and must be a string.')
			);
		}
		try {
			const envelope = applyPreviewedChanges(
				{
					previewId: input.preview_id,
					expectedRevision:
						typeof input.expected_revision === 'number' ? input.expected_revision : undefined,
					idempotencyKey:
						typeof input.idempotency_key === 'string' ? input.idempotency_key : undefined
				},
				deps
			);
			return ok(toWireEnvelope(envelope));
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const always = () => true;

export function buildSafetyTools(deps: SafetyDeps): ToolSpec[] {
	return [
		{
			name: 'preview_workspace_changes',
			description: previewDescription(deps),
			inputSchema: {
				type: 'object',
				properties: {
					operations: {
						type: 'array',
						minItems: 1,
						description:
							'Ordered batch of proposed operations. Order is significant: operations are ' +
							"evaluated in the order given, and each one sees the previous operation's effect.",
						items: {
							type: 'object',
							properties: {
								kind: operationKindSchema(deps),
								arguments: {
									type: 'object',
									description:
										"The operation kind's own arguments; their shape is defined by that " +
										"kind's own validator, not by this tool."
								}
							},
							required: ['kind']
						}
					},
					workspace_id: { type: 'string', description: 'Defaults to the active workspace.' }
				},
				required: ['operations']
			},
			available: always,
			execute: previewWorkspaceChangesTool(deps)
		},
		{
			name: 'apply_previewed_changes',
			description:
				'Atomically commits a batch previously validated by preview_workspace_changes. ' +
				'Returns the common mutation envelope, whose affected ids, diff summary and change ' +
				'match exactly what the preview reported. Fails without mutating anything if the ' +
				"workspace has moved past the preview's base revision, if expected_revision does not " +
				'match, or if the preview is unknown, expired, already applied, or not applicable.',
			inputSchema: {
				type: 'object',
				properties: {
					preview_id: { type: 'string', description: 'Id returned by preview_workspace_changes.' },
					expected_revision: {
						type: 'number',
						description: 'Optional precondition; must match the previewed base revision.'
					},
					idempotency_key: {
						type: 'string',
						description: 'Optional; a repeated key replays the original result verbatim.'
					}
				},
				required: ['preview_id']
			},
			available: always,
			execute: applyPreviewedChangesTool(deps)
		}
	];
}
