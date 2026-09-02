// AC1: validate kind, initial source/renderer, and configuration; resolve
// a footprint (explicit or auto-chosen); validate placement; mint a
// stable ID; add the panel. Any failure below leaves the workspace
// untouched -- everything happens before commitPanelChange's `build`
// returns, so a throw here means recordCommit never writes anything.
import { validatePlacement } from '../domain/layout';
import { makePanel, type Panel, type PanelSourceRef } from '../domain/panel';
import type { GridRect } from '../domain/grid';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { PanelOperationError } from './errors';
import {
	commitPanelChange,
	requireKnownRenderer,
	requirePanelKind,
	resolveAutoRect,
	visibleOccupied,
	throwPlacementViolation,
	type PanelUseCaseDeps
} from './support';

export interface CreatePanelRequest {
	context: MutationContext;
	kind: string;
	title?: string;
	config?: Record<string, unknown>;
	source?: { type: string; ref: Record<string, unknown> } | null;
	renderer?: string | null;
	rect?: GridRect;
}

function resolveSource(
	deps: PanelUseCaseDeps,
	kind: string,
	renderer: string | null,
	requested: CreatePanelRequest['source']
): PanelSourceRef | null {
	if (!requested) {
		return null;
	}
	const validation = deps.sourceRenderer.validateSource({
		source: requested,
		panelKind: kind,
		renderer
	});
	if (!validation.ok) {
		throw new PanelOperationError('invalid_source', 'Source is not accepted for this panel.', {
			errors: validation.errors,
			acceptedSourceTypes: validation.acceptedSourceTypes
		});
	}
	return validation.value;
}

export function createPanel(deps: PanelUseCaseDeps, request: CreatePanelRequest): MutationEnvelope {
	return commitPanelChange(deps, request.context, 'panels.create_panel', request, (_doc, state) => {
		const kindDef = requirePanelKind(deps.kinds, request.kind);
		const renderer = request.renderer !== undefined ? request.renderer : kindDef.defaultRenderer;
		if (renderer !== null) {
			requireKnownRenderer(deps.sourceRenderer, renderer);
		}
		const source = resolveSource(deps, request.kind, renderer, request.source);

		const config = request.config ?? kindDef.defaultConfig();
		const configValidation = kindDef.validateConfig(config);
		if (!configValidation.ok) {
			throw new PanelOperationError(
				'invalid_config',
				`Configuration rejected for panel kind "${request.kind}".`,
				{
					errors: configValidation.errors
				}
			);
		}

		const occupied = visibleOccupied(state.panels);
		const rect = request.rect ?? resolveAutoRect(kindDef.defaultSize, occupied);
		const placement = validatePlacement({ rect, minSize: kindDef.minSize, occupied });
		if (!placement.ok) {
			throwPlacementViolation(placement.violation);
		}

		const id = deps.ids.next('panel', request.kind);
		const panel: Panel = makePanel({
			id,
			kind: request.kind,
			title: request.title ?? kindDef.defaultTitle,
			config: configValidation.value,
			rect,
			source,
			renderer
		});

		return {
			nextState: { ...state, panels: [...state.panels, panel] },
			affectedIds: [id],
			diffSummary: `Added ${request.kind} panel "${panel.title}" at column ${rect.col}, row ${rect.row}.`
		};
	});
}
