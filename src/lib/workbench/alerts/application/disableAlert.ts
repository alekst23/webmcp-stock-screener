// The `alerts.disable_activation` operation, backing the `disable_alert`
// tool (T-1014-9 AC8, AC9, AC11). The asymmetric counterpart to
// enableAlert.ts: disarming needs no human confirmation, because it only
// ever reduces what an agent can cause.
//
// SAFETY: this operation's MutationDraft always sets `inverse: null`,
// deliberately and unconditionally, on every code path. Undo is
// implemented program-wide as "apply the inverse draft", and
// ChangeHistory's undo_change tool additionally lets an agent undo an undo
// (which redoes the original change) -- so if disabling produced a normal
// inverse back to 'armed', an agent could reach 'armed' with two
// tool-reachable undo_change calls and no human confirmation at all:
// disable_alert, undo_change(token) [-> armed], nothing else needed. Setting
// inverse: null closes that path structurally: there is no undo token for
// disabling at all (the envelope's undo_token is null, matching the
// program's existing "null means genuinely not undoable" convention), so
// undo_change has nothing to redeem it with. Do not add an inverse here.
import type { IdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import { appendActivationEvent } from '../domain/alertActivation';
import { isArmed, isDisarmed } from '../domain/alertStateMachine';

export const ALERTS_DISABLE_ACTIVATION_KIND = 'alerts.disable_activation';

export interface DisableAlertInput {
	alertId: string;
}

function findDisableableAlert(alertId: unknown, doc: WorkspaceDocument): AlertRecord | string {
	if (typeof alertId !== 'string' || alertId.length === 0) {
		return 'alert_id: expected an alert id.';
	}
	const alert = readAlert(doc, alertId);
	if (!alert) {
		return `alert_id: "${alertId}" is not an alert in this workspace.`;
	}
	if (!isArmed(alert.state) && !isDisarmed(alert.state)) {
		return (
			`alert "${alertId}" is in state "${alert.state}"; disable_alert only applies to an armed ` +
			'(or already disarmed) alert.'
		);
	}
	return alert;
}

function validateDisableAlert(input: DisableAlertInput, doc: WorkspaceDocument): string[] {
	const found = findDisableableAlert(input.alertId, doc);
	return typeof found === 'string' ? [found] : [];
}

function applyDisableAlert(
	input: DisableAlertInput,
	doc: WorkspaceDocument,
	now: string
): MutationDraft {
	const existing = readAlert(doc, input.alertId);
	if (!existing) {
		// validate() already refused a missing alert; apply() is never called
		// after a validation failure, so this is unreachable in practice.
		throw new Error(
			`applyDisableAlert: alert "${input.alertId}" vanished between validate and apply.`
		);
	}
	if (isDisarmed(existing.state)) {
		// AC9: idempotent no-op. Nothing changed, so there is nothing to
		// undo either way -- inverse: null here for the same reason as below.
		return {
			document: doc,
			affectedIds: [input.alertId],
			diffSummary: `Alert ${input.alertId} ("${existing.name}") is already disarmed; no change.`,
			inverse: null
		};
	}
	const nextDoc = writeAlert(doc, {
		...existing,
		state: 'disarmed',
		activationHistory: appendActivationEvent(existing.activationHistory, {
			kind: 'disarmed',
			at: now,
			actor: 'agent'
		}),
		updatedAt: now
	});
	return {
		document: nextDoc,
		affectedIds: [input.alertId],
		diffSummary: `Disarmed alert ${input.alertId} ("${existing.name}"); it will no longer fire.`,
		// Deliberately non-undoable -- see this file's header comment.
		inverse: null
	};
}

export function createDisableAlertOperation(deps: {
	clock: Clock;
}): OperationDefinition<DisableAlertInput> {
	return {
		kind: ALERTS_DISABLE_ACTIVATION_KIND,
		inputSchema: {
			type: 'object',
			properties: { alertId: { type: 'string' } },
			required: ['alertId']
		},
		validate: validateDisableAlert,
		describe: (input) => `Disarm alert ${input.alertId}; no human confirmation required.`,
		apply: (input, doc, _ids: IdSequencer) => applyDisableAlert(input, doc, deps.clock.now())
	};
}

export function ensureDisableAlertOperation(
	registry: OperationRegistry,
	deps: { clock: Clock }
): void {
	if (!registry.get(ALERTS_DISABLE_ACTIVATION_KIND)) {
		registry.register(createDisableAlertOperation(deps));
	}
}
