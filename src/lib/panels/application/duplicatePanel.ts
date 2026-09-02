// AC2: copy an existing panel's kind, configuration, source, and
// renderer to a new panel with a fresh ID and an auto-chosen footprint of
// the same size, optionally overriding the symbol (a config.symbol
// convenience many kinds declare) or the source. The original is never
// touched -- this only ever appends to state.panels.
import { validatePlacement } from '../domain/layout';
import { makePanel, type Panel } from '../domain/panel';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { PanelOperationError } from './errors';
import {
	commitPanelChange,
	findPanel,
	requirePanelKind,
	resolveAutoRect,
	throwPlacementViolation,
	visibleOccupied,
	type PanelUseCaseDeps
} from './support';

export interface DuplicatePanelRequest {
	context: MutationContext;
	panelId: string;
	symbolOverride?: string;
	sourceOverride?: { type: string; ref: Record<string, unknown> } | null;
}

function resolveConfig(
	deps: PanelUseCaseDeps,
	original: Panel,
	symbolOverride: string | undefined
): Record<string, unknown> {
	if (symbolOverride === undefined) {
		return original.config;
	}
	const candidate = { ...original.config, symbol: symbolOverride };
	const kindDef = requirePanelKind(deps.kinds, original.kind);
	const validation = kindDef.validateConfig(candidate);
	if (!validation.ok) {
		throw new PanelOperationError(
			'invalid_config',
			`Symbol override rejected for panel "${original.id}".`,
			{
				errors: validation.errors
			}
		);
	}
	return validation.value;
}

function resolveSource(
	deps: PanelUseCaseDeps,
	original: Panel,
	sourceOverride: DuplicatePanelRequest['sourceOverride']
): Panel['source'] {
	if (sourceOverride === undefined) {
		return original.source;
	}
	if (sourceOverride === null) {
		return null;
	}
	const validation = deps.sourceRenderer.validateSource({
		source: sourceOverride,
		panelKind: original.kind,
		renderer: original.renderer
	});
	if (!validation.ok) {
		throw new PanelOperationError(
			'invalid_source',
			'Source override is not accepted for this panel.',
			{
				errors: validation.errors,
				acceptedSourceTypes: validation.acceptedSourceTypes
			}
		);
	}
	return validation.value;
}

export function duplicatePanel(
	deps: PanelUseCaseDeps,
	request: DuplicatePanelRequest
): MutationEnvelope {
	return commitPanelChange(
		deps,
		request.context,
		'panels.duplicate_panel',
		request,
		(_doc, state) => {
			const original = findPanel(state, request.panelId);
			const kindDef = requirePanelKind(deps.kinds, original.kind);

			const config = resolveConfig(deps, original, request.symbolOverride);
			const source = resolveSource(deps, original, request.sourceOverride);

			const size = { colSpan: original.rect.colSpan, rowSpan: original.rect.rowSpan };
			const occupied = visibleOccupied(state.panels);
			const rect = resolveAutoRect(size, occupied);
			const placement = validatePlacement({ rect, minSize: kindDef.minSize, occupied });
			if (!placement.ok) {
				throwPlacementViolation(placement.violation);
			}

			const id = deps.ids.next('panel', original.kind);
			const panel = makePanel({
				id,
				kind: original.kind,
				title: original.title,
				config,
				rect,
				source,
				renderer: original.renderer
			});

			return {
				nextState: { ...state, panels: [...state.panels, panel] },
				affectedIds: [id],
				diffSummary: `Duplicated panel "${original.title}" as "${panel.title}" at column ${rect.col}, row ${rect.row}.`
			};
		}
	);
}
