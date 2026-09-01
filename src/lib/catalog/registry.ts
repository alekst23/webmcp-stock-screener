// The catalog registry query surface. Published contract: EPIC-1009 validates
// filter conditions through `isOperatorValidForField`, EPIC-1011 resolves
// study configuration through `resolveStudy`. Narrow, total, and free of tool-
// or UI-specific concepts on purpose.
//
// Query logic only -- the inventory itself is items.ts, so a real data source
// can later contribute or override availability records without touching how
// the catalog is searched.
//
// Domain layer: no I/O, no imports from src/lib/webmcp/.

import { CATALOG_ITEMS } from './items';
import type {
	CatalogItem,
	CatalogKind,
	CatalogMatch,
	CatalogMatchAttribute,
	CatalogQuery,
	FieldItem,
	OperatorFieldCheck,
	OperatorItem,
	StudyItem
} from './types';

export const MAX_CATALOG_RESULTS = 50;
export const DEFAULT_CATALOG_RESULTS = 20;

// Frozen at module load: two sibling epics hold references to what these
// functions return, and a caller mutating a shared item would corrupt the
// inventory for everyone.
const ITEMS: readonly CatalogItem[] = Object.freeze(
	CATALOG_ITEMS.map((item) => Object.freeze({ ...item }))
);

const BY_ID: ReadonlyMap<string, CatalogItem> = new Map(ITEMS.map((item) => [item.id, item]));

export function listCatalogItems(kind?: CatalogKind): readonly CatalogItem[] {
	return kind ? ITEMS.filter((item) => item.kind === kind) : ITEMS;
}

export function getCatalogItem(id: string): CatalogItem | undefined {
	return BY_ID.get(id);
}

export function clampCatalogLimit(limit: number | undefined): { limit: number; clamped: boolean } {
	if (limit === undefined) {
		return { limit: DEFAULT_CATALOG_RESULTS, clamped: false };
	}
	const floored = Math.floor(limit);
	if (!Number.isFinite(floored) || floored < 1) {
		return { limit: 1, clamped: true };
	}
	if (floored > MAX_CATALOG_RESULTS) {
		return { limit: MAX_CATALOG_RESULTS, clamped: true };
	}
	return { limit: floored, clamped: false };
}

// Scores are a fixed ladder rather than a tuned relevance function: an agent
// that cannot anticipate the ordering will re-query instead of trusting it.
// Exact identifier beats exact label beats exact alias beats prefix beats
// substring beats tag beats description.
const SCORES = {
	idExact: 100,
	labelExact: 90,
	aliasExact: 80,
	idPrefix: 70,
	labelPrefix: 60,
	aliasPrefix: 50,
	idSubstring: 40,
	labelSubstring: 35,
	aliasSubstring: 30,
	tagExact: 20,
	descriptionSubstring: 10
} as const;

interface Scored {
	score: number;
	matchedOn: CatalogMatchAttribute;
}

function scoreText(item: CatalogItem, needle: string): Scored | null {
	const id = item.id.toLowerCase();
	const label = item.label.toLowerCase();
	const aliases = item.aliases.map((a) => a.toLowerCase());

	if (id === needle) return { score: SCORES.idExact, matchedOn: 'id' };
	if (label === needle) return { score: SCORES.labelExact, matchedOn: 'label' };
	if (aliases.includes(needle)) return { score: SCORES.aliasExact, matchedOn: 'alias' };
	if (id.startsWith(needle)) return { score: SCORES.idPrefix, matchedOn: 'id' };
	if (label.startsWith(needle)) return { score: SCORES.labelPrefix, matchedOn: 'label' };
	if (aliases.some((a) => a.startsWith(needle)))
		return { score: SCORES.aliasPrefix, matchedOn: 'alias' };
	if (id.includes(needle)) return { score: SCORES.idSubstring, matchedOn: 'id' };
	if (label.includes(needle)) return { score: SCORES.labelSubstring, matchedOn: 'label' };
	if (aliases.some((a) => a.includes(needle)))
		return { score: SCORES.aliasSubstring, matchedOn: 'alias' };
	if (item.tags.some((t) => t.toLowerCase() === needle))
		return { score: SCORES.tagExact, matchedOn: 'tag' };
	if (item.description.toLowerCase().includes(needle))
		return { score: SCORES.descriptionSubstring, matchedOn: 'description' };
	return null;
}

