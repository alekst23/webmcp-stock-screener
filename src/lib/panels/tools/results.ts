// Local ok/fail shaping, deliberately not imported from
// src/lib/webmcp/tools.ts -- this surface is a standalone parallel
// implementation (EPIC-1015 retires the legacy one separately).
import type { ToolResult } from '../../webmcp/types';
import { PanelOperationError } from '../application';
import {
	IdempotencyConflictError,
	RevisionConflictError,
	StorageWriteError
} from '../../workbench/domain/errors';

export function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function fail(message: string, extra?: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
		isError: true
	};
}

// AC9/AC10: every closed-set catalog (registered kinds, source/renderer
// types, template names, supported channels, grid bounds/occupant,
// rejected field paths) already lives on the error's own toWireError() --
// surfaced verbatim, never rebuilt. RevisionConflictError and
// IdempotencyConflictError carry their own `error` discriminator so a
// conflict, a replay, and a plain validation failure are each
// distinguishable by the agent.
export function toErrorResult(err: unknown): ToolResult {
	if (
		err instanceof PanelOperationError ||
		err instanceof RevisionConflictError ||
		err instanceof IdempotencyConflictError ||
		err instanceof StorageWriteError
	) {
		return fail(err.message, err.toWireError());
	}
	return fail(err instanceof Error ? err.message : String(err));
}
