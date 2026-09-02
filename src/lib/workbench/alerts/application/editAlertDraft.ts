// The `alerts.edit_conditions` operation (T-1014-8 AC9, extended by
// T-1014-9 AC6). Renames and/or replaces an alert draft's source. A
// successful edit always writes back `state: 'draft'`, hard-coded, never
// derived from the existing record or from wire input -- so this tool can
// never leave (or put) an alert in any state other than 'draft'.
//
// Two states may be edited: 'draft' (the ordinary case) and
// 'pending_activation'. Editing a pending-activation alert is what AC6
// calls invalidating the request -- the underlying draft changes, so
// whatever the researcher would be confirming is no longer what they
// reviewed. This function drops the pending request and appends an
// 'invalidated' event to the alert's activation history; arming afterward
// requires calling enable_alert again and a fresh confirmation. 'armed' and
// 'disarmed' remain refused: an armed alert must be disabled first, and
// this ticket has no requirement to make a disarmed alert editable.
import type { CatalogRegistry } from '../../../catalog/registry';
import { readScreener } from '../../../screener/state';
import type { IdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import {
	readAlert,
	writeAlert,
	type AlertConditionSource,
	type AlertRecord
} from '../domain/alert';
import { appendActivationEvent } from '../domain/alertActivation';
import { isDraft, isPendingActivation } from '../domain/alertStateMachine';
import {
	alertSourceIssues,
	computeAlertPreviewability,
	resolveAlertSource,
	type AlertSourceWireInput
} from './prepareAlertSource';

export const ALERTS_EDIT_CONDITIONS_KIND = 'alerts.edit_conditions';

export interface EditAlertDraftInput {
	alertId: string;
	name: string;
	source: AlertConditionSource;
	previewable: boolean;
	previewProblems: string[];
}

function findEditableAlert(alertId: unknown, doc: WorkspaceDocument): AlertRecord | string {
	if (typeof alertId !== 'string' || alertId.length === 0) {
		return 'alert_id: expected an alert id.';
	}
	const alert = readAlert(doc, alertId);
	if (!alert) {
		return `alert_id: "${alertId}" is not an alert in this workspace.`;
	}
	if (!isDraft(alert.state) && !isPendingActivation(alert.state)) {
		return (
			`alert "${alertId}" is in state "${alert.state}"; only a draft or a pending activation ` +
			'request can be edited.'
		);
	}
	return alert;
}

function validateEditAlertDraft(input: EditAlertDraftInput, doc: WorkspaceDocument): string[] {
	const found = findEditableAlert(input.alertId, doc);
	if (typeof found === 'string') {
		return [found];
	}
	const issues: string[] =
		typeof input.name === 'string' && input.name.trim().length > 0
			? []
			: ['name: expected a non-empty string.'];
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

function applyEditAlertDraft(
	input: EditAlertDraftInput,
	doc: WorkspaceDocument,
	now: string
): MutationDraft {
	const existing = readAlert(doc, input.alertId);
	if (!existing) {
		// validate() already refused a missing alert; apply() is never called
		// after a validation failure, so this is unreachable in practice and
		// exists only so this function has no unsafe non-null assertion.
		throw new Error(
			`applyEditAlertDraft: alert "${input.alertId}" vanished between validate and apply.`
		);
	}
	// AC6: editing a pending-activation alert invalidates its request. This is
	// the only place that decides invalidation, and it is a fact about the
	// existing record's state -- never about wire input.
	const wasPending = isPendingActivation(existing.state);
	const activationHistory = wasPending
		? appendActivationEvent(existing.activationHistory, {
				kind: 'invalidated',
				at: now,
				actor: 'agent'
			})
		: existing.activationHistory;
	const nextDoc = writeAlert(doc, {
		...existing,
		name: input.name,
		source: input.source,
		previewable: input.previewable,
		previewProblems: input.previewProblems,
		// Hard-coded: an edit can only ever leave an alert in draft (AC9),
		// clearing any pending activation request along with it (AC6).
		state: 'draft',
		pendingActivation: null,
		activationHistory,
		updatedAt: now
	});
	const diffSummary = wasPending
		? `Edited alert draft ${input.alertId} ("${input.name}"); its pending activation request was ` +
			'invalidated and must be requested and confirmed again to arm it.'
		: `Edited alert draft ${input.alertId} ("${input.name}"), still not armed.`;
	return {
		document: nextDoc,
		affectedIds: [input.alertId],
		diffSummary,
		inverse: {
			document: doc,
			affectedIds: [input.alertId],
			diffSummary: `Reverted edit to alert draft ${input.alertId}.`
		}
	};
}

export function createEditAlertDraftOperation(deps: {
	clock: Clock;
}): OperationDefinition<EditAlertDraftInput> {
	return {
		kind: ALERTS_EDIT_CONDITIONS_KIND,
		inputSchema: {
			type: 'object',
			properties: {
				alertId: { type: 'string' },
				name: { type: 'string' },
				source: { type: 'object' },
				previewable: { type: 'boolean' },
				previewProblems: { type: 'array', items: { type: 'string' } }
			},
			required: ['alertId', 'name', 'source', 'previewable', 'previewProblems']
		},
		validate: validateEditAlertDraft,
		describe: (input) => `Edit alert draft ${input.alertId} ("${input.name}"), still not armed.`,
		apply: (input, doc, _ids) => applyEditAlertDraft(input, doc, deps.clock.now())
	};
}

export function ensureEditAlertDraftOperation(
	registry: OperationRegistry,
	deps: { clock: Clock }
): void {
	if (!registry.get(ALERTS_EDIT_CONDITIONS_KIND)) {
		registry.register(createEditAlertDraftOperation(deps));
	}
}

export type PrepareEditAlertDraftOutcome =
	{ ok: true; prepared: EditAlertDraftInput } | { ok: false; issues: string[] };

// The async half, mirroring prepareCreateAlertDraft. `name`/`screener_id`/
// `conditions` are each optional on an edit -- omitted means "keep the
// existing value" for name, and "keep the existing source" when *both*
// screener_id and conditions are omitted. Giving both at once is refused as
// ambiguous, same as create.
export async function prepareEditAlertDraft(
	rawInput: { alert_id: unknown; name?: unknown } & AlertSourceWireInput,
	doc: WorkspaceDocument,
	options?: { registry?: CatalogRegistry }
): Promise<PrepareEditAlertDraftOutcome> {
	const found = findEditableAlert(rawInput.alert_id, doc);
	if (typeof found === 'string') {
		return { ok: false, issues: [found] };
	}
	const existing = found;

	const hasScreenerId = rawInput.screener_id !== undefined;
	const hasConditions = rawInput.conditions !== undefined;
	const changingSource = hasScreenerId || hasConditions;
	if (hasScreenerId && hasConditions) {
		return {
			ok: false,
			issues: [
				"Give at most one of screener_id or conditions when replacing an alert draft's source."
			]
		};
	}
	if (!changingSource && rawInput.name === undefined) {
		return { ok: false, issues: ['Nothing to edit: give name, screener_id, or conditions.'] };
	}

	const nameIssues =
		rawInput.name === undefined
			? []
			: typeof rawInput.name === 'string' && rawInput.name.trim().length > 0
				? []
				: ['name: expected a non-empty string.'];
	const sourceIssues = changingSource ? alertSourceIssues(rawInput, doc) : [];
	if (nameIssues.length > 0 || sourceIssues.length > 0) {
		return { ok: false, issues: [...nameIssues, ...sourceIssues] };
	}

	const name = typeof rawInput.name === 'string' ? rawInput.name.trim() : existing.name;
	const source = changingSource ? resolveAlertSource(rawInput, doc) : existing.source;
	const previewability = changingSource
		? await computeAlertPreviewability(source, doc.id, options)
		: { previewable: existing.previewable, previewProblems: existing.previewProblems };

	return {
		ok: true,
		prepared: {
			alertId: existing.alertId,
			name,
			source,
			previewable: previewability.previewable,
			previewProblems: previewability.previewProblems
		}
	};
}
