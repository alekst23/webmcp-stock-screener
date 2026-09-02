// AC7: apply a batch of footprints all-or-nothing; panels absent from the
// batch are unmoved (applyLayoutBatch/domain applyLayout already handles
// that -- only the named panels' rects change below).
import type { GridRect } from '../domain/grid';
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import {
	applyLayoutBatch,
	commitPanelChange,
	findPanel,
	requirePanelKind,
	type PanelUseCaseDeps
} from './support';

export interface SetPanelLayoutRequest {
	context: MutationContext;
	placements: { panelId: string; rect: GridRect }[];
}

export function setPanelLayout(
	deps: PanelUseCaseDeps,
	request: SetPanelLayoutRequest
): MutationEnvelope {
	return commitPanelChange(
		deps,
		request.context,
		'panels.set_panel_layout',
		request,
		(_doc, state) => {
			const placements = request.placements.map(({ panelId, rect }) => {
				const panel = findPanel(state, panelId);
				return { panelId, rect, minSize: requirePanelKind(deps.kinds, panel.kind).minSize };
			});
			const rects = applyLayoutBatch(state.panels, placements);
			const rectByPanelId = new Map(rects.map((r) => [r.panelId, r.rect]));

			const panels = state.panels.map((panel) => {
				const rect = rectByPanelId.get(panel.id);
				return rect ? { ...panel, rect } : panel;
			});

			const names = placements.map((p) => findPanel(state, p.panelId).title).join(', ');
			return {
				nextState: { ...state, panels },
				affectedIds: placements.map((p) => p.panelId),
				diffSummary: `Repositioned ${placements.length} panel(s): ${names}.`
			};
		}
	);
}
