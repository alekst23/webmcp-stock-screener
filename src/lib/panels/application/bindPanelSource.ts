// AC4: change a panel's source, rejecting a source type the panel's kind
// or active renderer doesn't accept. The renderer itself never changes.
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import type { WorkspaceDocument } from '../../workbench/domain/workspace';
import { PanelOperationError } from './errors';
import { commitPanelChange, findPanel, type PanelUseCaseDeps } from './support';

export interface BindPanelSourceRequest {
	context: MutationContext;
	panelId: string;
	source: { type: string; ref: Record<string, unknown> };
}

export function bindPanelSource(
	deps: PanelUseCaseDeps,
	request: BindPanelSourceRequest
): MutationEnvelope {
	return commitPanelChange(
		deps,
		request.context,
		'panels.bind_panel_source',
		request,
		(_doc, state) => {
			const panel = findPanel(state, request.panelId);

			const validation = deps.sourceRenderer.validateSource({
				source: request.source,
				panelKind: panel.kind,
				renderer: panel.renderer
			});
			if (!validation.ok) {
				throw new PanelOperationError(
					'invalid_source',
					`Source is not accepted by panel "${panel.title}".`,
					{
						errors: validation.errors,
						acceptedSourceTypes: validation.acceptedSourceTypes
					}
				);
			}

			const updated = { ...panel, source: validation.value };
			// Bug fix (see git history): a source type's own applyBinding hook
			// (sourceRendererRegistry.ts) folds any effect its binding has
			// beyond panel.source into this same commit -- absent for every
			// source type that has none, which was every source type until
			// the chart one needed it.
			const sourceType = deps.sourceRenderer.getSourceType(validation.value.type);
			const boundRef = validation.value.ref;
			return {
				nextState: { ...state, panels: state.panels.map((p) => (p.id === panel.id ? updated : p)) },
				affectedIds: [panel.id],
				diffSummary: `Bound panel "${panel.title}" to a "${validation.value.type}" source.`,
				...(sourceType?.applyBinding
					? {
							documentPatch: (doc: WorkspaceDocument) =>
								sourceType.applyBinding!(doc, panel.id, boundRef)
						}
					: {})
			};
		}
	);
}
