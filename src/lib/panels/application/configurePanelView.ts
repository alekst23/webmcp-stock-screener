// AC3: title, visibility, collapsed state, and renderer-specific view
// configuration, independently or in combination. Only `config` is
// validated against a contract (the active renderer's); title/hidden/
// collapsed are plain chrome the container itself owns.
import type { MutationContext, MutationEnvelope } from '../../workbench/domain/mutation';
import { PanelOperationError } from './errors';
import {
	commitPanelChange,
	findPanel,
	recognizedRendererConfig,
	type PanelUseCaseDeps
} from './support';

export interface ConfigurePanelViewRequest {
	context: MutationContext;
	panelId: string;
	title?: string;
	hidden?: boolean;
	collapsed?: boolean;
	config?: Record<string, unknown>;
}

function resolveConfig(
	deps: PanelUseCaseDeps,
	panel: { renderer: string | null; config: Record<string, unknown>; title: string },
	requested: Record<string, unknown> | undefined
): Record<string, unknown> {
	if (requested === undefined) {
		return panel.config;
	}
	if (panel.renderer === null) {
		throw new PanelOperationError(
			'no_active_renderer',
			`Panel "${panel.title}" has no active renderer to validate configuration against.`
		);
	}
	const base = recognizedRendererConfig(deps.sourceRenderer, panel.renderer, panel.config);
	const candidate = { ...base, ...requested };
	const validation = deps.sourceRenderer.validateRendererConfig(panel.renderer, candidate);
	if (!validation.ok) {
		throw new PanelOperationError(
			'invalid_config',
			`View configuration rejected for panel "${panel.title}".`,
			{
				errors: validation.errors
			}
		);
	}
	return validation.value;
}

function describeChanges(request: ConfigurePanelViewRequest): string[] {
	const parts: string[] = [];
	if (request.title !== undefined) parts.push(`retitled to "${request.title}"`);
	if (request.hidden !== undefined) parts.push(request.hidden ? 'hidden' : 'shown');
	if (request.collapsed !== undefined) parts.push(request.collapsed ? 'collapsed' : 'expanded');
	if (request.config !== undefined) parts.push('view configuration updated');
	return parts;
}

export function configurePanelView(
	deps: PanelUseCaseDeps,
	request: ConfigurePanelViewRequest
): MutationEnvelope {
	return commitPanelChange(
		deps,
		request.context,
		'panels.configure_panel_view',
		request,
		(_doc, state) => {
			const panel = findPanel(state, request.panelId);
			const config = resolveConfig(deps, panel, request.config);

			const updated = {
				...panel,
				title: request.title ?? panel.title,
				hidden: request.hidden ?? panel.hidden,
				collapsed: request.collapsed ?? panel.collapsed,
				config
			};
			const changes = describeChanges(request);
			const summary = changes.length > 0 ? changes.join(', ') : 'no changes requested';

			return {
				nextState: { ...state, panels: state.panels.map((p) => (p.id === panel.id ? updated : p)) },
				affectedIds: [panel.id],
				diffSummary: `Panel "${panel.title}": ${summary}.`
			};
		}
	);
}
