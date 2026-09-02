// `describe_catalog_item`: one item's full declared detail, so an agent can
// configure a study, condition or universe correctly on its first attempt
// rather than discovering the constraints through rejected calls.
//
// API layer. The result is a projection of the registry item, derived rather
// than re-declared, so the two cannot drift apart.

import type { CatalogRegistry } from '../../catalog/registry';
import type { CatalogItem } from '../../catalog/types';
import type { ToolResult, ToolSpec } from '../types';
import { catalogProvenance, fail, ok, readStringArg } from './results';

const DESCRIPTION =
	'Return one catalog item in full: its stable ID, kind, label, description, ' +
	'aliases and tags; every parameter with value type, unit, default, valid range ' +
	'or allowed values, and whether it is required; every output with type and ' +
	"unit; kind-specific detail (a field's nullability and reporting basis, an " +
	"operator's arity, operand types and condition family, an interval's bar " +
	"duration, a universe's membership source, a template's target); and data " +
	'availability with the intervals it covers. An item can be fully described and ' +
	'still be unavailable -- that is a real answer, not a lookup failure, and the ' +
	'reason says whether the blocker is missing data or missing engine support. An ' +
	'unknown ID comes back as an error listing the nearest real IDs, so a near-miss ' +
	'is correctable in one turn.';

const INPUT_SCHEMA = {
	type: 'object',
	properties: {
		itemId: {
			type: 'string',
			minLength: 1,
			description:
				'A stable catalog item ID from search_catalog, e.g. "study.rsi", ' +
				'"field.price.close", "op.crosses_above".'
		}
	},
	required: ['itemId']
};

// Only the fields that exist for this kind, so an agent is not handed a wall
// of nulls it has to work out the meaning of.
function kindDetail(item: CatalogItem): Record<string, unknown> {
	switch (item.kind) {
		case 'field':
			return {
				valueType: item.valueType,
				unit: item.unit ?? null,
				enumValues: item.enumValues ?? null,
				range: item.range ?? null,
				nullable: item.nullable,
				reportingBasis: item.reportingBasis ?? null
			};
		case 'operator':
			return {
				arity: item.arity,
				operandTypes: item.operandTypes,
				resultType: item.resultType,
				conditionFamily: item.conditionFamily
			};
		case 'study':
		case 'indicator':
		case 'pattern':
			return { defaultIntervalId: item.defaultIntervalId };
		case 'interval':
			return { barSeconds: item.barSeconds, sessionAware: item.sessionAware };
		case 'universe':
			return {
				membershipSource: item.membershipSource,
				approximateSize: item.approximateSize ?? null
			};
		case 'template':
			return { appliesTo: item.appliesTo, summary: item.summary };
	}
}

function parametersOf(item: CatalogItem) {
	if (item.kind !== 'study' && item.kind !== 'indicator' && item.kind !== 'pattern') {
		return [];
	}
	return item.parameters.map((parameter) => ({
		name: parameter.name,
		valueType: parameter.valueType,
		unit: parameter.unit ?? null,
		defaultValue: parameter.defaultValue,
		range: parameter.range ?? null,
		enumValues: parameter.enumValues ?? null,
		required: parameter.required
	}));
}

function outputsOf(item: CatalogItem) {
	if (item.kind !== 'study' && item.kind !== 'indicator' && item.kind !== 'pattern') {
		return [];
	}
	return item.outputs.map((output) => ({
		name: output.name,
		valueType: output.valueType,
		unit: output.unit ?? null,
		range: output.range ?? null
	}));
}

async function execute(registry: CatalogRegistry, input: unknown): Promise<ToolResult> {
	const itemId = readStringArg(input, 'itemId')?.trim();
	if (!itemId) {
		return fail('describe_catalog_item requires a non-empty "itemId" string.', {
			receivedInput: input
		});
	}

	const item = registry.getCatalogItem(itemId);
	if (!item) {
		// Suggestions rather than a bare miss: the same one-turn self-correction
		// the existing surface gives on a bad expression.
		const suggestions = registry.suggestCatalogIds(itemId);
		return fail(`No catalog item with ID "${itemId}".`, {
			itemId,
			suggestions,
			hint:
				suggestions.length > 0
					? 'Did you mean one of the suggested IDs? Otherwise use search_catalog to find the right one.'
					: 'Use search_catalog to list what exists, optionally restricted by kind.'
		});
	}

	return ok({
		id: item.id,
		kind: item.kind,
		label: item.label,
		description: item.description,
		aliases: item.aliases,
		tags: item.tags,
		deprecated: item.deprecated ?? false,
		parameters: parametersOf(item),
		outputs: outputsOf(item),
		detail: kindDetail(item),
		availability: {
			status: item.availability.status,
			reason: item.availability.reason ?? null,
			requiresReferenceData: item.availability.requiresReferenceData,
			intervalIds: item.availability.intervalIds,
			earliest: item.availability.earliest ?? null,
			latest: item.availability.latest ?? null
		},
		provenance: catalogProvenance(),
		warnings: []
	});
}

export function createDescribeCatalogItemTool(registry: CatalogRegistry): ToolSpec {
	return {
		name: 'describe_catalog_item',
		description: DESCRIPTION,
		inputSchema: INPUT_SCHEMA,
		available: () => true,
		execute: (input) => execute(registry, input)
	};
}
