// T-1014-3: a derived filter tree is a first-class, editable draft -- never a
// screener with a flag on it. This module owns where a draft lives inside a
// WorkspaceDocument and how it moves in and out, mirroring EPIC-1011's
// capturedSetup.ts pattern exactly: self-contained, normalize-on-read,
// copy-on-write.
//
// A draft's conditions are EPIC-1009's own FilterNode tree, unmodified. What
// this module adds on top is provenance: which characteristic of the source
// setup produced each node, carried as a parallel array rather than a field
// on ConditionNode -- that type belongs to EPIC-1009 and is not changed here.
//
// Domain layer: no I/O, no import from infra.
import type { ResourceId } from '../../domain/ids';
import type { WorkspaceDocument } from '../../domain/workspace';
import { normalizeCondition } from '../../../screener/conditions';
import type { FilterNode, GroupOp } from '../../../screener/definition';

export const FILTER_DRAFT_EXTENSION_KEY = 'filter_drafts';

export interface DraftConditionProvenance {
	nodeId: ResourceId;
	// A short machine-facing tag for the kind of setup characteristic this
	// came from ('study' | 'annotation.price_level' | 'annotation.trendline' |
	// 'annotation.label'), so a caller can group or filter provenance entries
	// without parsing prose.
	characteristic: string;
	// The prose a researcher reads to judge and prune the condition (AC3).
	explanation: string;
}

