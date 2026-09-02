// The mutation envelope every mutating tool in the program returns (T-1006-2).
// One shape for all ~33 tools: change id, new revision, affected ids, a
// human diff summary, warnings and an undo token. See
// docs/reference/tool-spec.md's "Common contract for every tool".
import type { ResourceId } from './ids';
import type { Revision } from './workspace';

export type Actor = 'human' | 'agent';

export interface MutationEnvelope {
	changeId: ResourceId;
	newRevision: Revision;
	affectedIds: ResourceId[];
	// One present-tense sentence for a human. Not a serialized patch.
	diffSummary: string;
	warnings: string[];
	// null (not just optional) so "no token" is explicit and distinguishable
	// from an empty string, per T-1006-2 AC2.
	undoToken: ResourceId | null;
}

export interface MutationContext {
	expectedRevision?: Revision;
	idempotencyKey?: string;
	actor: Actor;
}

export function buildEnvelope(input: {
	changeId: ResourceId;
	newRevision: Revision;
	affectedIds: ResourceId[];
	diffSummary: string;
	warnings?: string[];
	undoToken?: ResourceId | null;
}): MutationEnvelope {
	return {
		changeId: input.changeId,
		newRevision: input.newRevision,
		affectedIds: input.affectedIds,
		diffSummary: input.diffSummary,
		warnings: input.warnings ?? [],
		undoToken: input.undoToken ?? null
	};
}

export interface WireMutationEnvelope {
	change_id: string;
	new_revision: number;
	affected_ids: string[];
	diff_summary: string;
	warnings: string[];
	undo_token: string | null;
}

// The only function in the epic allowed to emit snake_case keys.
export function toWireEnvelope(envelope: MutationEnvelope): WireMutationEnvelope {
	return {
		change_id: envelope.changeId,
		new_revision: envelope.newRevision,
		affected_ids: envelope.affectedIds,
		diff_summary: envelope.diffSummary,
		warnings: envelope.warnings,
		undo_token: envelope.undoToken
	};
}
