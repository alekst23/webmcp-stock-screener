import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../../catalog/registry';
import type { CustomStudyRecord } from './customStudy';
import {
	resolveCustomStudyExpression,
	resolveNodeAtPath,
	resolveParameterDeclarations,
	type RawParameterDeclaration
} from './customStudyParameters';
import type { ExpressionNode, ValidatedExpression } from './expressionModel';

const NOW = '2026-09-02T00:00:00.000Z';

// sma(field.close, length=10) - field.close: an arithmetic combination whose
// left branch is a function_call, giving something to bind "root.left" +
// "length" onto in the parameter tests below.
const SMA_CALL: ExpressionNode = {
	kind: 'function_call',
	functionId: 'study.sma',
	args: { length: 10 },
	outputName: 'sma'
};

const CLOSE_REF: ExpressionNode = { kind: 'field_ref', fieldId: 'field.price.close' };

const EXPRESSION: ValidatedExpression = {
	node: { kind: 'arithmetic', op: '-', left: SMA_CALL, right: CLOSE_REF },
	resultType: 'number',
	resultUnit: undefined,
	usage: 'numeric_column'
};

function makeRecord(overrides: Partial<CustomStudyRecord> = {}): CustomStudyRecord {
	return {
		id: 'study.custom.1',
		workspaceId: 'workspace_1',
		name: 'SMA distance',
		expression: EXPRESSION,
		parameters: [],
		catalogParameters: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

describe('resolveNodeAtPath', () => {
	it('resolves "root" to the whole tree', () => {
		expect(resolveNodeAtPath(EXPRESSION.node, 'root')).toBe(EXPRESSION.node);
	});

	it('resolves "root.left"/"root.right" through arithmetic edges', () => {
		expect(resolveNodeAtPath(EXPRESSION.node, 'root.left')).toBe(SMA_CALL);
		expect(resolveNodeAtPath(EXPRESSION.node, 'root.right')).toBe(CLOSE_REF);
	});

	it('returns null for a path that runs past a leaf', () => {
		expect(resolveNodeAtPath(EXPRESSION.node, 'root.left.left')).toBeNull();
	});

	it('returns null for a malformed path', () => {
		expect(resolveNodeAtPath(EXPRESSION.node, 'left')).toBeNull();
		expect(resolveNodeAtPath(EXPRESSION.node, 'root.up')).toBeNull();
	});
});

describe('resolveParameterDeclarations (AC3)', () => {
	function declare(overrides: Partial<RawParameterDeclaration> = {}): RawParameterDeclaration {
		return { name: 'window', nodePath: 'root.left', argName: 'length', ...overrides };
	}

	it('resolves a valid declaration into a CatalogParameter matching the underlying study.sma length param', () => {
		const result = resolveParameterDeclarations(
			[declare({ range: { min: 5, max: 50 } })],
			EXPRESSION,
			builtinCatalogRegistry
		);
		if (!result.ok) throw new Error(`expected ok, got issues: ${result.issues.join('; ')}`);
		expect(result.catalogParameters).toEqual([
			{
				name: 'window',
				valueType: 'number',
				unit: 'bars',
				defaultValue: 10, // whatever the author's own expression already had
				range: { min: 5, max: 50 },
				enumValues: undefined,
				required: false
			}
		]);
		expect(result.parameters).toEqual([
			{ name: 'window', nodePath: 'root.left', argName: 'length', range: { min: 5, max: 50 } }
		]);
	});

	it("inherits the underlying argument's own range when none is declared", () => {
		const result = resolveParameterDeclarations([declare()], EXPRESSION, builtinCatalogRegistry);
		if (!result.ok) throw new Error('expected ok');
		expect(result.catalogParameters[0]?.range).toEqual({ min: 1, max: 500 });
	});

	it("rejects a declared range wider than the underlying argument's own range (AC5/AC7-style bound)", () => {
		const result = resolveParameterDeclarations(
			[declare({ range: { min: 0, max: 500 } })],
			EXPRESSION,
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
	});

	it('names the offending nodePath when it does not resolve (AC5)', () => {
		const result = resolveParameterDeclarations(
			[declare({ nodePath: 'root.left.left' })],
			EXPRESSION,
			builtinCatalogRegistry
		);
		if (result.ok) throw new Error('expected a rejection');
		expect(result.issues[0]).toContain('root.left.left');
	});

	it('rejects a nodePath that resolves to something other than a function_call', () => {
		const result = resolveParameterDeclarations(
			[declare({ nodePath: 'root.right', argName: 'length' })],
			EXPRESSION,
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
	});

	it('names permitted argument names when argName is not declared by the function (AC5)', () => {
		const result = resolveParameterDeclarations(
			[declare({ argName: 'nonexistent' })],
			EXPRESSION,
			builtinCatalogRegistry
		);
		if (result.ok) throw new Error('expected a rejection');
		expect(result.issues[0]).toContain('length'); // the permitted alternative
	});

	it('rejects two parameters declared under the same name', () => {
		const result = resolveParameterDeclarations(
			[declare(), declare({ nodePath: 'root.left' })],
			EXPRESSION,
			builtinCatalogRegistry
		);
		expect(result.ok).toBe(false);
	});
});

describe('resolveCustomStudyExpression: call-time override substitution', () => {
	function studyWithWindowParam(): CustomStudyRecord {
		const resolved = resolveParameterDeclarations(
			[{ name: 'window', nodePath: 'root.left', argName: 'length', range: { min: 5, max: 50 } }],
			EXPRESSION,
			builtinCatalogRegistry
		);
		if (!resolved.ok) throw new Error('fixture setup failed');
		return makeRecord({
			parameters: resolved.parameters,
			catalogParameters: resolved.catalogParameters
		});
	}

	it('substitutes an override at the declared location, leaving everything else untouched', () => {
		const study = studyWithWindowParam();
		const result = resolveCustomStudyExpression(study, { window: 25 });
		if (!result.ok) throw new Error('expected ok');
		const left = resolveNodeAtPath(result.node, 'root.left');
		expect(left).toEqual({
			kind: 'function_call',
			functionId: 'study.sma',
			args: { length: 25 },
			outputName: 'sma'
		});
		expect(resolveNodeAtPath(result.node, 'root.right')).toEqual(CLOSE_REF);
	});

	it("keeps the author's own default when a parameter is not overridden", () => {
		const study = studyWithWindowParam();
		const result = resolveCustomStudyExpression(study, {});
		if (!result.ok) throw new Error('expected ok');
		expect(result.node).toEqual(EXPRESSION.node);
	});

	it('rejects an override outside the declared range (AC7-style bound at call time)', () => {
		const study = studyWithWindowParam();
		const result = resolveCustomStudyExpression(study, { window: 999 });
		expect(result.ok).toBe(false);
	});

	it('rejects an override of the wrong type', () => {
		const study = studyWithWindowParam();
		const result = resolveCustomStudyExpression(study, {
			window: 'twenty-five' as unknown as number
		});
		expect(result.ok).toBe(false);
	});

	it("mutation check: never mutates the stored record's own expression tree", () => {
		const study = studyWithWindowParam();
		const before = JSON.stringify(study.expression.node);
		resolveCustomStudyExpression(study, { window: 25 });
		expect(JSON.stringify(study.expression.node)).toBe(before);
	});
});
