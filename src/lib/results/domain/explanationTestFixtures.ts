// Shared test fixtures for explanation.test.ts, explanationRanking.test.ts
// and explanationWire.test.ts. Not itself a *.test.ts file (vitest's
// `include: ['src/**/*.test.ts']` does not pick it up), so importing it
// never re-executes another file's test suite -- only shares plain builder
// functions and sample data.

import { makeProvenance, type MarketDataProvenance } from '../../workbench/domain/provenance';
import type { Condition } from '../../screener/conditions';
import type { GroupOp } from '../../screener/definition';
import {
	passOutcome,
	resolveGroupOutcome,
	resultStanding,
	type ConditionExplanation,
	type ConditionOutcome,
	type FilterNodeExplanation,
	type GroupExplanation,
	type ResultExplanation
} from './explanation';
import { describeCondition } from './explanationRestatement';

export const PASS = passOutcome();

export const PROVENANCE: MarketDataProvenance = makeProvenance({
	asOf: '2026-09-02T00:00:00Z',
	sourceId: 'src.test',
	sourceLabel: 'Test Source',
	timezone: 'UTC',
	liveness: 'delayed',
	delaySeconds: 900
});

export const SCALAR_CONDITION: Condition = {
	type: 'scalar',
	fieldId: 'price',
	operator: 'op.greater_than',
	value: 10,
	unit: 'usd'
};

export function leaf(
	condition: Condition,
	overrides: Partial<ConditionExplanation> = {}
): ConditionExplanation {
	const { restatement, operatorLabel } = describeCondition(condition);
	return {
		nodeId: 'filter_1',
		kind: 'condition',
		enabled: true,
		condition,
		operatorLabel,
		restatement,
		actualValue: { value: 42, unit: null },
		outcome: PASS,
		...overrides
	};
}

export function group(
	op: GroupOp,
	children: FilterNodeExplanation[],
	overrides: Partial<GroupExplanation> = {}
): GroupExplanation {
	return {
		nodeId: 'filter_group_1',
		kind: 'group',
		op,
		enabled: true,
		children,
		outcome: resolveGroupOutcome(
			op,
			children.filter((c) => c.enabled).map((c) => c.outcome as ConditionOutcome)
		),
		...overrides
	};
}

export function baseExplanation(overrides: Partial<ResultExplanation> = {}): ResultExplanation {
	return {
		instrumentId: 'AAPL',
		runId: 'run_1',
		screenerId: 'screener_1',
		screenerRevision: 3,
		filterTree: leaf(SCALAR_CONDITION),
		ranking: null,
		standing: resultStanding(1),
		provenance: PROVENANCE,
		...overrides
	};
}
