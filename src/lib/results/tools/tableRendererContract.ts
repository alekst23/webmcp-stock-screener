// The results table's entry in the panel source/renderer registry (T-1010-6):
// what a `results_table` panel can be pointed at (a pinned screener run), and
// how it presents what it is pointed at (the T-1010-1 table configuration
// model). Mirrors src/lib/workbench/chart/tools/chartRendererContract.ts's
// shape -- registerSourceType + registerRendererType behind one call -- but
// imports the real SourceRendererRegistry type directly: unlike when the
// chart contract was written, that registry is on `main` now, so there is no
// need for a structural stand-in.
//
// The registry VALIDATES but never APPLIES: nothing here mutates a
// workspace. The mutation half is EPIC-1007's generic `configure_panel_view`
// and `set_panel_selection`, which resolve to this contract's hooks when the
// target panel's renderer is 'table' (configurePanelView.ts, setPanelSelection.ts).
import type { PinnedRunStore, RunNotAvailable } from '../../screener/ports';
import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import type { ConfigError, ConfigValidation } from '../../panels/registry/panelKindRegistry';
import type {
	RendererTypeDefinition,
	SelectionValidation,
	SelectionValidationInput,
	SourceRendererRegistry,
	SourceTypeDefinition
} from '../../panels/registry/sourceRendererRegistry';
import type { Panel } from '../../panels/domain/panel';
import { mintResultId } from '../domain/page';
import { describeResultsTableConfigChange } from '../domain/tableConfigDiff';
import { validateResultsTableConfig } from '../domain/tableConfig';
import {
	defaultWireResultsTableConfig,
	parseWireResultsTableConfig,
	RESULTS_TABLE_CONFIG_SCHEMA,
	toWireResultsTableConfig
} from '../application/tableConfigWire';

export const RESULTS_TABLE_RENDERER_NAME = 'table';
export const RESULTS_TABLE_SOURCE_TYPE = 'screener_results';

export interface ResultsTableContractDeps {
	// Membership checks only (AC6, AC12): this contract never calls
	// ScreenerEvaluationPort and never re-executes a screener. Defaults to no
	// runs available, matching src/lib/discovery/unavailableDirectory.ts's
	// "report unwired honestly" convention -- an injected store is required
	// for a real deployment, not merely optional-but-silently-ignored.
	runs: PinnedRunStore;
	catalog?: CatalogRegistry;
}

function isRunNotAvailable<T>(value: T | RunNotAvailable): value is RunNotAvailable {
	return typeof value === 'object' && value !== null && 'available' in value;
}

// AC1/AC3/AC4: parses the wire candidate, validates it against the injected
// catalog, and reports rejections or (on success) warnings + the normalized
// wire config -- never a partially-applied result.
function validateConfig(
	deps: ResultsTableContractDeps,
	input: unknown
): ConfigValidation<Record<string, unknown>> {
	const catalog = deps.catalog ?? builtinCatalogRegistry;
	const parsed = parseWireResultsTableConfig(input);
	if (!parsed.ok) {
		return { ok: false, errors: parsed.errors };
	}
	const validated = validateResultsTableConfig(parsed.config, catalog);
	if (!validated.ok) {
		return {
			ok: false,
			errors: validated.rejections.map((r) => ({ field: r.elementId ?? r.code, reason: r.message }))
		};
	}
	return {
		ok: true,
		value: toWireResultsTableConfig(validated.config),
		warnings: validated.warnings.map((w) => ({ field: w.elementId ?? w.code, reason: w.message }))
	};
}

// AC2: re-parses both stored wire configs (lenient on absence -- see
// parseWireResultsTableConfig's own doc comment) and hands the domain values
// to the pure diff function. A previous config from before the panel ever ran
// through this contract (freshly created, still holding the panel kind's
// placeholder default) parses to the all-empty config rather than failing,
// so the very first real configure call still gets a real diff instead of an
// error.
function describeConfigChange(input: {
	previous: Record<string, unknown>;
	next: Record<string, unknown>;
}): string {
	const previous = parseWireResultsTableConfig(input.previous);
	const next = parseWireResultsTableConfig(input.next);
	if (!previous.ok || !next.ok) {
		return 'view configuration updated';
	}
	return describeResultsTableConfigChange(previous.config, next.config);
}

