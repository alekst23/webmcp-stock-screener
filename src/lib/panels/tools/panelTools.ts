// The fourteen panel WebMCP tools (T-1007-5), assembled from the five
// tool-group builders. Registering these against document.modelContext
// and rendering is T-1007-6's job, not this module's -- buildPanelTools
// returns plain ToolSpecs, constructible and invocable in a unit test
// with no browser and no document.modelContext (AC11).
import type { PanelUseCaseDeps } from '../application';
import type { ToolSpec } from '../../webmcp/types';
import { buildLifecycleTools } from './lifecycleTools';
import { buildLayoutTools, type MaximizedPanelHandle } from './layoutTools';
import { buildSourceRendererTools } from './sourceRendererTools';
import { buildLinkTools } from './linkTools';

export type { MaximizedPanelHandle } from './layoutTools';
export { createMaximizedPanelState } from './maximizedState';

// maximize_panel needs somewhere to put the maximized id; it's client
// render state, not workspace state, so it's a small injected handle
// rather than a module global (T-1007-4 AC10).
export interface PanelToolDeps extends PanelUseCaseDeps {
	maximized: MaximizedPanelHandle;
}

export function buildPanelTools(deps: PanelToolDeps): ToolSpec[] {
	return [
		...buildLifecycleTools(deps),
		...buildLayoutTools(deps),
		...buildSourceRendererTools(deps),
		...buildLinkTools(deps)
	];
}
