// Composes a workspace's computed fields and custom studies over a base
// catalog registry (T-1014-2, "Registration into the catalog is EPIC-1008's
// contract. Register through it rather than maintaining a second, parallel
// list."). `catalog/registry.ts`'s CatalogRegistry is a published interface
// every consumer already takes as an injected parameter, defaulting to
// builtinCatalogRegistry -- this is a second *implementation* of that same
// interface, not a change to EPIC-1008's own module. Nothing in
// catalog/registry.ts or catalog/items.ts is modified.
//
// Domain layer: no I/O. Depends only on the published CatalogRegistry port
// and this ticket's own record modules.
import { builtinCatalogRegistry, type CatalogRegistry } from '../../../catalog/registry';
import type {
	CatalogItem,
	CatalogKind,
	CatalogMatch,
	CatalogMatchAttribute,
	CatalogQuery,
	OperatorFieldCheck,
	StudyItem
} from '../../../catalog/types';
import type { WorkspaceDocument } from '../../domain/workspace';
import { readComputedFields, toFieldItem } from './computedField';
import { readCustomStudies, toStudyItem } from './customStudy';

function overlayItemsFor(doc: WorkspaceDocument): CatalogItem[] {
	return [...readComputedFields(doc).map(toFieldItem), ...readCustomStudies(doc).map(toStudyItem)];
}

// A workspace item's id namespace ("field.custom.*"/"study.custom.*") never
// collides with anything items.ts declares, so overlay-first lookup can
// never shadow a built-in item -- it only ever adds.
function searchOverlay(items: readonly CatalogItem[], query: CatalogQuery): CatalogMatch[] {
	const kinds = query.kinds;
	const needle = query.text?.trim().toLowerCase() ?? '';
	const matchedOn: CatalogMatchAttribute = needle === '' ? 'enumeration' : 'id';
	return items
		.filter((item) => !kinds || kinds.includes(item.kind))
		.filter(
			(item) =>
				needle === '' ||
				item.id.toLowerCase().includes(needle) ||
				item.label.toLowerCase().includes(needle)
		)
		.map((item) => ({ item, score: needle === '' ? 0 : 100, matchedOn }));
}

function mergeMatches(overlay: CatalogMatch[], base: CatalogMatch[]): CatalogMatch[] {
	const seen = new Set(overlay.map((m) => m.item.id));
	return [...overlay, ...base.filter((m) => !seen.has(m.item.id))];
}

// Builds a CatalogRegistry that resolves a workspace's computed fields and
// custom studies alongside `base`'s built-in inventory (AC2, AC4). Every
// method checks the overlay first, so a workspace item is indistinguishable
// from a built-in one to any sibling epic's own, unmodified validators.
export function composeWorkspaceCatalogRegistry(
	doc: WorkspaceDocument,
	base: CatalogRegistry = builtinCatalogRegistry
): CatalogRegistry {
	const overlayItems = overlayItemsFor(doc);
	const overlayById = new Map(overlayItems.map((item) => [item.id, item]));

	function getCatalogItem(id: string): CatalogItem | undefined {
		return overlayById.get(id) ?? base.getCatalogItem(id);
	}

	function listCatalogItems(kind?: CatalogKind): readonly CatalogItem[] {
		const overlay = kind ? overlayItems.filter((item) => item.kind === kind) : overlayItems;
		return [...overlay, ...base.listCatalogItems(kind)];
	}

	function isOperatorValidForField(operatorId: string, fieldId: string): OperatorFieldCheck {
		const operator = getCatalogItem(operatorId);
		const field = getCatalogItem(fieldId);
		if (!operator || operator.kind !== 'operator') {
			return { valid: false, reason: `"${operatorId}" is not a known operator ID.` };
		}
		if (!field || field.kind !== 'field') {
			return { valid: false, reason: `"${fieldId}" is not a known field ID.` };
		}
		if (!operator.operandTypes.includes(field.valueType)) {
			return {
				valid: false,
				reason:
					`Operator "${operator.id}" accepts operands of type ${operator.operandTypes.join(', ')}, ` +
					`but field "${field.id}" is of type "${field.valueType}".`
			};
		}
		return { valid: true };
	}

	function resolveStudy(studyId: string): StudyItem | undefined {
		const overlay = overlayById.get(studyId);
		if (overlay) {
			return overlay.kind === 'study' ? overlay : undefined;
		}
		return base.resolveStudy(studyId);
	}

	function suggestCatalogIds(unknownId: string, max = 5): string[] {
		const needle = unknownId.trim().toLowerCase();
		const overlaySuggestions =
			needle === ''
				? []
				: overlayItems
						.filter((item) => item.id.toLowerCase().includes(needle))
						.map((item) => item.id);
		const baseSuggestions = base.suggestCatalogIds(unknownId, max);
		return [...new Set([...overlaySuggestions, ...baseSuggestions])].slice(0, max);
	}

	return {
		getCatalogItem,
		listCatalogItems,
		searchCatalogItems: (query) =>
			mergeMatches(searchOverlay(overlayItems, query), base.searchCatalogItems(query)),
		isOperatorValidForField,
		resolveStudy,
		suggestCatalogIds
	};
}
