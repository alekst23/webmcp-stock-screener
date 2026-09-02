// Shared plumbing every use case builds on: the injected dependency
// bundle, the recordCommit wrapper that reads/writes PanelSystemState
// and wires up the "pre-mutation document" inverse, and the small
// validation helpers that turn wave-1's own typed failures into
// PanelOperationError so every panel-specific failure has one shape.
import { recordCommit } from '../../workbench/application/changeHistory';
import type { ChangeHistory } from '../../workbench/application/changeHistory';
import type { RevisionService } from '../../workbench/application/revisionService';
import type { IdSequencer, ResourceId } from '../../workbench/domain/ids';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import type { Clock, WorkspaceRepository } from '../../workbench/domain/ports';
import type { WorkspaceDocument } from '../../workbench/domain/workspace';
import {
	applyLayout,
	findFreeRect,
	type OccupiedRect,
	type PlacementViolation
} from '../domain/layout';
import type { GridSize } from '../domain/grid';
import type { LinkFailure } from '../domain/links';
import type { Panel } from '../domain/panel';
import { type LayoutTemplateRegistry, UnknownLayoutTemplateError } from '../domain/layoutTemplates';
import {
	type PanelRegistry,
	UnknownPanelKindError,
	type PanelKindDefinition
} from '../registry/panelKindRegistry';
import type { SourceRendererRegistry } from '../registry/sourceRendererRegistry';
import { PanelOperationError } from './errors';
import { readPanelState, writePanelState, type PanelSystemState } from './panelState';

export interface PanelUseCaseDeps {
	workspaceId: ResourceId;
	repository: WorkspaceRepository;
	revisions: RevisionService;
	history: ChangeHistory;
	clock: Clock;
	ids: IdSequencer;
	kinds: PanelRegistry;
	sourceRenderer: SourceRendererRegistry;
	templates: LayoutTemplateRegistry;
}

export interface PanelMutationResult {
	nextState: PanelSystemState;
	affectedIds: ResourceId[];
	diffSummary: string;
	warnings?: string[];
}

// Every use case's entire integration with EPIC-1006: load the current
// doc (recordCommit/RevisionService already did that), read the panel
// state out of it, hand both to `build`, project the result back onto
// the document, and set the pre-mutation document as the inverse -- the
// ticket's "simplest correct inverse". If `build` throws, none of this
// runs and recordCommit never writes anything (all-or-nothing).
export function commitPanelChange(
	deps: PanelUseCaseDeps,
	context: MutationContext,
	operationKind: string,
	requestInput: unknown,
	build: (doc: WorkspaceDocument, state: PanelSystemState) => PanelMutationResult
): MutationEnvelope {
	return recordCommit(
		{ history: deps.history, revisionService: deps.revisions, clock: deps.clock },
		{
			workspaceId: deps.workspaceId,
			context,
			operationKind,
			requestInput,
			mutate: (doc) => {
				const state = readPanelState(doc);
				const result = build(doc, state);
				const nextDoc = writePanelState(doc, result.nextState);
				return {
					document: nextDoc,
					affectedIds: result.affectedIds,
					diffSummary: result.diffSummary,
					warnings: result.warnings,
					inverse: {
						document: doc,
						affectedIds: result.affectedIds,
						diffSummary: `Reverted: ${result.diffSummary}`
					}
				};
			}
		}
	);
}

export function requirePanelKind(kinds: PanelRegistry, kind: string): PanelKindDefinition {
	try {
		return kinds.require(kind);
	} catch (err) {
		if (err instanceof UnknownPanelKindError) {
			throw new PanelOperationError('unknown_panel_kind', err.message, {
				registeredKinds: err.registeredKinds
			});
		}
		throw err;
	}
}

export function requireLayoutTemplateOrThrow(
	templates: LayoutTemplateRegistry,
	name: string
): ReturnType<LayoutTemplateRegistry['require']> {
	try {
		return templates.require(name);
	} catch (err) {
		if (err instanceof UnknownLayoutTemplateError) {
			throw new PanelOperationError('unknown_layout_template', err.message, {
				registeredTemplates: err.registeredTemplates
			});
		}
		throw err;
	}
}

export function requireKnownRenderer(
	sourceRenderer: SourceRendererRegistry,
	renderer: string
): void {
	if (sourceRenderer.getRendererType(renderer) === undefined) {
		throw new PanelOperationError(
			'unknown_renderer_type',
			`Unknown renderer type "${renderer}". Registered renderer types: ${sourceRenderer.rendererTypeNames().join(', ') || '(none)'}.`,
			{ registeredTypes: sourceRenderer.rendererTypeNames() }
		);
	}
}

export function findPanel(state: PanelSystemState, panelId: string): Panel {
	const panel = state.panels.find((p) => p.id === panelId);
	if (!panel) {
		throw new PanelOperationError('unknown_panel', `Unknown panel "${panelId}".`, { panelId });
	}
	return panel;
}

// Hidden panels never occupy grid cells: every placement check filters
// down to visible panels first.
export function visibleOccupied(panels: Panel[]): OccupiedRect[] {
	return panels.filter((p) => !p.hidden).map((p) => ({ panelId: p.id, rect: p.rect }));
}

export function throwPlacementViolation(violation: PlacementViolation): never {
	const { code, message, ...details } = violation;
	throw new PanelOperationError(code, message, details);
}

export function throwLinkFailure(failure: LinkFailure): never {
	const { code, message, ...details } = failure;
	throw new PanelOperationError(
		code === 'unknown_panel' ? 'unknown_link_panel' : code,
		message,
		details
	);
}

// Shared by setPanelLayout and applyLayoutTemplate: batch-move/resize
// against visible-only occupancy (hidden panels never block a placement),
// throwing a PanelOperationError on the first violation rather than
// returning a result the caller has to re-check.
export function applyLayoutBatch(
	panels: Panel[],
	placements: { panelId: string; rect: OccupiedRect['rect']; minSize: GridSize }[]
): OccupiedRect[] {
	const result = applyLayout(visibleOccupied(panels), placements);
	if (!result.ok) {
		throwPlacementViolation(result.violation);
	}
	return result.rects;
}

// A panel's config is one shared object, but it only ever holds fields
// from ONE contract at a time in practice: the kind's own (freshly
// created) or the active renderer's (after a renderer-specific
// mutation) -- kind and renderer schemas are disjoint field sets (e.g.
// chart's {symbol,timeframe,studies} vs. chart_grid's
// {rows,columns,...}). configureChartGrid/configurePanelView merge new
// fields onto whatever of the CURRENT config the active renderer's own
// contract already recognizes, via a self-migration, rather than the raw
// stored config -- otherwise a leftover kind-level field (or a prior
// renderer's field survived from before a switch) would fail validation
// against a schema it was never meant to satisfy.
export function recognizedRendererConfig(
	sourceRenderer: SourceRendererRegistry,
	renderer: string,
	config: Record<string, unknown>
): Record<string, unknown> {
	return sourceRenderer.migrateConfig({ from: renderer, to: renderer, config }).config;
}

export function resolveAutoRect(size: GridSize, occupied: OccupiedRect[]): OccupiedRect['rect'] {
	const rect = findFreeRect(size, occupied);
	if (rect === null) {
		throw new PanelOperationError(
			'grid_full',
			`The grid is full: no free ${size.colSpan}x${size.rowSpan} rect is available.`,
			{ requestedSize: size }
		);
	}
	return rect;
}
