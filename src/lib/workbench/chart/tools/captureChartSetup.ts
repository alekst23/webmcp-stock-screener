// The `capture_chart_setup` tool: the hand-off point of the whole program.
//
// What it writes is EPIC-1012's input, so the tool answers with the record as
// it was read back out of the workspace -- through the same normalizer a
// reloaded workspace goes through -- rather than with the object it just built.
// A payload that came straight from memory would prove nothing about whether
// the record survives persistence, which is exactly what the consumer depends
// on.
//
// Every mutation runs through the registered `chart.capture_setup` operation
// rather than a parallel write path, so revision guarding, idempotency replay
// and the undo token come from EPIC-1006. This module only translates between
// the wire's snake_case and the operation's input, and turns typed errors into
// tool failures.
import { fail, ok } from '../../../webmcp/toolResult';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError,
	StorageWriteError,
	UndoTokenError
} from '../../domain/errors';
import { isResourceId } from '../../domain/ids';
import type { IdSequencer } from '../../domain/ids';
import { toWireEnvelope } from '../../domain/mutation';
import type { MutationEnvelope } from '../../domain/mutation';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { ChangeHistory } from '../../application/changeHistory';
import { applyOperations } from '../../application/operationRegistry';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import { CaptureSetupError, readCapturedSetup, toWireCapturedSetup } from '../domain/capturedSetup';
import type { Normalization } from '../domain/instrument';
import type { ChartSeriesPort } from '../domain/seriesPort';
import {
	CAPTURE_CHART_SETUP_SCHEMA,
	CHART_CAPTURE_SETUP_KIND,
	ensureCaptureChartSetupOperation,
	prepareCapture
} from '../application/captureSetup';
import type {
	CaptureChartSetupInput,
	PrepareCaptureRefusal,
	PreparedCapture
} from '../application/captureSetup';

export const CAPTURE_CHART_SETUP_TOOL_NAME = 'capture_chart_setup';

export interface CaptureChartSetupDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
	series: ChartSeriesPort;
}

interface WireInput {
	workspace_id?: string;
	panel_id: string;
	name?: string;
	notes?: string;
	anchor_time?: string;
	normalization?: Normalization;
	expected_revision?: number;
	idempotency_key?: string;
}

function toErrorResult(err: unknown): ToolResult {
	if (err instanceof CaptureSetupError) {
		return fail(err.message, err.toWireError());
	}
	if (
		err instanceof RevisionConflictError ||
		err instanceof IdempotencyConflictError ||
		err instanceof UndoTokenError ||
		err instanceof OperationValidationError ||
		err instanceof StorageWriteError
	) {
		return fail(err.message, err.toWireError());
	}
	return fail(err instanceof Error ? err.message : String(err));
}

// `fail` lets `extra` overwrite its own `error` key, so a wire error code has
// to carry the sentence with it or the human-readable message is lost.
function notFound(message: string): ToolResult {
	return fail(message, { error: 'not_found', message });
}

function refusalResult(refusal: PrepareCaptureRefusal): ToolResult {
	return fail(refusal.message, {
		error: refusal.reason,
		reason: refusal.reason,
		message: refusal.message,
		remedies: refusal.remedies,
		...(refusal.panelId !== undefined ? { panel_id: refusal.panelId } : {})
	});
}

function toOperationInput(input: WireInput, prepared: PreparedCapture): CaptureChartSetupInput {
	return {
		panelId: input.panel_id,
		window: prepared.window,
		provenance: prepared.provenance,
		...(input.normalization !== undefined ? { normalization: input.normalization } : {}),
		...(input.name !== undefined ? { name: input.name } : {}),
		...(input.notes !== undefined ? { notes: input.notes } : {})
	};
}

function captureChartSetup(deps: CaptureChartSetupDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as WireInput;
		const workspaceId = input.workspace_id ?? deps.repository.getActiveId();
		if (!workspaceId) {
			return notFound('No active workspace.');
		}
		try {
			const outcome = await prepareCapture(deps, {
				panelId: input.panel_id,
				workspaceId,
				...(input.anchor_time !== undefined ? { anchorTime: input.anchor_time } : {})
			});
			if (!outcome.ok) {
				return refusalResult(outcome.refusal);
			}
			const envelope = applyOperations(
				[{ kind: CHART_CAPTURE_SETUP_KIND, input: toOperationInput(input, outcome.prepared) }],
				{
					expectedRevision: input.expected_revision,
					idempotencyKey: input.idempotency_key,
					actor: 'agent'
				},
				{
					registry: deps.registry,
					workspaceId,
					history: deps.history,
					revisionService: deps.revisions,
					clock: deps.clock,
					ids: deps.ids
				}
			);
			return ok(setupPayload(deps, workspaceId, envelope, outcome.prepared));
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

function setupPayload(
	deps: CaptureChartSetupDeps,
	workspaceId: string,
	envelope: MutationEnvelope,
	prepared: PreparedCapture
): Record<string, unknown> {
	const doc = deps.repository.get(workspaceId);
	// By kind, not by position: affected_ids also carries the source panel.
	const setupId = envelope.affectedIds.find((id) => isResourceId(id, 'setup')) ?? '';
	const stored = doc ? readCapturedSetup(doc, setupId) : null;
	return {
		...toWireEnvelope(envelope),
		setup_id: setupId,
		source_panel_id: prepared.panelId,
		setup: stored ? toWireCapturedSetup(stored) : null,
		warnings: [...new Set([...envelope.warnings, ...prepared.warnings])]
	};
}

const DESCRIPTION =
	'Freeze what a chart panel is currently showing into a named, ID-addressable reference ' +
	'setup: the instrument, the historical window with its timeframe and session, the candle ' +
	'type and scale, the normalization, the ordered studies with resolved parameters, the ' +
	'comparison instruments, the price-adjustment policy, any drawings, and the provenance of ' +
	'the data it was taken from. The record is self-contained — reconfiguring or deleting the ' +
	'source panel afterwards never changes it — and is what similarity search runs from. ' +
	'Capturing twice yields two distinct setup ids. Returns the mutation envelope with the new ' +
	'setup id in affected_ids and an undo_token that discards the capture.';

// Registers its own operation when the caller's registry does not already
// carry it, so the tool is usable on its own; a composition root that
// registers the chart operations up front still wins.
export function buildCaptureChartSetupTool(deps: CaptureChartSetupDeps): ToolSpec {
	ensureCaptureChartSetupOperation(deps.registry, { clock: deps.clock });
	return {
		name: CAPTURE_CHART_SETUP_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: CAPTURE_CHART_SETUP_SCHEMA,
		available: () => true,
		execute: captureChartSetup(deps)
	};
}
