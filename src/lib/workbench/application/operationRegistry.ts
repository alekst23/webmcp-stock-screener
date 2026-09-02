// Extensible operation registry with preview and apply (T-1006-7). Nine
// sibling epics each register their own kind of change here and get
// preview, validation, atomic apply, revision guarding and undo for free.
import { OperationValidationError } from '../domain/errors';
import type { IdSequencer, ResourceId } from '../domain/ids';
import type { MutationContext, MutationEnvelope } from '../domain/mutation';
import type { Clock } from '../domain/ports';
import type { WorkspaceDocument } from '../domain/workspace';
import { recordCommit } from './changeHistory';
import type { ChangeHistory } from './changeHistory';
import type { MutationDraft, RevisionService } from './revisionService';

// Namespaced ('chart.add_study', 'screener.edit_filter_tree') so nine
// epics registering into one registry don't collide.
const OPERATION_KIND_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface OperationDefinition<TInput = unknown> {
	kind: string;
	inputSchema: object;
	validate(input: TInput, doc: WorkspaceDocument): string[]; // [] = valid
	describe(input: TInput, doc: WorkspaceDocument): string;
	apply(input: TInput, doc: WorkspaceDocument, ids: IdSequencer): MutationDraft;
}

export interface OperationRegistry {
	register<T>(definition: OperationDefinition<T>): void;
	get(kind: string): OperationDefinition | null;
	kinds(): string[];
}

export function createOperationRegistry(): OperationRegistry {
	const definitions = new Map<string, OperationDefinition>();
	return {
		register<T>(definition: OperationDefinition<T>): void {
			if (!OPERATION_KIND_PATTERN.test(definition.kind)) {
				throw new Error(
					`Operation kind "${definition.kind}" must be namespaced as "<area>.<action>".`
				);
			}
			if (definitions.has(definition.kind)) {
				throw new Error(`Operation kind "${definition.kind}" is already registered.`);
			}
			definitions.set(definition.kind, definition as OperationDefinition);
		},
		get(kind: string): OperationDefinition | null {
			return definitions.get(kind) ?? null;
		},
		kinds(): string[] {
			return [...definitions.keys()];
		}
	};
}

// A shared, convenient default. Tests should build their own via the
// factory rather than mutating this one, to stay order-independent.
export const operationRegistry: OperationRegistry = createOperationRegistry();

export interface OperationRequest {
	kind: string;
	input: unknown;
}

export interface PreviewResult {
	previewId: ResourceId;
	valid: boolean;
	affectedIds: ResourceId[];
	diffSummary: string;
	perOperation: { kind: string; describe: string; issues: string[] }[];
	warnings: string[];
	resultingRevision: number;
}

interface PreviewStep {
	kind: string;
	describe: string;
	issues: string[];
	draft: MutationDraft | null;
}

// Evaluates each operation against the state the preceding operations in
// the same collection would produce (T-1006-7 AC7). Never throws and never
// mutates `doc` -- an unregistered kind or a failing validate()/apply()
// becomes a per-operation issue, and the fold continues against the last
// known-good document rather than aborting the whole preview.
function foldForPreview(
	ops: OperationRequest[],
	doc: WorkspaceDocument,
	registry: OperationRegistry,
	ids: IdSequencer
): PreviewStep[] {
	let currentDoc = doc;
	const steps: PreviewStep[] = [];
	for (const op of ops) {
		const def = registry.get(op.kind);
		if (!def) {
			steps.push({
				kind: op.kind,
				describe: `Unknown operation: ${op.kind}.`,
				issues: [`unknown operation: ${op.kind}`],
				draft: null
			});
			continue;
		}
		try {
			const issues = def.validate(op.input, currentDoc);
			const describe = def.describe(op.input, currentDoc);
			if (issues.length > 0) {
				steps.push({ kind: op.kind, describe, issues, draft: null });
				continue;
			}
			const draft = def.apply(op.input, currentDoc, ids);
			currentDoc = draft.document;
			steps.push({ kind: op.kind, describe, issues: [], draft });
		} catch (err) {
			steps.push({
				kind: op.kind,
				describe: `Failed to evaluate ${op.kind}.`,
				issues: [err instanceof Error ? err.message : String(err)],
				draft: null
			});
		}
	}
	return steps;
}

export function previewOperations(
	ops: OperationRequest[],
	deps: { registry: OperationRegistry; document: WorkspaceDocument; ids: IdSequencer }
): PreviewResult {
	const steps = foldForPreview(ops, deps.document, deps.registry, deps.ids);
	const affectedIds = [...new Set(steps.flatMap((s) => s.draft?.affectedIds ?? []))];
	return {
		previewId: deps.ids.next('preview'),
		valid: steps.every((s) => s.issues.length === 0 && s.draft !== null),
		affectedIds,
		diffSummary: steps.map((s) => s.describe).join(' '),
		perOperation: steps.map((s) => ({ kind: s.kind, describe: s.describe, issues: s.issues })),
		warnings: [],
		resultingRevision: deps.document.revision + 1
	};
}

// Folds every operation over an in-memory copy of `doc`, throwing
// OperationValidationError on the first unknown kind, validation failure
// or apply() exception -- so applyOperations (which runs this inside
// RevisionService.commit's mutate) leaves the stored workspace untouched
// on any failure (T-1006-7 AC9).
function foldApply(
	ops: OperationRequest[],
	doc: WorkspaceDocument,
	registry: OperationRegistry,
	ids: IdSequencer
): MutationDraft {
	let currentDoc = doc;
	const affectedIds: ResourceId[] = [];
	const diffParts: string[] = [];
	const perOpDrafts: MutationDraft[] = [];
	for (const op of ops) {
		const def = registry.get(op.kind);
		if (!def) {
			throw new OperationValidationError([`unknown operation: ${op.kind}`]);
		}
		const issues = def.validate(op.input, currentDoc);
		if (issues.length > 0) {
			throw new OperationValidationError(issues);
		}
		const draft = def.apply(op.input, currentDoc, ids);
		perOpDrafts.push(draft);
		currentDoc = draft.document;
		affectedIds.push(...draft.affectedIds);
		diffParts.push(draft.diffSummary);
	}
	const allHaveInverse = perOpDrafts.every((d) => d.inverse);
	return {
		document: currentDoc,
		affectedIds: [...new Set(affectedIds)],
		diffSummary: diffParts.join(' '),
		// The pre-collection document is provably the correct combined
		// inverse target regardless of any single op's own inverse quality;
		// the per-operation inverses are still chained in reverse order for
		// the human-readable summary (T-1006-7's own guidance).
		inverse: allHaveInverse
			? {
					document: doc,
					affectedIds: [...new Set(affectedIds)],
					diffSummary: [...perOpDrafts]
						.reverse()
						.map((d) => d.inverse?.diffSummary ?? '')
						.join(' ')
						.trim()
				}
			: null
	};
}

export function applyOperations(
	ops: OperationRequest[],
	context: MutationContext,
	deps: {
		registry: OperationRegistry;
		workspaceId: ResourceId;
		history: ChangeHistory;
		revisionService: RevisionService;
		clock: Clock;
		ids: IdSequencer;
	}
): MutationEnvelope {
	if (ops.length === 0) {
		throw new OperationValidationError(['Cannot apply an empty collection of operations.']);
	}
	return recordCommit(deps, {
		workspaceId: deps.workspaceId,
		context,
		operationKind: 'workbench.apply_operations',
		requestInput: ops,
		mutate: (doc) => foldApply(ops, doc, deps.registry, deps.ids)
	});
}
