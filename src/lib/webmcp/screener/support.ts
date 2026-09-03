// Shared helpers across the six screener WebMCP tools (T-1009-10
// consolidation): a toErrorResult typed-error mapper, a resolveWorkspaceId
// reader, and the snake_case wire-argument readers repeated across
// create_screener, edit_filter_tree, set_screener_ranking,
// set_screener_universe, validate_screener and run_screener. Each tool
// module used to carry its own private copy -- createScreener.ts's original
// comment explains why, back when there was only one occurrence -- but with
// six copies the project's "consolidate at 3+ occurrences" rule applies.
// Pure refactor: every helper here behaves exactly like the copy it
// replaces; nothing here changes wire behavior.

import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError,
	StorageWriteError,
	UndoTokenError
} from '../../workbench/domain/errors';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { fail } from '../toolResult';
import type { ToolResult } from '../types';

// Maps a typed T-1006-2 error to the tool failure shape; anything else
// (including a rejected ScreenerMarketData promise reaching a tool's
// execute() uncaught) falls back to its message rather than propagating as
// an unhandled rejection.
export function toErrorResult(err: unknown): ToolResult {
	if (
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

// Only `repository` is read, so any deps object carrying at least that much
// (every screener tool's deps type does) satisfies this without importing
// the full WorkbenchDeps shape at every call site.
export function resolveWorkspaceId(
	deps: Pick<WorkbenchDeps, 'repository'>,
	input: { workspace_id?: unknown }
): string | null {
	if (typeof input.workspace_id === 'string') {
		return input.workspace_id;
	}
	return deps.repository.getActiveId();
}

// Reads a single wire argument out of an `unknown`-typed input field --
// every RawInput/*WireInput interface in this directory types its optional
// properties as `unknown` (the wire payload is never trusted), so these take
// the field value directly rather than a keyed lookup, sidestepping any
// noUncheckedIndexedAccess concern entirely.
export function readOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

// screener_id's convention across these tools: an absent or non-string
// value reads as '', which each caller then treats as "missing" via a
// truthiness check, matching the original inline `typeof x === 'string' ?
// x : ''` this replaces.
export function readString(value: unknown): string {
	return readOptionalString(value) ?? '';
}

export function readOptionalNumber(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}