// AC6: every selected id must belong to the run this panel is bound to.
// Read-only against PinnedRunStore -- getRun/getMatches only, exactly the
// "no silent rerun" surface results/ports.ts documents (AC12).
function validateSelection(
	deps: ResultsTableContractDeps,
	input: SelectionValidationInput
): SelectionValidation {
	if (input.selectedIds.length === 0) {
		return { ok: true };
	}
	const runId = runIdOf(input.panel);
	if (runId === null) {
		return {
			ok: false,
			errors: [
				{ field: 'selected_ids', reason: `Panel "${input.panel.title}" has no bound screener run.` }
			]
		};
	}
	const run = deps.runs.getRun(runId);
	if (isRunNotAvailable(run)) {
		return {
			ok: false,
			errors: [{ field: 'selected_ids', reason: `Run "${runId}" is not available: ${run.message}` }]
		};
	}
	const validIds = new Set(run.matches.map((match) => mintResultId(run.runId, match.rank)));
	const unknown = input.selectedIds.filter((id) => !validIds.has(id));
	if (unknown.length === 0) {
		return { ok: true };
	}
	const errors: ConfigError[] = unknown.map((id) => ({
		field: 'selected_ids',
		reason: `"${id}" is not a result of run "${runId}".`
	}));
	return { ok: false, errors };
}

function runIdOf(panel: Panel): string | null {
	if (!panel.source || panel.source.type !== RESULTS_TABLE_SOURCE_TYPE) {
		return null;
	}
	const runId = panel.source.ref.run_id;
	return typeof runId === 'string' ? runId : null;
}

export function createResultsTableRendererTypeDefinition(
	deps: ResultsTableContractDeps
): RendererTypeDefinition {
	return {
		name: RESULTS_TABLE_RENDERER_NAME,
		configSchema: RESULTS_TABLE_CONFIG_SCHEMA,
		validateConfig: (input) => validateConfig(deps, input),
		defaultConfig: defaultWireResultsTableConfig,
		acceptedSourceTypes: [RESULTS_TABLE_SOURCE_TYPE],
		describeConfigChange,
		// Deliberately omitted: a results table shows as many selected rows as
		// were selected, so it has no capacity restriction to declare -- the
		// registry's own default ('multiple', i.e. every selection propagates
		// unrestricted) is exactly right here.
		validateSelection: (input) => validateSelection(deps, input)
	};
}

function validateRunReference(ref: unknown): ConfigValidation<Record<string, unknown>> {
	if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) {
		return { ok: false, errors: [{ field: 'source.ref', reason: 'must be an object' }] };
	}
	const runId = (ref as Record<string, unknown>).run_id;
	if (typeof runId !== 'string' || runId.length === 0) {
		return {
			ok: false,
			errors: [{ field: 'source.ref.run_id', reason: 'must be a non-empty string' }]
		};
	}
	return { ok: true, value: { run_id: runId } };
}

export function createScreenerResultsSourceTypeDefinition(): SourceTypeDefinition {
	return {
		name: RESULTS_TABLE_SOURCE_TYPE,
		refSchema: {
			type: 'object',
			properties: { run_id: { type: 'string' } },
			required: ['run_id']
		},
		validateRef: validateRunReference,
		isCompatible: ({ renderer }) => renderer === null || renderer === RESULTS_TABLE_RENDERER_NAME,
		compatibilityDescription:
			`Accepted by the "${RESULTS_TABLE_RENDERER_NAME}" renderer, or by a panel with no renderer ` +
			'chosen yet.'
	};
}

// The single call site, so wiring the results table into the registry stays
// one line -- the same shape as registerChartRendererContract.
export function registerResultsTableRendererContract(
	registry: SourceRendererRegistry,
	deps: ResultsTableContractDeps
): void {
	registry.registerSourceType(createScreenerResultsSourceTypeDefinition());
	registry.registerRendererType(createResultsTableRendererTypeDefinition(deps));
}
