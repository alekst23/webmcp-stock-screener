// `create_screener` (T-1009-3): mints a screener bound to the active
// workspace, at screener revision 1 with an empty filter tree and a default
// universe, and stores it under WorkspaceDocument.extensions.screener
// (T-1009-1's state module). Routes through EPIC-1006's recordCommit, the
// program's single write path -- this file reimplements none of revision
// checking, idempotency replay, or undo-token issuance.

import { recordCommit } from '../../workbench/application/changeHistory';
import { toWireEnvelope } from '../../workbench/domain/mutation';
import type { WorkbenchDeps } from '../../workbench/tools/index';
import { createScreener as mintScreener } from '../../screener/definition';
import { writeScreener } from '../../screener/state';
import type { ToolResult, ToolSpec } from '../types';
import { fail, ok } from '../tools';
import { resolveWorkspaceId, toErrorResult } from './support';

const DESCRIPTION =
	'Creates a screener bound to a workspace, at screener revision 1 with an empty filter ' +
	'tree and a default (empty) universe. An optional name is stored and echoed back but is ' +
	'a label only -- the returned screener_id (in affected_ids) is the only way to address ' +
	'this screener afterwards. Returns the mutation envelope; the new screener is undoable ' +
	'via undo_token. Defaults to the active workspace.';

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
		name: { type: 'string', description: 'A display label only, never an address.' },
		expected_revision: { type: 'number' },
		idempotency_key: { type: 'string' }
	}
};

function execute(deps: WorkbenchDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as {
			workspace_id?: string;
			name?: string;
			expected_revision?: number;
			idempotency_key?: string;
		};
		const workspaceId = resolveWorkspaceId(deps, input);
		if (!workspaceId) {
			return fail('No active workspace to create a screener in.', { error: 'not_found' });
		}
		const name = typeof input.name === 'string' && input.name.length > 0 ? input.name : null;

		try {
			const envelope = recordCommit(
				{ history: deps.history, revisionService: deps.revisions, clock: deps.clock },
				{
					workspaceId,
					context: {
						expectedRevision: input.expected_revision,
						idempotencyKey: input.idempotency_key,
						actor: 'agent'
					},
					operationKind: 'screener.create_screener',
					requestInput: { workspaceId, name },
					// `doc` is the pre-mutation document -- it provably does not yet
					// contain the screener minted below, so it is exactly the state
					// undo must restore to; no need to reconstruct it with
					// removeScreener.
					mutate: (doc) => {
						const screener = mintScreener(deps.ids, workspaceId, name);
						const document = writeScreener(doc, screener);
						const label = name ? `"${name}" (${screener.screenerId})` : screener.screenerId;
						return {
							document,
							affectedIds: [screener.screenerId],
							diffSummary: `Created screener ${label}.`,
							inverse: {
								document: doc,
								affectedIds: [screener.screenerId],
								diffSummary: `Removed screener ${screener.screenerId}.`
							}
						};
					}
				}
			);
			return ok(toWireEnvelope(envelope));
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

export function createCreateScreenerTool(deps: WorkbenchDeps): ToolSpec {
	return {
		name: 'create_screener',
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: execute(deps)
	};
}
