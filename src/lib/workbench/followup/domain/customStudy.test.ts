import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../../catalog/registry';
import { emptyWorkspace } from '../../domain/workspace';
import {
	findCustomStudyByName,
	normalizeCustomStudy,
	readCustomStudies,
	readCustomStudy,
	toStudyItem,
	toWireCustomStudy,
	writeCustomStudy,
	type CustomStudyRecord
} from './customStudy';
import { resolveParameterDeclarations } from './customStudyParameters';
import type { ExpressionNode, ValidatedExpression } from './expressionModel';

const NOW = '2026-09-02T00:00:00.000Z';

// sma(field.close, length=10) - field.close, mirroring
// customStudyParameters.test.ts's fixture so a parameter declared against it
// resolves the same way here.
const SMA_CALL: ExpressionNode = {
	kind: 'function_call',
	functionId: 'study.sma',
	args: { length: 10 },
	outputName: 'sma'
};

const EXPRESSION: ValidatedExpression = {
	node: {
		kind: 'arithmetic',
		op: '-',
		left: SMA_CALL,
		right: { kind: 'field_ref', fieldId: 'field.price.close' }
	},
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

describe('writeCustomStudy / readCustomStudy', () => {
	it('round-trips a study through the extension key, never mutating the input document', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', NOW);
		const record = makeRecord();
		const next = writeCustomStudy(doc, record);
		expect(readCustomStudy(next, record.id)).toEqual(record);
		expect(readCustomStudy(doc, record.id)).toBeNull();
	});
});

describe('readCustomStudies / findCustomStudyByName', () => {
	it('lists every stored study and finds by case-insensitive name', () => {
		const doc = writeCustomStudy(emptyWorkspace('workspace_1', 'Test', NOW), makeRecord());
		expect(readCustomStudies(doc)).toHaveLength(1);
		expect(findCustomStudyByName(doc, 'sma distance')?.id).toBe('study.custom.1');
		expect(findCustomStudyByName(doc, 'nope')).toBeNull();
	});
});

describe('normalizeCustomStudy', () => {
	it('rejects a value with no id or an unshaped expression', () => {
		expect(normalizeCustomStudy({ name: 'x' })).toBeNull();
		expect(normalizeCustomStudy({ id: 'study.custom.1', expression: 'sma(close, 20)' })).toBeNull();
	});
});

describe('toWireCustomStudy / toStudyItem (AC3, AC4)', () => {
	it('describes parameters, ranges, defaults, outputs and units the same way a built-in study does', () => {
		const resolved = resolveParameterDeclarations(
			[{ name: 'window', nodePath: 'root.left', argName: 'length', range: { min: 5, max: 50 } }],
			EXPRESSION,
			builtinCatalogRegistry
		);
		if (!resolved.ok) throw new Error('fixture setup failed');
		const study = makeRecord({
			parameters: resolved.parameters,
			catalogParameters: resolved.catalogParameters
		});

		const item = toStudyItem(study);
		expect(item.kind).toBe('study');
		expect(item.id).toBe('study.custom.1');
		expect(item.parameters).toEqual(resolved.catalogParameters);
		expect(item.outputs).toEqual([{ name: 'value', valueType: 'number', unit: undefined }]);

		const wire = toWireCustomStudy(study);
		expect(wire.custom_study_id).toBe('study.custom.1');
		expect(wire.parameters).toEqual(resolved.catalogParameters);
	});
});
