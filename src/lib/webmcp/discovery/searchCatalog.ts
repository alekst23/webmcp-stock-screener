// `search_catalog`: find what the app calls the thing the user just named.
// Summary-sized results only -- `describe_catalog_item` returns the detail.
//
// API layer: wraps the registry's query surface, which is where the search
// logic lives so EPIC-1009 and EPIC-1011 can reuse it.

import {
	builtinCatalogRegistry,
	clampCatalogLimit,
	MAX_CATALOG_RESULTS,
	type CatalogRegistry
} from '../../catalog/registry';
import { CATALOG_KINDS, type CatalogKind } from '../../catalog/types';
import { ensureModelContext } from '../bridge';
import type { ToolResult, ToolSpec } from '../types';
import {
	catalogProvenance,
	ok,
	readBooleanArg,
	readNumberArg,
	readStringArg,
	readStringArrayArg
} from './results';

const DESCRIPTION =
	'Search the application catalog -- every field, operator, study, indicator, ' +
	'pattern, interval, universe and template the app knows how to name. Matches on ' +
	'label, stable ID, aliases and tags, so a common synonym finds the item. Returns ' +
	'summary rows (id, kind, label, description, availability); pass an id to ' +
	'describe_catalog_item for parameters, units, ranges, defaults and outputs. ' +
	'Supply kinds with no query to enumerate a kind rather than guessing a search ' +
	'term. Items whose data is unavailable are included and marked, because "exists ' +
	'but has no data here" is different from "does not exist" -- read the ' +
	'availability reason before deciding an item is unusable.';

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		query: {
			type: 'string',
			description:
				'Free text, e.g. "relative volume", "crossed above", "rsi". Omit it and supply ' +
				'kinds to list everything of those kinds.'
		},
		kinds: {
			type: 'array',
			items: { type: 'string', enum: CATALOG_KINDS },
			description: 'Restrict the search to these catalog kinds. Omit to search all eight.'
		},
		includeUnavailable: {
			type: 'boolean',
			description:
				'Include items whose data is currently unavailable. Defaults to true; set false ' +
				'to see only what can be used right now.'
		},
		limit: {
			type: 'integer',
			minimum: 1,
			maximum: MAX_CATALOG_RESULTS,
			description: `Maximum items to return. Clamped to ${MAX_CATALOG_RESULTS}.`
		}
	}
};

function readKinds(input: unknown): CatalogKind[] | undefined {
	const raw = readStringArrayArg(input, 'kinds');
	if (!raw) {
		return undefined;
	}
	const kinds = raw.filter((value): value is CatalogKind =>
		(CATALOG_KINDS as readonly string[]).includes(value)
	);
	return kinds.length > 0 ? kinds : undefined;
}

async function execute(registry: CatalogRegistry, input: unknown): Promise<ToolResult> {
	const text = readStringArg(input, 'query')?.trim() ?? '';
	const kinds = readKinds(input);
	const includeUnavailable = readBooleanArg(input, 'includeUnavailable') ?? true;
	const requested = readNumberArg(input, 'limit');
	const { limit, clamped } = clampCatalogLimit(requested);

	const matches = registry.searchCatalogItems({ text, kinds, includeUnavailable, limit });
	const items = matches.map((match) => ({
		id: match.item.id,
		kind: match.item.kind,
		label: match.item.label,
		description: match.item.description,
		availability: {
			status: match.item.availability.status,
			reason: match.item.availability.reason ?? null,
			requiresReferenceData: match.item.availability.requiresReferenceData
		},
		// Only a field declares accepted values, and only some fields are
		// enumerated -- every other kind keeps its exact current row shape
		// (no key at all) rather than growing a null nobody asked for.
		...(match.item.kind === 'field' && match.item.enumValues
			? { enumValues: match.item.enumValues }
			: {}),
		score: match.score,
		matchedOn: match.matchedOn
	}));

	const enumerating = text === '';
	return ok({
		query: text === '' ? null : text,
		kinds: kinds ?? null,
		includeUnavailable,
		limit,
		outcome: enumerating ? 'enumeration' : items.length > 0 ? 'matches' : 'no_matches',
		note: outcomeNote(text, kinds, items.length, enumerating),
		matchCount: items.length,
		items,
		provenance: catalogProvenance(),
		warnings: clamped
			? [`Requested limit ${requested} was clamped to the maximum of ${limit}.`]
			: []
	});
}

function outcomeNote(
	text: string,
	kinds: CatalogKind[] | undefined,
	count: number,
	enumerating: boolean
): string {
	const scope = kinds ? ` of kind ${kinds.join(', ')}` : '';
	if (enumerating) {
		return `Listing ${count} catalog item(s)${scope || ' across all kinds'}.`;
	}
	if (count === 0) {
		return (
			`No catalog item${scope} matched "${text}". Try a broader term, or search with ` +
			'kinds and no query to see what exists.'
		);
	}
	return `${count} catalog item(s)${scope} matched "${text}", ranked by relevance.`;
}

export function createSearchCatalogTool(registry: CatalogRegistry): ToolSpec {
	return {
		name: 'search_catalog',
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: (input) => execute(registry, input)
	};
}

// Registers search_catalog alone against the live bridge -- deliberately not
// buildDiscoveryTools' full three-tool group (group.ts), which also builds
// search_instruments and describe_catalog_item against an InstrumentDirectory
// this ticket has no reason to wire up. T-0026-3 folds this into the MVP
// composition root's exact-seven-tool registration; until then this is the
// smallest additive change that makes search_catalog reachable.
export async function registerSearchCatalogTool(
	registry: CatalogRegistry = builtinCatalogRegistry
): Promise<void> {
	const mc = ensureModelContext();
	const spec = createSearchCatalogTool(registry);
	await mc.registerTool({
		name: spec.name,
		description: spec.description,
		inputSchema: spec.inputSchema,
		execute: spec.execute
	});
}
