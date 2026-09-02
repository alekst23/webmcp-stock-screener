// The study-editing half of the `chart_grid` renderer's view configuration.
//
// EPIC-1007's source/renderer registry validates a panel's view config but does
// not apply changes, so this file is only the validation half; the mutation half
// is the `chart.edit_studies` operation in `../application/chartStudies`. Both
// reach the same catalog resolution, pane derivation and parameter resolution,
// so a config this accepts is one the operation accepts.
//
// Nothing here imports from EPIC-1007 -- its registry is not on main yet. The
// registry and renderer-definition shapes are declared structurally, and the
// renderer's own name and accepted source types come from the sibling module
// that owns them, so composing the two halves stays a one-line change.

import { isChartTimeframe, type ChartTimeframe } from '../domain/chartState';
import { validateStoredStudy, type ChartStudiesOptions } from '../application/chartStudies';

// The key this half owns inside the renderer's view config. The other keys of
// the same config belong to the view/source halves of the contract.
export const CHART_STUDIES_CONFIG_KEY = 'studies';

// EPIC-1007's renderer definition, restated structurally rather than imported.
export interface RendererTypeDefinition {
	name: string;
	configSchema: object;
	validateConfig(config: unknown): string[];
	defaultConfig(): Record<string, unknown>;
	acceptedSourceTypes: readonly string[];
}

export interface RendererRegistry {
	registerRenderer(definition: RendererTypeDefinition): void;
}

// One half of a renderer's config contract, composable with the others.
export interface RendererConfigContribution {
	key: string;
	configSchema: object;
	validateConfig(config: unknown): string[];
	defaultConfig(): Record<string, unknown>;
}

export const CHART_STUDIES_CONFIG_SCHEMA = {
	type: 'object',
	properties: {
		studies: {
			type: 'array',
			description:
				'Study instances on the chart, in display order. Pane placement is derived ' +
				'from the catalog and is not a caller choice.',
			items: {
				type: 'object',
				required: ['id', 'catalog_item_id', 'params', 'pane', 'order', 'enabled'],
				properties: {
					id: { type: 'string', description: 'Stable instance ID, `study_`-prefixed.' },
					catalog_item_id: { type: 'string' },
					params: { type: 'object', description: 'Fully resolved, catalog defaults included.' },
					pane: { enum: ['price_overlay', 'sub_pane'] },
					order: { type: 'integer', minimum: 0 },
					enabled: { type: 'boolean' }
				}
			}
		}
	}
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A study instance has exactly one multi-word key, and whether the tool boundary
// has already converted the wire's snake_case is EPIC-1007's choice, not this
// half's. Accepting either spelling of that one key costs three lines and
// removes a guess about a contract that is not built yet.
function normalizeStudyKeys(study: unknown): unknown {
	if (!isRecord(study) || study.catalog_item_id === undefined) {
		return study;
	}
	const { catalog_item_id: wireId, ...rest } = study;
	return { ...rest, catalogItemId: rest.catalogItemId ?? wireId };
}

// The view half of the same config carries the timeframe. When it is present a
// study's availability is checked against it; when it is absent the check is
// skipped rather than guessed, so this half composes with a partial config.
function timeframeOf(config: Record<string, unknown>): ChartTimeframe | null {
	return isChartTimeframe(config.timeframe) ? config.timeframe : null;
}

export function validateChartStudiesConfig(
	config: unknown,
	options: ChartStudiesOptions = {}
): string[] {
	if (!isRecord(config)) {
		return ['config: expected a chart view configuration object.'];
	}
	const studies = config[CHART_STUDIES_CONFIG_KEY];
	// Absent means "this config does not set studies", which is valid; only a
	// present-but-wrong value is a rejection.
	if (studies === undefined) {
		return [];
	}
	if (!Array.isArray(studies)) {
		return [`${CHART_STUDIES_CONFIG_KEY}: expected an array of study instances.`];
	}
	const timeframe = timeframeOf(config);
	const issues: string[] = [];
	const seen = new Set<string>();
	studies.forEach((study, index) => {
		const field = `${CHART_STUDIES_CONFIG_KEY}[${index}]`;
		issues.push(...validateStoredStudy(normalizeStudyKeys(study), field, timeframe, options));
		const id = isRecord(study) ? String(study.id) : '';
		if (id !== '' && seen.has(id)) {
			issues.push(`${field}.id: "${id}" appears more than once; instance IDs are unique.`);
		}
		seen.add(id);
	});
	return issues;
}

export function defaultChartStudiesConfig(): Record<string, unknown> {
	// A new chart carries no studies. Stated rather than left implied, so a
	// config never has to be read as "absent means empty".
	return { [CHART_STUDIES_CONFIG_KEY]: [] };
}

export const chartStudiesViewContribution: RendererConfigContribution = {
	key: CHART_STUDIES_CONFIG_KEY,
	configSchema: CHART_STUDIES_CONFIG_SCHEMA,
	validateConfig: (config) => validateChartStudiesConfig(config),
	defaultConfig: defaultChartStudiesConfig
};

function mergeSchemas(base: object, addition: object): object {
	const baseProps = (base as { properties?: Record<string, unknown> }).properties ?? {};
	const addedProps = (addition as { properties?: Record<string, unknown> }).properties ?? {};
	return { ...base, ...addition, properties: { ...baseProps, ...addedProps } };
}

// Folds this half into the renderer definition the sibling module builds, so
// wiring the whole chart renderer stays one call.
export function composeRendererWithStudies(
	base: RendererTypeDefinition,
	options: ChartStudiesOptions = {}
): RendererTypeDefinition {
	return {
		...base,
		configSchema: mergeSchemas(base.configSchema, CHART_STUDIES_CONFIG_SCHEMA),
		validateConfig: (config) => [
			...base.validateConfig(config),
			...validateChartStudiesConfig(config, options)
		],
		defaultConfig: () => ({ ...base.defaultConfig(), ...defaultChartStudiesConfig() })
	};
}

export function registerChartStudiesContract(
	registry: RendererRegistry,
	base: RendererTypeDefinition,
	options: ChartStudiesOptions = {}
): RendererTypeDefinition {
	const composed = composeRendererWithStudies(base, options);
	registry.registerRenderer(composed);
	return composed;
}