export function searchCatalogItems(query: CatalogQuery): CatalogMatch[] {
	const needle = query.text?.trim().toLowerCase() ?? '';
	const kinds = query.kinds;
	const includeUnavailable = query.includeUnavailable ?? true;
	const { limit } = clampCatalogLimit(query.limit);

	const matches: CatalogMatch[] = [];
	for (const item of ITEMS) {
		if (kinds && !kinds.includes(item.kind)) {
			continue;
		}
		if (!includeUnavailable && item.availability.status === 'unavailable') {
			continue;
		}
		// An empty query is enumeration, not a match-everything search: every
		// item of the requested kinds is listed in registry order.
		if (needle === '') {
			matches.push({ item, score: 0, matchedOn: 'enumeration' });
			continue;
		}
		const scored = scoreText(item, needle);
		if (scored) {
			matches.push({ item, score: scored.score, matchedOn: scored.matchedOn });
		}
	}
	// Ties break on ID so the ordering is stable across calls rather than
	// dependent on insertion order the caller cannot see.
	matches.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
	return matches.slice(0, limit);
}

// EPIC-1009's validation hook. Reports a reason on failure so the filter tool
// can hand the agent something it can act on in one turn rather than a bare
// false.
export function isOperatorValidForField(operatorId: string, fieldId: string): OperatorFieldCheck {
	const operator = BY_ID.get(operatorId);
	const field = BY_ID.get(fieldId);
	if (!operator || operator.kind !== 'operator') {
		return { valid: false, reason: `"${operatorId}" is not a known operator ID.` };
	}
	if (!field || field.kind !== 'field') {
		return { valid: false, reason: `"${fieldId}" is not a known field ID.` };
	}
	if (!operatorAcceptsField(operator, field)) {
		return {
			valid: false,
			reason:
				`Operator "${operator.id}" accepts operands of type ` +
				`${operator.operandTypes.join(', ')}, but field "${field.id}" is of type ` +
				`"${field.valueType}".`
		};
	}
	return { valid: true };
}

function operatorAcceptsField(operator: OperatorItem, field: FieldItem): boolean {
	return operator.operandTypes.includes(field.valueType);
}

// EPIC-1011's resolution hook.
export function resolveStudy(studyId: string): StudyItem | undefined {
	const item = BY_ID.get(studyId);
	return item?.kind === 'study' ? item : undefined;
}

// Cheap and deterministic on purpose: describe_catalog_item calls it only on a
// miss, and an agent needs a suggestion it can predict, not the best one.
export function suggestCatalogIds(unknownId: string, max = 5): string[] {
	const needle = unknownId.trim().toLowerCase();
	if (needle === '') {
		return [];
	}
	const scored = ITEMS.map((item) => ({ id: item.id, distance: similarityDistance(item, needle) }))
		.filter((entry) => entry.distance < Infinity)
		.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
	return scored.slice(0, max).map((entry) => entry.id);
}

// Lower is closer. Shared prefix, then a containment check on the last segment,
// then the alias list -- no edit distance, because a predictable suggestion
// beats a marginally better unpredictable one.
function similarityDistance(item: CatalogItem, needle: string): number {
	const id = item.id.toLowerCase();
	if (id === needle) {
		return 0;
	}
	const tail = needle.slice(needle.lastIndexOf('.') + 1);
	if (tail !== '' && id.endsWith(`.${tail}`)) {
		return 1;
	}
	if (tail !== '' && id.includes(tail)) {
		return 2;
	}
	if (item.aliases.some((alias) => alias.toLowerCase() === tail)) {
		return 3;
	}
	const shared = sharedPrefixLength(id, needle);
	return shared > 0 ? 10 - Math.min(shared, 9) : Infinity;
}

function sharedPrefixLength(a: string, b: string): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) {
		i += 1;
	}
	return i;
}
