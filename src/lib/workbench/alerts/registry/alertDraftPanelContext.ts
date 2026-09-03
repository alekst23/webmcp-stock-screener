// The dependency set the lazily-loaded AlertDraftPanel.svelte needs but
// cannot receive as a prop -- mirrors watchlist/registry/watchlistPanelContext.ts
// and results/panel/resultsPanelContext.ts's own module-scoped-singleton
// pattern exactly. alertDraftPanelKind.ts's createAlertDraftPanelKindDefinition
// sets this once, synchronously, at panel-kind registration time -- before
// component() is ever called.
import type { PanelUseCaseDeps } from '../../../panels/application';

export interface AlertDraftPanelRuntimeDeps {
	useCaseDeps: PanelUseCaseDeps;
}

let current: AlertDraftPanelRuntimeDeps | null = null;

export function setAlertDraftPanelRuntimeDeps(deps: AlertDraftPanelRuntimeDeps): void {
	current = deps;
}

// Throws rather than returning undefined: reaching this without deps having
// been set means the alert_draft panel kind was never registered through
// createAlertDraftPanelKindDefinition, which is a wiring bug, not a state a
// person or agent can otherwise reach.
export function getAlertDraftPanelRuntimeDeps(): AlertDraftPanelRuntimeDeps {
	if (!current) {
		throw new Error(
			'Alert-draft panel runtime dependencies were never configured -- register the ' +
				'alert_draft panel kind via createAlertDraftPanelKindDefinition first.'
		);
	}
	return current;
}

// Test-only escape hatch so one test file's registration can never leak
// into another's.
export function resetAlertDraftPanelRuntimeDeps(): void {
	current = null;
}
