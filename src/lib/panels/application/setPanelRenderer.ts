// AC5: change a panel's renderer without changing its source, preserving
// configuration fields the new renderer's contract still recognizes and
// clearing (with a warning, not an error) the rest -- migrateConfig
// already computes exactly that split.
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { PanelOperationError } from './errors';
import {
	commitPanelChange,
	findPanel,
	requireKnownRenderer,
	type PanelUseCaseDeps
} from './support';

export interface SetPanelRendererRequest {
	context: MutationContext;
	panelId: string;
	renderer: string;
}

function checkSourceCompatibility(
	deps: PanelUseCaseDeps,
	panel: { source: { type: string } | null; title: string },
	renderer: string
): void {
	if (!panel.source) {
		return;
	}
	const rendererDef = deps.sourceRenderer.requireRendererType(renderer);
	if (!rendererDef.acceptedSourceTypes.includes(panel.source.type)) {
		throw new PanelOperationError(
			'incompatible_renderer',
			`Panel "${panel.title}"'s source ("${panel.source.type}") does not accept renderer "${renderer}".`,
			{ acceptedRenderers: deps.sourceRenderer.renderersAcceptingSource(panel.source.type) }
		);
	}
}

export function setPanelRenderer(
	deps: PanelUseCaseDeps,
	request: SetPanelRendererRequest
): MutationEnvelope {
	return commitPanelChange(
		deps,
		request.context,
		'panels.set_panel_renderer',
		request,
		(_doc, state) => {
			const panel = findPanel(state, request.panelId);
			requireKnownRenderer(deps.sourceRenderer, request.renderer);
			checkSourceCompatibility(deps, panel, request.renderer);

			const migration = deps.sourceRenderer.migrateConfig({
				from: panel.renderer,
				to: request.renderer,
				config: panel.config
			});
			const updated = { ...panel, renderer: request.renderer, config: migration.config };
			const warnings =
				migration.dropped.length > 0
					? [
							`Dropped unrecognized configuration field(s) switching to "${request.renderer}": ${migration.dropped.join(', ')}.`
						]
					: [];

			return {
				nextState: { ...state, panels: state.panels.map((p) => (p.id === panel.id ? updated : p)) },
				affectedIds: [panel.id],
				diffSummary: `Changed panel "${panel.title}" renderer to "${request.renderer}".`,
				warnings
			};
		}
	);
}
