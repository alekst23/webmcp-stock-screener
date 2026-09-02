// The `alerts.enable_activation` operation, backing the `enable_alert` tool
// (T-1014-9 AC1, AC6, AC7, AC11). This is the ONLY tool-reachable code that
// can write a 'pending_activation' state, and it deliberately cannot go any
// further: `apply()` below hard-codes `state: 'pending_activation'` and
// never `'armed'`. There is no branch, no adversarial input, and no
// downstream call in this file that reaches 'armed' -- that transition is
// implemented exclusively in application/confirmAlertActivation.ts, a
// module this file does not import and that is never wired to a ToolSpec.
// See alertActivationSafety.test.ts for the adversarial proof.
import type { IdSequencer } from '../../domain/ids';
import type { Clock } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { OperationDefinition, OperationRegistry } from '../../application/operationRegistry';
import type { MutationDraft } from '../../application/revisionService';
import { readAlert, writeAlert, type AlertRecord } from '../domain/alert';
import {
	appendActivationEvent,
	computeActivationExpiry,
	isActivationRequestExpired
} from '../domain/alertActivation';
import { isDraft, isPendingActivation } from '../domain/alertStateMachine';

export const ALERTS_ENABLE_ACTIVATION_KIND = 'alerts.enable_activation';

export interface EnableAlertInput {
	alertId: string;
}

// A draft may always request activation. An alert already pending may only
// request again once its existing request has expired -- otherwise it is
// refused, since two live requests for the same alert would make "which
// request did the researcher review" ambiguous. Armed and disarmed alerts
// cannot request activation at all: an armed alert is already active, and a
// disarmed one has no defined re-arm path in this ticket's scope.
function findRequestableAlert(
	alertId: unknown,
	doc: WorkspaceDocument,
	now: string
): AlertRecord | string {
	if (typeof alertId !== 'string' || alertId.length === 0) {
		return 'alert_id: expected an alert id.';
	}
	const alert = readAlert(doc, alertId);
	if (!alert) {
		return `alert_id: "${alertId}" is not an alert in this workspace.`;
	}
	if (isDraft(alert.state)) {
		return alert;
	}
	if (isPendingActivation(alert.state)) {
		if (alert.pendingActivation && isActivationRequestExpired(alert.pendingActivation, now)) {
			return alert;
		}
		return (
			`alert "${alertId}" already has a pending activation request; confirm or decline it in ` +
			"the app's alerts surface, or wait for it to expire, before requesting again."
		);
	}
	return `alert "${alertId}" is in state "${alert.state}"; only a draft can request activation.`;
}

function validateEnableAlert(
	input: EnableAlertInput,
	doc: WorkspaceDocument,
	now: string
): string[] {
	const found = findRequestableAlert(input.alertId, doc, now);
	return typeof found === 'string' ? [found] : [];
}

function applyEnableAlert(
	input: EnableAlertInput,
	doc: WorkspaceDocument,
	now: string
): MutationDraft {
	const existing = readAlert(doc, input.alertId);
	if (!existing) {
		// validate() already refused a missing alert; apply() is never called
		// after a validation failure, so this is unreachable in practice.
		throw new Error(
			`applyEnableAlert: alert "${input.alertId}" vanished between validate and apply.`
		);
	}
	const wasExpiredPending =
		isPendingActivation(existing.state) &&
		existing.pendingActivation !== null &&
		isActivationRequestExpired(existing.pendingActivation, now);
	let activationHistory = existing.activationHistory;
	if (wasExpiredPending) {
		activationHistory = appendActivationEvent(activationHistory, {
			kind: 'expired',
			at: now,
			actor: 'agent'
		});
	}
	activationHistory = appendActivationEvent(activationHistory, {
		kind: 'requested',
		at: now,
		actor: 'agent'
	});
	const nextDoc = writeAlert(doc, {
		...existing,
		// Hard-coded: this operation can only ever produce 'pending_activation',
		// never 'armed' -- see this file's header comment.
		state: 'pending_activation',
		pendingActivation: { requestedAt: now, expiresAt: computeActivationExpiry(now) },
		activationHistory,
		updatedAt: now
	});
	return {
		document: nextDoc,
		affectedIds: [input.alertId],
		diffSummary:
			`Requested activation for alert ${input.alertId} ("${existing.name}"). Not armed: a ` +
			"human must confirm this request in the app's alerts surface before it can fire.",
		// Undoing this only ever restores the pre-request document (draft, or
		// an earlier expired-pending state) -- never 'armed'. Safe to leave
		// undoable (AC12).
		inverse: {
			document: doc,
			affectedIds: [input.alertId],
			diffSummary: `Cleared the pending activation request for alert ${input.alertId}.`
		}
	};
}

export function createEnableAlertOperation(deps: {
	clock: Clock;
}): OperationDefinition<EnableAlertInput> {
	return {
		kind: ALERTS_ENABLE_ACTIVATION_KIND,
		inputSchema: {
			type: 'object',
			properties: { alertId: { type: 'string' } },
			required: ['alertId']
		},
		validate: (input, doc) => validateEnableAlert(input, doc, deps.clock.now()),
		describe: (input) =>
			`Request activation for alert ${input.alertId}; not armed until a human confirms.`,
		apply: (input, doc, _ids: IdSequencer) => applyEnableAlert(input, doc, deps.clock.now())
	};
}

export function ensureEnableAlertOperation(
	registry: OperationRegistry,
	deps: { clock: Clock }
): void {
	if (!registry.get(ALERTS_ENABLE_ACTIVATION_KIND)) {
		registry.register(createEnableAlertOperation(deps));
	}
}
