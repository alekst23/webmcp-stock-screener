// Pure text summarization of a screener's filter tree and universe, for the
// read-only filter_builder panel body (T-0027-1). Renders a flat outline
// the panel body turns into a nested list -- no Svelte, no I/O, and no
// knowledge of the panel registry, so this stays unit-testable on its own
// and reusable if another read-only view of a screener ever needs the same
// summary.
import type { Condition, RelativeBaseline } from '../conditions';
import type { FilterNode, RankingSpec, UniverseSpec } from '../definition';

export interface FilterOutlineLine {
	depth: number;
	text: string;
}

const OPERATOR_LABEL: Record<string, string> = {
	eq: '=',
	ne: '≠',
	gt: '>',
	gte: '≥',
	lt: '<',
	lte: '≤'
};

function operatorLabel(operator: string): string {
	return OPERATOR_LABEL[operator] ?? operator;
}

// A short, human-readable label per condition family. Deliberately terse --
// this is a mirror of agent-driven state (T-0027-1 AC4), not an editor, so
// it favors "enough to verify at a glance" over exhaustively restating
// every field.
export function summarizeCondition(condition: Condition): string {
	switch (condition.type) {
		case 'scalar':
			return `${condition.fieldId} ${operatorLabel(condition.operator)} ${condition.value}${condition.unit ? ` ${condition.unit}` : ''}`;
		case 'range':
			return `${condition.fieldId} ${condition.lowerInclusive ? '[' : '('}${condition.lower}, ${condition.upper}${condition.upperInclusive ? ']' : ')'}`;
		case 'series_comparison':
			return `${condition.left.catalogId} ${operatorLabel(condition.operator)} ${condition.right.catalogId}`;
		case 'temporal':
			return `${summarizeCondition(condition.condition)} (${condition.event}, within ${condition.withinBars} bars)`;
		case 'event_relative':
			return `${condition.eventTypeId} in the ${condition.direction} ${condition.windowDays}d`;
		case 'pattern':
			return `pattern ${condition.patternId} (min confidence ${condition.minConfidence})`;
		case 'relative':
			return `${condition.fieldId} ${operatorLabel(condition.operator)} ${condition.multiple}x ${describeBaseline(condition.baseline)}`;
		case 'study_output':
			return `${condition.studyId}.${condition.outputName} ${condition.predicate}`;
		default:
			// Exhaustiveness guard: a new Condition variant fails typecheck here
			// before it can silently render as nothing.
			return ((): never => {
				throw new Error(`Unknown condition type: ${JSON.stringify(condition)}`);
			})();
	}
}

function describeBaseline(baseline: RelativeBaseline): string {
	switch (baseline.kind) {
		case 'own_moving_average':
			return `its own ${baseline.windowBars}-bar average`;
		case 'peer_group':
			return `peer group ${baseline.groupId}`;
		case 'index':
			return `index ${baseline.indexId}`;
	}
}

function nodeOutline(node: FilterNode, depth: number): FilterOutlineLine[] {
	if (node.kind === 'condition') {
		const prefix = node.enabled ? '' : '(disabled) ';
		return [{ depth, text: `${prefix}${summarizeCondition(node.condition)}` }];
	}
	const prefix = node.enabled ? '' : '(disabled) ';
	const header: FilterOutlineLine = {
		depth,
		text: `${prefix}${node.op.toUpperCase()}${node.children.length === 0 ? ' (empty)' : ''}`
	};
	return [header, ...node.children.flatMap((child) => nodeOutline(child, depth + 1))];
}

// Flattened depth-first outline of the whole tree -- the panel body renders
// each line indented by `depth`, with no recursive component structure of
// its own to keep in sync with FilterNode's shape.
export function summarizeFilterTree(root: FilterNode): FilterOutlineLine[] {
	return nodeOutline(root, 0);
}

function nonEmpty(values: readonly string[]): string[] {
	return values.filter((v) => v.length > 0);
}

// One line per populated universe dimension; an unconstrained universe (the
// normalized-empty default) summarizes to a single explicit line rather
// than an empty list, so the panel never renders a silently blank section.
export function summarizeUniverse(universe: UniverseSpec): string[] {
	const lines: string[] = [];
	if (universe.assetClass) {
		lines.push(`Asset class: ${universe.assetClass}`);
	}
	if (universe.exchanges.length > 0) {
		lines.push(`Exchanges: ${universe.exchanges.join(', ')}`);
	}
	if (universe.countries.length > 0) {
		lines.push(`Countries: ${universe.countries.join(', ')}`);
	}
	const groups = nonEmpty([
		universe.sectors.length > 0 ? `sectors (${universe.sectors.length})` : '',
		universe.industries.length > 0 ? `industries (${universe.industries.length})` : '',
		universe.indexes.length > 0 ? `indexes (${universe.indexes.length})` : '',
		universe.watchlists.length > 0 ? `watchlists (${universe.watchlists.length})` : ''
	]);
	if (groups.length > 0) {
		lines.push(`Groups: ${groups.join(', ')}`);
	}
	const { minPrice, minAverageVolume, minMarketCap } = universe.liquidity;
	const liquidity = nonEmpty([
		minPrice !== null ? `min price ${minPrice}` : '',
		minAverageVolume !== null ? `min avg volume ${minAverageVolume}` : '',
		minMarketCap !== null ? `min market cap ${minMarketCap}` : ''
	]);
	if (liquidity.length > 0) {
		lines.push(`Liquidity: ${liquidity.join(', ')}`);
	}
	const exclusions = nonEmpty([
		universe.exclusions.instrumentIds.length > 0
			? `${universe.exclusions.instrumentIds.length} instruments`
			: '',
		universe.exclusions.sectorIds.length > 0 ? `${universe.exclusions.sectorIds.length} sectors` : '',
		universe.exclusions.industryIds.length > 0
			? `${universe.exclusions.industryIds.length} industries`
			: ''
	]);
	if (exclusions.length > 0) {
		lines.push(`Excluding: ${exclusions.join(', ')}`);
	}
	return lines.length > 0 ? lines : ['No universe constraints set.'];
}

// null means "the documented default order" (definition.ts's own
// normalizeRanking comment) -- rendered as an explicit statement, not a
// blank ranking section.
export function summarizeRanking(ranking: RankingSpec | null): string {
	if (ranking === null) {
		return 'Default order (no ranking configured).';
	}
	if (ranking.fields.length === 0) {
		return `Default order, limit ${ranking.limit}.`;
	}
	const fields = ranking.fields
		.map((f) => `${f.fieldId} ${f.direction}${f.weight !== 1 ? ` ×${f.weight}` : ''}`)
		.join(', ');
	return `Ranked by ${fields}, limit ${ranking.limit}.`;
}
