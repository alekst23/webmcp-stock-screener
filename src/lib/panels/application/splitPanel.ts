// AC7: divide one panel's footprint into two, creating a new panel in the
// freed half. The new panel copies the original's kind, config, source,
// and renderer (like duplicate_panel) -- the split's whole point is
// dividing space, not producing an unrelated panel. Neither half needs a
// bounds/overlap re-check (splitRect's own guarantee): only the minimum
// size on each half can fail.
import { splitRect } from '../domain/layout';
import { makePanel } from '../domain/panel';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import {
	commitPanelChange,
	findPanel,
	requirePanelKind,
	throwPlacementViolation,
	type PanelUseCaseDeps
} from './support';

export interface SplitPanelRequest {
	context: MutationContext;
	panelId: string;
	direction: 'horizontal' | 'vertical';
	title?: string;
}

export function splitPanel(deps: PanelUseCaseDeps, request: SplitPanelRequest): MutationEnvelope {
	return commitPanelChange(deps, request.context, 'panels.split_panel', request, (_doc, state) => {
		const original = findPanel(state, request.panelId);
		const kindDef = requirePanelKind(deps.kinds, original.kind);

		const split = splitRect({
			rect: original.rect,
			direction: request.direction,
			originalMinSize: kindDef.minSize,
			createdMinSize: kindDef.minSize
		});
		if (!split.ok) {
			throwPlacementViolation(split.violation);
		}

		const newId = deps.ids.next('panel', original.kind);
		const newPanel = makePanel({
			id: newId,
			kind: original.kind,
			title: request.title ?? original.title,
			config: original.config,
			rect: split.created,
			source: original.source,
			renderer: original.renderer
		});
		const updatedOriginal = { ...original, rect: split.original };

		return {
			nextState: {
				...state,
				panels: state.panels
					.map((p) => (p.id === original.id ? updatedOriginal : p))
					.concat(newPanel)
			},
			affectedIds: [original.id, newId],
			diffSummary: `Split panel "${original.title}" ${request.direction}ly into "${updatedOriginal.title}" and new panel "${newPanel.title}".`
		};
	});
}
