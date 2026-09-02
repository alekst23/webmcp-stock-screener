// The `alerts.create_draft` operation (T-1014-8, AC1-3, AC11). A draft's
// state is hard-coded to INITIAL_ALERT_STATE ('draft') here, never read from
// wire input -- see alertStateMachine.ts for why that is the whole safety
// property, not an incidental detail.
//
// Two-phase, mirroring chart/application/captureSetup.ts: `prepareCreateAlertDraft`
// (async) resolves the source and runs the not-previewable check before the tool
// calls `applyOperations`; the registered operation's `apply()` is then a pure,
// synchronous write over the already-resolved input.
import type { CatalogRegistry } from '../../../catalog/registry';
import { readScreener } from '../../../screener/state';
import type { IdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import { writeAlert, type AlertConditionSource } from '../domain/alert';
import { INITIAL_ALERT_STATE } from '../domain/alertStateMachine';
import {
	alertSourceIssues,
	computeAlertPreviewability,
	resolveAlertSource,
	type AlertSourceWireInput
} from './prepareAlertSource';

export const ALERTS_CREATE_DRAFT_KIND = 'alerts.create_draft';

export interface CreateAlertDraftInput {
	name: string;
	source: AlertConditionSource;
	previewable: boolean;
	previewProblems: string[];
}

function nameIssues(name: unknown): string[] {
	return typeof name === 'string' && name.trim().length > 0
		? []
		: ['name: expected a non-empty string.'];
}

// Re-derives the structural half of what the async prepare phase already
// checked, over the already-resolved input, so a caller reaching the
// registry directly (bypassing the tool's prepare step) cannot store a draft
// whose source names a screener this workspace does not have.
function validateCreateAlertDraft(input: CreateAlertDraftInput, doc: WorkspaceDocument): string[] {
	const issues = nameIssues(input.name);
	if (input.source.kind === 'screener_revision') {
		if (!readScreener(doc, input.source.screenerId)) {
			issues.push(
				`source: screener "${input.source.screenerId}" is not a screener in this workspace.`
			);
		}
	} else if (input.source.conditions.length === 0) {
		issues.push('source: conditions must not be empty.');
	}
	return issues;
}

function applyCreateAlertDraft(
	input: CreateAlertDraftInput,
	doc: WorkspaceDocument,
	ids: IdSequencer,
	now: string
): MutationDraft {
	const alertId = ids.next('alert');
	const nextDoc = writeAlert(doc, {
		alertId,
		workspaceId: doc.id,
		name: input.name,
		// Hard-coded, never taken from `input`: the one and only state this
		// operation can ever produce.
		state: INITIAL_ALERT_STATE,
		source: input.source,
		previewable: input.previewable,
		previewProblems: input.previewProblems,
		// A freshly created draft has never had an activation request.
		pendingActivation: null,
		activationHistory: [],
		createdAt: now,
		updatedAt: now
	});
	return {
		document: nextDoc,
		affectedIds: [alertId],
		diffSummary: `Created alert draft ${alertId} ("${input.name}"), not armed.`,
		// A create only ever adds one record, so the pre-create document is
		// exactly its own inverse -- undoing removes the draft, matching AC11.
		inverse: {
			document: doc,
			affectedIds: [alertId],
			diffSummary: `Discarded alert draft ${alertId}.`
		}
	};
}

export function createCreateAlertDraftOperation(deps: {
	clock: Clock;
}): OperationDefinition<CreateAlertDraftInput> {
	return {
		kind: ALERTS_CREATE_DRAFT_KIND,
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				source: { type: 'object' },
				previewable: { type: 'boolean' },
				previewProblems: { type: 'array', items: { type: 'string' } }
			},
			required: ['name', 'source', 'previewable', 'previewProblems']
		},
		validate: validateCreateAlertDraft,
		describe: (input) => `Draft alert "${input.name}", not armed.`,
		apply: (input, doc, ids) => applyCreateAlertDraft(input, doc, ids, deps.clock.now())
	};
}

export function ensureCreateAlertDraftOperation(
	registry: OperationRegistry,
	deps: { clock: Clock }
): void {
	if (!registry.get(ALERTS_CREATE_DRAFT_KIND)) {
		registry.register(createCreateAlertDraftOperation(deps));
	}
}

export interface PrepareCreateAlertDraftOutcome {
	ok: true;
	prepared: CreateAlertDraftInput;
}

export interface PrepareCreateAlertDraftFailure {
	ok: false;
	issues: string[];
}

// The async half: resolves the source from wire input and runs the
// not-previewable check (AC8), which needs EPIC-1009's async
// `validateScreenerDefinition`. Returns structural issues instead of
// resolving when the wire input itself is unusable, so the tool never calls
// applyOperations with a source it could not build.
export async function prepareCreateAlertDraft(
	rawInput: { name: unknown } & AlertSourceWireInput,
	doc: WorkspaceDocument,
	options?: { registry?: CatalogRegistry }
): Promise<PrepareCreateAlertDraftOutcome | PrepareCreateAlertDraftFailure> {
	const issues = [...nameIssues(rawInput.name), ...alertSourceIssues(rawInput, doc)];
	if (issues.length > 0) {
		return { ok: false, issues };
	}
	const source = resolveAlertSource(rawInput, doc);
	const previewability = await computeAlertPreviewability(source, doc.id, options);
	return {
		ok: true,
		prepared: {
			name: (rawInput.name as string).trim(),
			source,
			previewable: previewability.previewable,
			previewProblems: previewability.previewProblems
		}
	};
}