export interface FilterDraft {
	draftId: ResourceId;
	sourceSetupId: ResourceId;
	createdAt: string;
	// The workspace revision the source setup was read at, informational only
	// (matches capturedSetup.ts's own workspaceRevision field).
	sourceRevision: number;
	// Optional hint carried from derivation time; accept() still requires its
	// own explicit target_screener_id rather than trusting this silently.
	targetScreenerId?: ResourceId;
	tree: FilterNode;
	provenance: DraftConditionProvenance[];
	acceptedAt?: string;
	acceptedScreenerId?: ResourceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Duplicated from screener/definition.ts's private normalizeFilterNode /
// normalizeGroupNode / normalizeConditionNode rather than requesting an
// export be added there -- that file belongs to already-merged EPIC-1009 and
// this ticket does not modify sibling-epic code. Same never-throw,
// drop-what-cannot-be-understood behavior as the original.
export function normalizeDraftFilterNode(value: unknown): FilterNode | null {
	if (!isRecord(value)) {
		return null;
	}
	const nodeId = value.nodeId;
	if (typeof nodeId !== 'string' || nodeId.length === 0) {
		return null;
	}
	const enabled = value.enabled !== false;
	if (value.kind === 'group') {
		const op: GroupOp = value.op === 'or' ? 'or' : value.op === 'not' ? 'not' : 'and';
		const children = Array.isArray(value.children)
			? value.children
					.map((child) => normalizeDraftFilterNode(child))
					.filter((child): child is FilterNode => child !== null)
			: [];
		const repairedChildren = op === 'not' ? children.slice(0, 1) : children;
		const repairedOp: GroupOp = op === 'not' && repairedChildren.length === 0 ? 'and' : op;
		return { nodeId, kind: 'group', op: repairedOp, children: repairedChildren, enabled };
	}
	if (value.kind === 'condition') {
		const condition = normalizeCondition(value.condition);
		return condition === null ? null : { nodeId, kind: 'condition', condition, enabled };
	}
	return null;
}

function normalizeProvenanceArray(value: unknown): DraftConditionProvenance[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: DraftConditionProvenance[] = [];
	for (const entry of value) {
		if (
			isRecord(entry) &&
			typeof entry.nodeId === 'string' &&
			typeof entry.characteristic === 'string' &&
			typeof entry.explanation === 'string'
		) {
			out.push({
				nodeId: entry.nodeId,
				characteristic: entry.characteristic,
				explanation: entry.explanation
			});
		}
	}
	return out;
}

// Never throws: a draft that cannot be read back as a complete record
// normalizes to null rather than half-restored, matching capturedSetup.ts's
// own convention.
export function normalizeFilterDraft(value: unknown): FilterDraft | null {
	if (!isRecord(value) || typeof value.draftId !== 'string' || value.draftId.length === 0) {
		return null;
	}
	if (typeof value.sourceSetupId !== 'string' || value.sourceSetupId.length === 0) {
		return null;
	}
	const tree = normalizeDraftFilterNode(value.tree);
	if (!tree) {
		return null;
	}
	return {
		draftId: value.draftId,
		sourceSetupId: value.sourceSetupId,
		createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
		sourceRevision: typeof value.sourceRevision === 'number' ? value.sourceRevision : 0,
		...(typeof value.targetScreenerId === 'string'
			? { targetScreenerId: value.targetScreenerId }
			: {}),
		tree,
		provenance: normalizeProvenanceArray(value.provenance),
		...(typeof value.acceptedAt === 'string' ? { acceptedAt: value.acceptedAt } : {}),
		...(typeof value.acceptedScreenerId === 'string'
			? { acceptedScreenerId: value.acceptedScreenerId }
			: {})
	};
}

function draftExtension(doc: WorkspaceDocument): Record<string, unknown> {
	const raw = doc.extensions[FILTER_DRAFT_EXTENSION_KEY];
	return isRecord(raw) ? raw : {};
}

export function readFilterDraft(doc: WorkspaceDocument, draftId: ResourceId): FilterDraft | null {
	return normalizeFilterDraft(draftExtension(doc)[draftId]);
}

export function readFilterDrafts(doc: WorkspaceDocument): FilterDraft[] {
	const out: FilterDraft[] = [];
	for (const entry of Object.values(draftExtension(doc))) {
		const draft = normalizeFilterDraft(entry);
		if (draft) {
			out.push(draft);
		}
	}
	return out;
}

// Pure: never mutates `doc`; each layer is shallow-cloned before the new
// entry is added.
export function writeFilterDraft(doc: WorkspaceDocument, draft: FilterDraft): WorkspaceDocument {
	const normalized = normalizeFilterDraft(draft) ?? draft;
	const map = { ...draftExtension(doc), [normalized.draftId]: normalized };
	return { ...doc, extensions: { ...doc.extensions, [FILTER_DRAFT_EXTENSION_KEY]: map } };
}

function toWireProvenance(entry: DraftConditionProvenance): Record<string, unknown> {
	return {
		node_id: entry.nodeId,
		characteristic: entry.characteristic,
		explanation: entry.explanation
	};
}

export function toWireFilterDraft(draft: FilterDraft): Record<string, unknown> {
	const wire: Record<string, unknown> = {
		draft_id: draft.draftId,
		source_setup_id: draft.sourceSetupId,
		created_at: draft.createdAt,
		source_revision: draft.sourceRevision,
		tree: draft.tree,
		provenance: draft.provenance.map(toWireProvenance)
	};
	if (draft.targetScreenerId !== undefined) {
		wire.target_screener_id = draft.targetScreenerId;
	}
	if (draft.acceptedAt !== undefined) {
		wire.accepted_at = draft.acceptedAt;
	}
	if (draft.acceptedScreenerId !== undefined) {
		wire.accepted_screener_id = draft.acceptedScreenerId;
	}
	return wire;
}

// High-water mark for createIdSequencer, mirroring capturedSetupIdSeed: a
// reloaded workspace never mints a draft ID an existing draft already holds.
export function filterDraftIdSeed(doc: WorkspaceDocument): Record<string, number> {
	const seed: Record<string, number> = {};
	for (const draftId of Object.keys(draftExtension(doc))) {
		const parts = draftId.split('_');
		if (parts.length !== 3 || parts[0] !== 'filter' || parts[1] !== 'draft') {
			continue;
		}
		const sequence = Number.parseInt(parts[2] ?? '', 10);
		if (Number.isFinite(sequence)) {
			seed['filter:draft'] = Math.max(seed['filter:draft'] ?? 0, sequence);
		}
	}
	return seed;
}
