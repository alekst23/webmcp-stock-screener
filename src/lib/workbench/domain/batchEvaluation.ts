// The single evaluation path preview and apply share: fold a proposed batch
// over a copy of the workspace state using the registered operation handlers,
// producing a candidate next state plus per-operation outcomes -- and changing
// nothing live. See docs/design/safety-preview-apply/technical.md, "The
// central decision: one evaluation path".
//
// Type-only import across the layer boundary: the registry's *shape* is part
// of the contract, but no application-layer value is pulled into the domain.
import type { OperationRegistry } from '../application/operationRegistry';
import type { IdSequencer, ResourceId } from './ids';
import type {
	ChangeBatch,
	OperationFailure,
	OperationOutcome,
	OperationWarning,
	ProposedOperation
} from './preview';
import { SafetyError } from './previewErrors';
import type { WorkspaceDocument } from './workspace';

export interface BatchEvaluation {
	// null whenever `failures` is non-empty, so a caller holding an
	// inapplicable evaluation has nothing it could commit even by mistake.
	candidate: WorkspaceDocument | null;
	outcomes: OperationOutcome[];
	failures: OperationFailure[];
	warnings: OperationWarning[];
	affectedIds: ResourceId[];
	// One per successfully applied operation, for a caller rendering a
	// human-readable summary of the batch.
	fragments: string[];
}

export interface BatchEvaluationDeps {
	registry: OperationRegistry;
	// Threaded through to handlers only; see the note on evaluateBatch.
	ids: IdSequencer;
}

interface EvaluationStep {
	// The state the next operation folds over: the handler's output on
	// success, the unchanged last-known-good document on failure.
	document: WorkspaceDocument;
	outcome: OperationOutcome;
	affectedIds: ResourceId[];
	// null for a failed operation, which produced no diff summary to render.
	fragment: string | null;
}

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function failedStep(
	document: WorkspaceDocument,
	index: number,
	kind: string,
	describe: string,
	reason: string
): EvaluationStep {
	return {
		document,
		outcome: { index, kind, describe, failures: [{ index, kind, reason }], warnings: [] },
		affectedIds: [],
		fragment: null
	};
}

// Handlers are not guaranteed pure: the operation registry's contract allows
// a handler to have side effects and to mutate the document it is handed. So
// every handler gets its own deep structural clone and never sees a document
// any other code holds a reference to. Two properties depend on this: the
// caller's live state survives evaluation untouched, and a handler that
// mutates its input before throwing cannot corrupt the known-good state the
// fold continues from.
function evaluateOperation(
	operation: ProposedOperation,
	index: number,
	document: WorkspaceDocument,
	deps: BatchEvaluationDeps
): EvaluationStep {
	const kind = operation.kind;
	const definition = deps.registry.get(kind);
	if (!definition) {
		const label = `Unknown operation kind "${kind}".`;
		return failedStep(document, index, kind, label, `unknown operation kind: ${kind}`);
	}
	const working = structuredClone(document);
	let describe = `Evaluate ${kind}.`;
	try {
		const issues = definition.validate(operation.input, working);
		describe = definition.describe(operation.input, working);
		if (issues.length > 0) {
			return failedStep(document, index, kind, describe, issues.join('; '));
		}
		const draft = definition.apply(operation.input, working, deps.ids);
		return {
			document: draft.document,
			outcome: {
				index,
				kind,
				describe,
				failures: [],
				warnings: (draft.warnings ?? []).map((message) => ({ index, kind, message }))
			},
			affectedIds: [...draft.affectedIds],
			fragment: draft.diffSummary
		};
	} catch (err) {
		// A throwing validator or describe() is this operation's failure, not
		// the whole evaluation's crash.
		return failedStep(document, index, kind, describe, describeError(err));
	}
}

function dedupe(ids: readonly ResourceId[]): ResourceId[] {
	const seen = new Set<ResourceId>();
	const out: ResourceId[] = [];
	for (const id of ids) {
		if (!seen.has(id)) {
			seen.add(id);
			out.push(id);
		}
	}
	return out;
}

// Evaluates `batch` against `document` without touching `document`. Handlers
// are resolved by kind from the registry at evaluation time, so a kind
// registered by a sibling epic needs no change here.
//
// This function never calls `ids.next()` itself -- it takes an IdSequencer
// solely to thread one through to `OperationDefinition.apply`, whose
// signature requires it. The distinction matters: the IDs a handler mints
// here are exactly the IDs apply commits, because apply commits the stored
// candidate rather than re-folding the batch.
export function evaluateBatch(
	batch: ChangeBatch,
	document: WorkspaceDocument,
	deps: BatchEvaluationDeps
): BatchEvaluation {
	if (batch.length === 0) {
		throw SafetyError.invalidInput('Cannot evaluate an empty batch of operations.');
	}
	let current = document;
	const outcomes: OperationOutcome[] = [];
	const failures: OperationFailure[] = [];
	const warnings: OperationWarning[] = [];
	const collectedIds: ResourceId[] = [];
	const fragments: string[] = [];
	batch.forEach((operation, index) => {
		const step = evaluateOperation(operation, index, current, deps);
		current = step.document;
		outcomes.push(step.outcome);
		failures.push(...step.outcome.failures);
		warnings.push(...step.outcome.warnings);
		collectedIds.push(...step.affectedIds);
		if (step.fragment !== null) {
			fragments.push(step.fragment);
		}
	});
	return {
		candidate: failures.length === 0 ? current : null,
		outcomes,
		failures,
		warnings,
		affectedIds: dedupe(collectedIds),
		fragments
	};
}
