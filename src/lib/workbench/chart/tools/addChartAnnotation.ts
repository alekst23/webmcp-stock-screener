// The `add_chart_annotation` tool: the agent's drawing hand.
//
// Every mutation runs through the registered `chart.add_annotation`
// operation rather than a parallel write path, so revision guarding,
// idempotency replay and the undo token come from EPIC-1006 rather than from
// here. This module only translates between the wire's snake_case and the
// operation's input, and turns typed errors into tool failures.
import { fail, ok } from '../../../webmcp/tools';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import {
	IdempotencyConflictError,
	OperationValidationError,
	RevisionConflictError,
	StorageWriteError,
	UndoTokenError
} from '../../domain/errors';
import { isResourceId } from '../../domain/ids';
import type { IdSequencer, ResourceId } from '../../domain/ids';
import { toWireEnvelope } from '../../domain/mutation';
import type { Clock, WorkspaceRepository } from '../../domain/ports';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { ChangeHistory } from '../../application/changeHistory';
import { applyOperations } from '../../application/operationRegistry';
import type { OperationRegistry } from '../../application/operationRegistry';
import type { RevisionService } from '../../application/revisionService';
import type { AnnotationKind, ChartAnnotation } from '../domain/annotations';
import {
	ADD_CHART_ANNOTATION_SCHEMA,
	CHART_ADD_ANNOTATION_KIND,
	ensureAddChartAnnotationOperation,
	readChartAnnotationsView,
	staleAnnotationWarnings
} from '../application/chartAnnotations';
import type { AddChartAnnotationInput } from '../application/chartAnnotations';

export const ADD_CHART_ANNOTATION_TOOL_NAME = 'add_chart_annotation';

export interface AddChartAnnotationDeps {
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	registry: OperationRegistry;
	clock: Clock;
	ids: IdSequencer;
}

interface WireInput {
	workspace_id?: string;
	panel_id: string;
	kind: AnnotationKind;
	anchors: unknown;
	label?: string;
	expected_revision?: number;
	idempotency_key?: string;
}

function toErrorResult(err: unknown): ToolResult {
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

// snake_case is emitted here and only here for the annotation payload, the
// way toWireEnvelope owns it for the envelope.
export function toWireAnnotation(annotation: ChartAnnotation, stale: boolean) {
	return {
		annotation_id: annotation.id,
		kind: annotation.kind,
		anchors: annotation.anchors,
		price_adjustment: annotation.priceAdjustment,
		stale,
		...(annotation.label !== undefined ? { label: annotation.label } : {})
	};
}

// The read half of the tool's answer: the drawing that was just added plus
// every drawing now on the panel, each carrying whether the chart's
// adjustment policy has moved on since it was drawn.
function annotationsPayload(
	doc: WorkspaceDocument,
	panelId: ResourceId,
	newId: ResourceId,
	envelopeWarnings: readonly string[]
) {
	const view = readChartAnnotationsView(doc, panelId);
	const created = view.annotations.find((entry) => entry.annotation.id === newId);
	const stale = staleAnnotationWarnings(
		view.annotations.map((entry) => entry.annotation),
		view.priceAdjustment
	);
	return {
		panel_id: panelId,
		price_adjustment: view.priceAdjustment,
		annotation: created ? toWireAnnotation(created.annotation, created.stale) : null,
		annotations: view.annotations.map((entry) => toWireAnnotation(entry.annotation, entry.stale)),
		stale_annotation_ids: view.staleIds,
		warnings: [...new Set([...envelopeWarnings, ...stale])]
	};
}

function toOperationInput(input: WireInput): AddChartAnnotationInput {
	return {
		panelId: input.panel_id,
		kind: input.kind,
		anchors: input.anchors,
		...(input.label !== undefined ? { label: input.label } : {})
	};
}

function addChartAnnotation(deps: AddChartAnnotationDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as WireInput;
		const workspaceId = input.workspace_id ?? deps.repository.getActiveId();
		if (!workspaceId) {
			return notFound('No active workspace.');
		}
		try {
			const envelope = applyOperations(
				[{ kind: CHART_ADD_ANNOTATION_KIND, input: toOperationInput(input) }],
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
			const doc = deps.repository.get(workspaceId);
			// By kind, not by position: affected_ids also carries the panel.
			const newId = envelope.affectedIds.find((id) => isResourceId(id, 'annotation')) ?? '';
			return ok({
				...toWireEnvelope(envelope),
				...(doc ? annotationsPayload(doc, input.panel_id, newId, envelope.warnings) : {})
			});
		} catch (err) {
			return toErrorResult(err);
		}
	};
}

const DESCRIPTION =
	'Draw on a chart panel: a trendline between two time-and-price points, a horizontal price ' +
	'level, a shaded date range, a text label, or a highlighted setup window. Anchors are given ' +
	'in data coordinates (ISO times and prices), so an annotation stays attached to the same ' +
	'bars when the visible range moves. Returns the mutation envelope with the new annotation id ' +
	"in affected_ids, plus the panel's annotations, each flagged stale when it was drawn under a " +
	"different price-adjustment policy than the chart's current one.";

// Registers its own operation when the caller's registry does not already
// carry it, so the tool is usable on its own; a composition root that
// registers the chart operations up front still wins.
export function buildAddChartAnnotationTool(deps: AddChartAnnotationDeps): ToolSpec {
	ensureAddChartAnnotationOperation(deps.registry, { clock: deps.clock });
	return {
		name: ADD_CHART_ANNOTATION_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: ADD_CHART_ANNOTATION_SCHEMA,
		available: () => true,
		execute: addChartAnnotation(deps)
	};
}
