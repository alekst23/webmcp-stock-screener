// The real `alert_draft` PanelKindDefinition (T-1015-12): a NEW panel kind,
// distinct from defaultPanelKinds.ts's existing 'alerts' (plural) placeholder
// -- this ticket's Solution Approach is explicit that it does not repurpose
// that placeholder's spec, so every field below (defaultSize, minSize,
// linkChannels, bindingTypes, configSchema) is decided fresh here rather than
// copied from it. Registered into the live registry the same way
// resultsTablePanelKind.ts's real kind is (registry.register with no
// `{ placeholder: true }` option) -- since no placeholder for 'alert_draft'
// exists, panelKindRegistry.ts's register() simply inserts it as real,
// regardless of call order relative to registerDefaultPanelKinds().
//
// Renders EPIC-1014's drafted-alert state (workbench/alerts/domain/alert.ts):
// every alert record currently in the 'draft' state (alertStateMachine.ts's
// INITIAL_ALERT_STATE) -- "pending review" in this ticket's own wording,
// i.e. not yet requested for activation. Not source-bound (bindingTypes: []):
// unlike a watchlist or a screener run, there is no registered source type
// for "one alert" (defaultSourceRendererTypes.ts has none), so this panel
// always reflects the active workspace's current draft alerts rather than
// one bound record.
import type {
	ConfigError,
	ConfigValidation,
	PanelKindDefinition,
	PanelRegistry
} from '../../../panels/registry/panelKindRegistry';
import type { GridSize } from '../../../panels/domain/grid';
import type { PanelUseCaseDeps } from '../../../panels/application';
import { setAlertDraftPanelRuntimeDeps } from './alertDraftPanelContext';

export interface AlertDraftPanelKindDeps {
	useCaseDeps: PanelUseCaseDeps;
}

// A compact "card", matching the reference mockup's own description of it,
// bounded only by its own minSize below (no existing placeholder spec to
// stay identical to).
const DEFAULT_SIZE: GridSize = { colSpan: 2, rowSpan: 1 };
const MIN_SIZE: GridSize = { colSpan: 1, rowSpan: 1 };

function defaultConfig(): Record<string, unknown> {
	return {};
}

// No configuration fields exist yet for this kind -- any object is accepted
// only if it is empty, matching every other placeholder validator's
// "unrecognized field is an error" convention rather than silently ignoring
// unknown input.
function validateConfig(input: unknown): ConfigValidation<Record<string, unknown>> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return { ok: false, errors: [{ field: 'config', reason: 'must be an object' }] };
	}
	const record = input as Record<string, unknown>;
	const errors: ConfigError[] = Object.keys(record).map((key) => ({
		field: key,
		reason: 'not a recognized configuration field'
	}));
	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, value: {} };
}

export function createAlertDraftPanelKindDefinition(
	deps: AlertDraftPanelKindDeps
): PanelKindDefinition<Record<string, unknown>> {
	// Set synchronously here, at registration time -- before component() is
	// ever called -- mirroring watchlistPanelKind.ts's own pattern.
	setAlertDraftPanelRuntimeDeps({ useCaseDeps: deps.useCaseDeps });

	return {
		kind: 'alert_draft',
		defaultTitle: 'Alert Draft',
		defaultSize: DEFAULT_SIZE,
		minSize: MIN_SIZE,
		defaultConfig,
		validateConfig,
		configSchema: { type: 'object', properties: {} },
		linkChannels: [],
		bindingTypes: [],
		defaultRenderer: null,
		component: async () => (await import('../panel/AlertDraftPanel.svelte')).default
	};
}

export function registerAlertDraftPanelKind(
	registry: PanelRegistry,
	deps: AlertDraftPanelKindDeps
): void {
	registry.register(createAlertDraftPanelKindDefinition(deps));
}
