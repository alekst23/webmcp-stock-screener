// The real `similar_opportunities` panel-kind definition (T-1012-6),
// contributed to EPIC-1007's panel-kind registry.
//
// EPIC-1007's `defaultPanelKinds.ts` already registers a *placeholder* kind
// under this same name in the app's one live `PanelRegistry`, and that
// registry throws on a duplicate `register()` with no unregister/replace
// method -- so this definition cannot be registered into the live registry
// as things stand today (see this ticket's Solution Approach for the finding
// left for T-1012-8 / EPIC-1007). It is exported here, complete and tested
// against a fresh registry, ready to be wired in once that is resolved.
import type {
	ConfigError,
	ConfigValidation,
	PanelKindDefinition
} from '../../../../panels/registry/panelKindRegistry';

export const SIMILAR_OPPORTUNITIES_KIND = 'similar_opportunities';

export interface SimilarOpportunitiesConfig extends Record<string, unknown> {
	// The pinned similarity run this panel displays. Candidate *selection*
	// is deliberately not part of this config -- it reuses the panel
	// system's existing generic `state.selections` / `set_panel_selection`
	// mechanism, which already satisfies AC4 for any panel kind.
	runId: string | null;
}

function defaultConfig(): SimilarOpportunitiesConfig {
	return { runId: null };
}

function validateConfig(input: unknown): ConfigValidation<SimilarOpportunitiesConfig> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return { ok: false, errors: [{ field: 'config', reason: 'must be an object' }] };
	}
	const record = input as Record<string, unknown>;
	const errors: ConfigError[] = [];
	for (const key of Object.keys(record)) {
		if (key !== 'runId') {
			errors.push({ field: key, reason: 'not a recognized configuration field' });
		}
	}
	if ('runId' in record && record.runId !== null && typeof record.runId !== 'string') {
		errors.push({ field: 'runId', reason: 'must be a string run ID or null' });
	}
	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return {
		ok: true,
		value: { runId: typeof record.runId === 'string' ? record.runId : null }
	};
}

export const similarOpportunitiesPanelKindDefinition: PanelKindDefinition<SimilarOpportunitiesConfig> =
	{
		kind: SIMILAR_OPPORTUNITIES_KIND,
		defaultTitle: 'Similar Opportunities',
		defaultSize: { colSpan: 2, rowSpan: 2 },
		minSize: { colSpan: 1, rowSpan: 1 },
		defaultConfig,
		validateConfig,
		configSchema: {
			type: 'object',
			properties: { runId: { type: ['string', 'null'] } }
		},
		// Reproduced from docs/design/panel-system/technical.md's kind -> link
		// channel matrix, same as the EPIC-1007 placeholder this replaces.
		linkChannels: ['symbol', 'timeframe', 'result_selection'],
		// Not source-bound: this kind is bound to a similarity run via
		// `config.runId`, never to a screener_results/watchlist source through
		// the source/renderer registry, so it takes no part in that contract.
		bindingTypes: [],
		defaultRenderer: null,
		component: () => import('../components/SimilarOpportunitiesPanel.svelte')
	};
