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

interface ResolvedConfig {
	config: Record<string, unknown>;
	// The recognized-fields base the candidate was merged onto, i.e. what the
	// active renderer's own contract already recognized of the panel's prior
	// config -- passed to describeConfigChange as `previous` (AC2).
	previous: Record<string, unknown>;
	// Non-blocking issues the renderer's validator surfaced alongside an
	// otherwise-accepted config (AC4), e.g. a sort key that isn't a visible
	// column. Empty when the renderer's validator didn't report any.
	warnings: string[];
}

function resolveConfig(
	deps: PanelUseCaseDeps,
	panel: { renderer: string | null; config: Record<string, unknown>; title: string },
	requested: Record<string, unknown> | undefined
): ResolvedConfig {
	if (requested === undefined) {
		return { config: panel.config, previous: panel.config, warnings: [] };
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
	return {
		config: validation.value,
		previous: base,
		warnings: (validation.warnings ?? []).map((w) => w.reason)
	};
}

// AC2: a renderer that contributes describeConfigChange gets a plain-language
// diff instead of the generic fallback every renderer had before this hook
// existed.
function describeConfigDiff(
	deps: PanelUseCaseDeps,
	renderer: string | null,
	previous: Record<string, unknown>,
	next: Record<string, unknown>
): string {
	const rendererType =
		renderer !== null ? deps.sourceRenderer.getRendererType(renderer) : undefined;
	if (rendererType?.describeConfigChange) {
		return rendererType.describeConfigChange({ previous, next });
	}
	return 'view configuration updated';
}

function describeChanges(
	deps: PanelUseCaseDeps,
	panel: { renderer: string | null },
	request: ConfigurePanelViewRequest,
	resolved: ResolvedConfig
): string[] {
	const parts: string[] = [];
	if (request.title !== undefined) parts.push(`retitled to "${request.title}"`);
	if (request.hidden !== undefined) parts.push(request.hidden ? 'hidden' : 'shown');
	if (request.collapsed !== undefined) parts.push(request.collapsed ? 'collapsed' : 'expanded');
	if (request.config !== undefined) {
		parts.push(describeConfigDiff(deps, panel.renderer, resolved.previous, resolved.config));
	}
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
			const resolved = resolveConfig(deps, panel, request.config);

			const updated = {
				...panel,
				title: request.title ?? panel.title,
				hidden: request.hidden ?? panel.hidden,
				collapsed: request.collapsed ?? panel.collapsed,
				config: resolved.config
			};
			const changes = describeChanges(deps, panel, request, resolved);
			const summary = changes.length > 0 ? changes.join(', ') : 'no changes requested';

			return {
				nextState: { ...state, panels: state.panels.map((p) => (p.id === panel.id ? updated : p)) },
				affectedIds: [panel.id],
				diffSummary: `Panel "${panel.title}": ${summary}.`,
				warnings: resolved.warnings.length > 0 ? resolved.warnings : undefined
			};
		}
	);
}
