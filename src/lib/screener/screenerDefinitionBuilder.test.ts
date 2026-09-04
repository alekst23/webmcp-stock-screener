import { describe, expect, it } from 'vitest';
import type { ConditionNode, GroupNode } from './definition';
import { buildFilterTree, type NodeIdFactory } from './screenerDefinitionBuilder';
import { PROBLEM_CODES, type ValidationProblem } from './validation';

function idFactory(): NodeIdFactory {
	let n = 0;
	return () => `n${++n}`;
}

function scalarWire(fieldId = 'field.price.close', value: unknown = 10) {
	return { type: 'scalar', fieldId, operator: 'op.greater_than', value, unit: null };
}

describe('buildFilterTree', () => {
	it('emptyInput_returnsAnEmptyRootGroup', () => {
		const problems: ValidationProblem[] = [];
		const tree = buildFilterTree(undefined, idFactory(), problems) as GroupNode;
		expect(problems).toEqual([]);
		expect(tree).toMatchObject({ kind: 'group', op: 'and', children: [] });
	});

	it('bareCondition_isWrappedInAnImplicitAndRoot', () => {
		const problems: ValidationProblem[] = [];
		const tree = buildFilterTree(scalarWire(), idFactory(), problems) as GroupNode;
		expect(problems).toEqual([]);
		expect(tree.kind).toBe('group');
		expect(tree.children).toHaveLength(1);
		const child = tree.children[0] as ConditionNode;
		expect(child.condition.type).toBe('scalar');
	});

	it('bareCondition_withEnabledFalse_isStoredDisabled_withoutTriggeringTheRawCodeCheck', () => {
		const problems: ValidationProblem[] = [];
		const tree = buildFilterTree(
			{ ...scalarWire(), enabled: false },
			idFactory(),
			problems
		) as GroupNode;
		expect(
			problems,
			'a node-level "enabled" key on a bare condition must not look like a stray field'
		).toEqual([]);
		const child = tree.children[0] as ConditionNode;
		expect(child.enabled).toBe(false);
	});

	it('arrayOfNodes_becomesTheRootGroupsChildren', () => {
		const problems: ValidationProblem[] = [];
		const tree = buildFilterTree(
			[scalarWire('field.price.close'), scalarWire('field.volume')],
			idFactory(),
			problems
		) as GroupNode;
		expect(problems).toEqual([]);
		expect(tree.children).toHaveLength(2);
	});

	it('explicitGroup_honorsItsOwnOp', () => {
		const problems: ValidationProblem[] = [];
		const tree = buildFilterTree(
			{ kind: 'group', op: 'or', children: [scalarWire()] },
			idFactory(),
			problems
		) as GroupNode;
		expect(tree.op).toBe('or');
	});

	it('nestedGroups_buildToArbitraryDepth', () => {
		const problems: ValidationProblem[] = [];
		const tree = buildFilterTree(
			{
				kind: 'group',
				op: 'and',
				children: [
					{ kind: 'group', op: 'or', children: [scalarWire(), scalarWire('field.volume')] }
				]
			},
			idFactory(),
			problems
		) as GroupNode;
		expect(problems).toEqual([]);
		const inner = tree.children[0] as GroupNode;
		expect(inner.kind).toBe('group');
		expect(inner.children).toHaveLength(2);
	});

	it('notGroup_withWrongArity_reportsAProblem_butStillCollectsSiblingProblems', () => {
		const problems: ValidationProblem[] = [];
		buildFilterTree(
			{
				kind: 'group',
				op: 'not',
				children: [scalarWire(), scalarWire('field.volume')]
			},
			idFactory(),
			problems
		);
		expect(problems.some((p) => p.message.includes('"not" group'))).toBe(true);
	});

	it('rawCodeField_onACondition_isRejected_namingTheField', () => {
		const problems: ValidationProblem[] = [];
		buildFilterTree({ ...scalarWire(), sql: 'DROP TABLE' }, idFactory(), problems);
		expect(problems).toHaveLength(1);
		expect(problems[0]?.message).toContain('sql');
		expect(problems[0]?.severity).toBe('blocking');
	});

	it('unknownConditionType_isRejected_notSilentlyDropped', () => {
		const problems: ValidationProblem[] = [];
		buildFilterTree({ type: 'not_a_real_type' }, idFactory(), problems);
		expect(problems).toHaveLength(1);
		expect(problems[0]?.code).toBe(PROBLEM_CODES.unknownConditionType);
	});

	it('everyProblemInThePayload_isCollected_notJustTheFirst', () => {
		// AC4: two independent problems (raw code + an unparseable second
		// condition) in one call must both come back.
		const problems: ValidationProblem[] = [];
		buildFilterTree(
			[{ ...scalarWire(), js: 'alert(1)' }, { type: 'still_not_real' }],
			idFactory(),
			problems
		);
		expect(problems).toHaveLength(2);
	});

	it('unrecognizedShape_isRejected_withoutThrowing', () => {
		const problems: ValidationProblem[] = [];
		expect(() => buildFilterTree(42, idFactory(), problems)).not.toThrow();
		expect(problems.length).toBeGreaterThan(0);
	});
});
