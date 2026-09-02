// The discovery tool group: one builder, explicit dependencies, three ready
// tool specs.
//
// Composing the new WebMCP surface should be a list of builder calls, not a
// merge negotiation between the epics that own each group. So this module
// holds no module-level singleton source: a real reference-data adapter is
// supplied here as a parameter, without editing this file or its callers'
// internals.
//
// Whether the group is registered on the live page is the new surface's
// composition root's decision, not this module's. Nothing here touches
// register.ts, session.ts, tools.ts or +page.svelte, so the existing 11-tool
// surface -- its tool count, its activity log -- is identical whether or not
// this group is composed in.

import { builtinCatalogRegistry, type CatalogRegistry } from '../../catalog/registry';
import type { InstrumentDirectory } from '../../discovery/ports';
import type { ToolSpec } from '../types';
import { createDescribeCatalogItemTool } from './describeCatalogItem';
import { createSearchCatalogTool } from './searchCatalog';
import { createSearchInstrumentsTool } from './searchInstruments';

export interface DiscoveryToolDeps {
	directory: InstrumentDirectory;
	// Defaults to the built-in inventory. A parameter rather than an import
	// inside the tools so a test can drive them against a small fixed catalog.
	registry?: CatalogRegistry;
}

export const DISCOVERY_TOOL_NAMES = [
	'search_instruments',
	'search_catalog',
	'describe_catalog_item'
] as const;

export function buildDiscoveryTools(deps: DiscoveryToolDeps): ToolSpec[] {
	const registry = deps.registry ?? builtinCatalogRegistry;
	return [
		createSearchInstrumentsTool(deps.directory),
		createSearchCatalogTool(registry),
		createDescribeCatalogItemTool(registry)
	];
}
