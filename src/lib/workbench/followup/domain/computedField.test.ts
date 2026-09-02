import { describe, expect, it } from 'vitest';
import { emptyWorkspace } from '../../domain/workspace';
import {
	findComputedFieldByName,
	normalizeComputedField,
	readComputedField,
	readComputedFields,
	toFieldItem,
	toWireComputedField,
	writeComputedField,
	type ComputedFieldRecord
} from './computedField';
import type { ValidatedExpression } from './expressionModel';

const NOW = '2026-09-02T00:00:00.000Z';

function makeExpression(overrides: Partial<ValidatedExpression> = {}): ValidatedExpression {
	return {
		node: { kind: 'field_ref', fieldId: 'field.price.close' },
		resultType: 'number',
		resultUnit: 'currency',
		usage: 'numeric_column',
		...overrides
	};
}

function makeRecord(overrides: Partial<ComputedFieldRecord> = {}): ComputedFieldRecord {
	return {
		id: 'field.custom.1',
		workspaceId: 'workspace_1',
		name: 'My Field',
		expression: makeExpression(),
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	};
}

describe('writeComputedField / readComputedField', () => {
	it('round-trips a field through the extension key, never mutating the input document', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', NOW);
		const record = makeRecord();
		const next = writeComputedField(doc, record);
		expect(readComputedField(next, record.id)).toEqual(record);
		expect(readComputedField(doc, record.id), 'the original document must be untouched').toBeNull();
	});

	it('readComputedField returns null for an unknown id', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', NOW);
		expect(readComputedField(doc, 'field.custom.99')).toBeNull();
	});
});

describe('readComputedFields', () => {
	it('lists every stored field, dropping entries that fail to normalize', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', NOW);
		const withTwo = writeComputedField(
			writeComputedField(doc, makeRecord({ id: 'field.custom.1' })),
			makeRecord({ id: 'field.custom.2', name: 'Second' })
		);
		const withGarbage = {
			...withTwo,
			extensions: {
				...withTwo.extensions,
				'followup.computed_fields': {
					...(withTwo.extensions['followup.computed_fields'] as Record<string, unknown>),
					'field.custom.3': { garbage: true }
				}
			}
		};
		expect(
			readComputedFields(withGarbage)
				.map((f) => f.id)
				.sort()
		).toEqual(['field.custom.1', 'field.custom.2']);
	});
});

describe('findComputedFieldByName', () => {
	it('matches case-insensitively', () => {
		const doc = writeComputedField(
			emptyWorkspace('workspace_1', 'Test', NOW),
			makeRecord({ name: 'RSI Divergence' })
		);
		expect(findComputedFieldByName(doc, 'rsi divergence')?.id).toBe('field.custom.1');
	});

	it('returns null when no field has that name', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', NOW);
		expect(findComputedFieldByName(doc, 'nope')).toBeNull();
	});
});

describe('normalizeComputedField', () => {
	it('rejects a value with no id or an unshaped expression', () => {
		expect(normalizeComputedField({ name: 'x' })).toBeNull();
		expect(
			normalizeComputedField({ id: 'field.custom.1', expression: 'sma(close, 20)' })
		).toBeNull();
	});
});

describe('toWireComputedField', () => {
	it('reports the result type and unit (AC1)', () => {
		const wire = toWireComputedField(makeRecord());
		expect(wire.result_type).toBe('number');
		expect(wire.result_unit).toBe('currency');
		expect(wire.computed_field_id).toBe('field.custom.1');
	});

	it('reports null (not undefined/omitted) for an absent unit', () => {
		const wire = toWireComputedField(
			makeRecord({ expression: makeExpression({ resultUnit: undefined }) })
		);
		expect(wire.result_unit).toBeNull();
	});
});

describe('toFieldItem (AC2)', () => {
	it('projects into a FieldItem resolvable by a CatalogRegistry.getCatalogItem-shaped lookup', () => {
		const item = toFieldItem(makeRecord());
		expect(item.kind).toBe('field');
		expect(item.id).toBe('field.custom.1');
		expect(item.valueType).toBe('number');
		expect(item.unit).toBe('currency');
		// Always nullable: a computed field can always come back "not
		// available" (AC8), regardless of its declared result type.
		expect(item.nullable).toBe(true);
		expect(item.availability.status).toBe('available');
	});
});
