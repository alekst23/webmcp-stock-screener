import { describe, expect, it } from 'vitest';
import type { CatalogRegistry } from '../catalog/registry';
import type { CatalogItem } from '../catalog/types';
import type { TemporalCondition, PatternCondition } from './conditions';
import type { ConditionNode, FilterNode, GroupNode } from './definition';
import { approximateGranularity } from './granularityApproximation';

// Mirrors conditionValidation.catalog.test.ts's fixtureRegistry pattern: a
// small fixed inventory behaving like the real registry's query semantics.
function fixtureRegistry(items: CatalogItem[]): CatalogRegistry {
	const byId = new Map(items.map((item) => [item.id, item]));
	return {
		getCatalogItem: (id) => byId.get(id),
		listCatalogItems: (kind) => (kind ? items.filter((i) => i.kind === kind) : items),
		searchCatalogItems: () => [],
		isOperatorValidForField: () => ({ valid: true }),
		resolveStudy: () => undefined,
		suggestCatalogIds: () => []
	};
}

const DAILY: CatalogItem = {
	id: 'interval.1d',
	kind: 'interval',
	label: '1 day',
	description: 'Daily bars.',
	aliases: [],
	tags: [],
	barSeconds: 86_400,
	sessionAware: true,
	availability: { status: 'available', requiresReferenceData: false, intervalIds: [] }
};

const HOURLY: CatalogItem = {
	id: 'interval.1h',
	kind: 'interval',
	label: '1 hour',
	description: 'Hourly bars.',
	aliases: [],
	tags: [],
	barSeconds: 3600,
	sessionAware: true,
	availability: {
		status: 'unavailable',
		reason: 'no intraday data',
		requiresReferenceData: false,
		intervalIds: []
	}
};

const WEEKLY: CatalogItem = {
	id: 'interval.1w',
	kind: 'interval',
	label: '1 week',
	description: 'Weekly bars.',
	aliases: [],
	tags: [],
	barSeconds: 604_800,
	sessionAware: false,
	availability: {
		status: 'unavailable',
		reason: 'no resampling',
		requiresReferenceData: false,
		intervalIds: []
	}
};

function temporalNode(nodeId: string, intervalId: string): ConditionNode {
	const inner: TemporalCondition = {
		type: 'temporal',
		condition: {
			type: 'scalar',
			fieldId: 'field.price.close',
			operator: 'op.greater_than',
			value: 10,
			unit: null
		},
		event: 'became_true',
		withinBars: 5,
		intervalId
	};
	return { nodeId, kind: 'condition', condition: inner, enabled: true };
}

function patternNode(nodeId: string, intervalId: string): ConditionNode {
	const inner: PatternCondition = {
		type: 'pattern',
		patternId: 'pattern.x',
		minConfidence: 0.5,
		intervalId
	};
	return { nodeId, kind: 'condition', condition: inner, enabled: true };
}

function rootOf(...children: FilterNode[]): GroupNode {
	return { nodeId: 'root', kind: 'group', op: 'and', children, enabled: true };
}

describe('approximateGranularity', () => {
	it('substitutes_unavailableInterval_withTheSoleAvailableOne', () => {
		const registry = fixtureRegistry([DAILY, HOURLY]);
		const tree = rootOf(temporalNode('n1', 'interval.1h'));
		const { tree: next, approximations } = approximateGranularity(tree, registry);

		expect(approximations, 'exactly one substitution must be reported').toHaveLength(1);
		expect(approximations[0]).toEqual({
			nodeId: 'n1',
			requestedIntervalId: 'interval.1h',
			usedIntervalId: 'interval.1d'
		});
		const node = (next as GroupNode).children[0] as ConditionNode;
		const condition = node.condition as TemporalCondition;
		expect(condition.intervalId, 'the stored condition must use the substituted interval').toBe(
			'interval.1d'
		);
	});

	it('leavesAlreadyAvailableInterval_untouched', () => {
		const registry = fixtureRegistry([DAILY, HOURLY]);
		const tree = rootOf(temporalNode('n1', 'interval.1d'));
		const { tree: next, approximations } = approximateGranularity(tree, registry);

		expect(approximations, 'an already-available interval needs no substitution').toEqual([]);
		expect(next, 'an unchanged tree should be returned as-is (no new object identity needed)').toBe(
			tree
		);
	});

	it('doesNotGuess_whenMultipleIntervalsAreAvailable', () => {
		const bothAvailable = { ...HOURLY, availability: { ...DAILY.availability } };
		const registry = fixtureRegistry([DAILY, bothAvailable]);
		const tree = rootOf(temporalNode('n1', 'interval.1w'));
		const { approximations } = approximateGranularity(tree, registry);

		expect(
			approximations,
			'with more than one available interval, substitution is ambiguous and must not happen'
		).toEqual([]);
	});

	it('leavesUnknownIntervalId_forCatalogValidationToReject', () => {
		const registry = fixtureRegistry([DAILY]);
		const tree = rootOf(temporalNode('n1', 'interval.no_such_thing'));
		const { tree: next, approximations } = approximateGranularity(tree, registry);

		expect(approximations, "an unrecognized interval id is not this module's job to fix").toEqual(
			[]
		);
		const node = (next as GroupNode).children[0] as ConditionNode;
		expect((node.condition as TemporalCondition).intervalId).toBe('interval.no_such_thing');
	});

	it('appliesToPatternConditions_too', () => {
		const registry = fixtureRegistry([DAILY, HOURLY]);
		const tree = rootOf(patternNode('n2', 'interval.1h'));
		const { tree: next, approximations } = approximateGranularity(tree, registry);

		expect(approximations).toHaveLength(1);
		const node = (next as GroupNode).children[0] as ConditionNode;
		expect((node.condition as PatternCondition).intervalId).toBe('interval.1d');
	});

	it('recursesIntoNestedGroups', () => {
		const registry = fixtureRegistry([DAILY, HOURLY]);
		const nested = rootOf(rootOf(temporalNode('deep', 'interval.1h')) as unknown as FilterNode);
		const { approximations } = approximateGranularity(nested, registry);
		expect(approximations.map((a) => a.nodeId)).toEqual(['deep']);
	});

	it('leavesNonIntervalConditions_untouched', () => {
		const registry = fixtureRegistry([DAILY, HOURLY]);
		const scalar: ConditionNode = {
			nodeId: 'n3',
			kind: 'condition',
			enabled: true,
			condition: {
				type: 'scalar',
				fieldId: 'field.price.close',
				operator: 'op.greater_than',
				value: 10,
				unit: null
			}
		};
		const tree = rootOf(scalar);
		const { tree: next, approximations } = approximateGranularity(tree, registry);
		expect(approximations).toEqual([]);
		expect(next).toBe(tree);
	});
});
