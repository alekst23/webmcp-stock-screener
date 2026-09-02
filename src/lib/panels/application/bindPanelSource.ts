// AC4: change a panel's source, rejecting a source type the panel's kind
// or active renderer doesn't accept. The renderer itself never changes.
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
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
			return {
				nextState: { ...state, panels: state.panels.map((p) => (p.id === panel.id ? updated : p)) },
				affectedIds: [panel.id],
				diffSummary: `Bound panel "${panel.title}" to a "${validation.value.type}" source.`
			};
		}
	);
}
