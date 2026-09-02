// AC7: apply a named template's footprints to the caller-named panels, in
// slot order, atomically. panelIds.length must match the template's slot
// count -- there's no sensible way to guess which subset of the
// workspace's panels a template with fewer/more slots should apply to.
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { PanelOperationError } from './errors';
import {
	applyLayoutBatch,
	commitPanelChange,
	findPanel,
	requireLayoutTemplateOrThrow,
	requirePanelKind,
	type PanelUseCaseDeps
} from './support';

export interface ApplyLayoutTemplateRequest {
	context: MutationContext;
	templateName: string;
	panelIds: string[];
}

export function applyLayoutTemplate(
	deps: PanelUseCaseDeps,
	request: ApplyLayoutTemplateRequest
): MutationEnvelope {
	return commitPanelChange(
		deps,
		request.context,
		'panels.apply_layout_template',
		request,
		(_doc, state) => {
			const template = requireLayoutTemplateOrThrow(deps.templates, request.templateName);
			if (request.panelIds.length !== template.slots.length) {
				throw new PanelOperationError(
					'template_panel_count_mismatch',
					`Template "${request.templateName}" has ${template.slots.length} slot(s), but ${request.panelIds.length} panel id(s) were given.`,
					{ slotCount: template.slots.length, panelCount: request.panelIds.length }
				);
			}

			const placements = request.panelIds.map((panelId, index) => {
				const panel = findPanel(state, panelId);
				return {
					panelId,
					rect: template.slots[index]!,
					minSize: requirePanelKind(deps.kinds, panel.kind).minSize
				};
			});
			const rects = applyLayoutBatch(state.panels, placements);
			const rectByPanelId = new Map(rects.map((r) => [r.panelId, r.rect]));

			const panels = state.panels.map((panel) => {
				const rect = rectByPanelId.get(panel.id);
				return rect ? { ...panel, rect } : panel;
			});

			return {
				nextState: { ...state, panels },
				affectedIds: [...request.panelIds],
				diffSummary: `Applied layout template "${request.templateName}" to ${request.panelIds.length} panel(s).`
			};
		}
	);
}
