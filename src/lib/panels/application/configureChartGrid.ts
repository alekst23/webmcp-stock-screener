// AC6: rows, columns, item count, pagination, shared studies, and chart
// settings for a panel whose renderer is chart_grid, validated against
// that renderer's own contract -- not the panel kind's.
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { PanelOperationError } from './errors';
import { commitPanelChange, findPanel, type PanelUseCaseDeps } from './support';

const CHART_GRID_RENDERER = 'chart_grid';

export interface ConfigureChartGridRequest {
	context: MutationContext;
	panelId: string;
	rows?: number;
	columns?: number;
	itemCount?: number;
	page?: number;
	pageSize?: number;
	sharedStudies?: string[];
	chartSettings?: Record<string, unknown>;
}

function requestedFields(request: ConfigureChartGridRequest): Record<string, unknown> {
	const { rows, columns, itemCount, page, pageSize, sharedStudies, chartSettings } = request;
	const fields = { rows, columns, itemCount, page, pageSize, sharedStudies, chartSettings };
	return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}

export function configureChartGrid(
	deps: PanelUseCaseDeps,
	request: ConfigureChartGridRequest
): MutationEnvelope {
	return commitPanelChange(
		deps,
		request.context,
		'panels.configure_chart_grid',
		request,
		(_doc, state) => {
			const panel = findPanel(state, request.panelId);
			if (panel.renderer !== CHART_GRID_RENDERER) {
				throw new PanelOperationError(
					'wrong_renderer',
					`Panel "${panel.title}"'s renderer is "${panel.renderer ?? 'none'}", not "${CHART_GRID_RENDERER}".`,
					{ currentRenderer: panel.renderer }
				);
			}

			const candidate = { ...panel.config, ...requestedFields(request) };
			const validation = deps.sourceRenderer.validateRendererConfig(CHART_GRID_RENDERER, candidate);
			if (!validation.ok) {
				throw new PanelOperationError(
					'invalid_config',
					`Chart grid configuration rejected for panel "${panel.title}".`,
					{
						errors: validation.errors
					}
				);
			}

			const updated = { ...panel, config: validation.value };
			return {
				nextState: { ...state, panels: state.panels.map((p) => (p.id === panel.id ? updated : p)) },
				affectedIds: [panel.id],
				diffSummary: `Updated chart grid configuration for panel "${panel.title}".`
			};
		}
	);
}
