import { describe, expect, it } from 'vitest';
import { builtinCatalogRegistry } from '../../../catalog/registry';
import { emptyWorkspace } from '../../domain/workspace';
import { writeComputedField, type ComputedFieldRecord } from './computedField';
import { writeCustomStudy, type CustomStudyRecord } from './customStudy';
import { composeWorkspaceCatalogRegistry } from './workspaceCatalog';

const NOW = '2026-09-02T00:00:00.000Z';

const COMPUTED_FIELD: ComputedFieldRecord = {
	id: 'field.custom.1',
	workspaceId: 'workspace_1',
	name: 'Above 50 SMA',
	expression: {
		node: { kind: 'field_ref', fieldId: 'field.price.close' },
		resultType: 'number',
		resultUnit: 'currency',
		usage: 'numeric_column'
	},
	createdAt: NOW,
	updatedAt: NOW
};

const CUSTOM_STUDY: CustomStudyRecord = {
	id: 'study.custom.1',
	workspaceId: 'workspace_1',
	name: 'Custom SMA',
	expression: {
		node: {
			kind: 'function_call',
			functionId: 'study.sma',
			args: { length: 10 },
			outputName: 'sma'
		},
		resultType: 'number',
		resultUnit: 'currency',
		usage: 'numeric_column'
	},
	parameters: [],
	catalogParameters: [],
	createdAt: NOW,
	updatedAt: NOW
};

function docWithBoth() {
	const doc = emptyWorkspace('workspace_1', 'Test', NOW);
	return writeCustomStudy(writeComputedField(doc, COMPUTED_FIELD), CUSTOM_STUDY);
}

describe('composeWorkspaceCatalogRegistry: getCatalogItem / resolveStudy (AC2, AC4)', () => {
	it('resolves a workspace computed field by id, exactly like a built-in field', () => {
		const registry = composeWorkspaceCatalogRegistry(docWithBoth());
		const item = registry.getCatalogItem('field.custom.1');
		expect(item?.kind).toBe('field');
		expect(item?.id).toBe('field.custom.1');
	});

	it('resolves a workspace custom study via resolveStudy, exactly like a built-in study', () => {
		const registry = composeWorkspaceCatalogRegistry(docWithBoth());
		const study = registry.resolveStudy('study.custom.1');
		expect(study?.id).toBe('study.custom.1');
		expect(study?.kind).toBe('study');
	});

	it('still resolves every built-in item unchanged', () => {
		const registry = composeWorkspaceCatalogRegistry(docWithBoth());
		expect(registry.getCatalogItem('field.price.close')?.id).toBe('field.price.close');
		expect(registry.resolveStudy('study.sma')?.id).toBe('study.sma');
	});

	it('returns undefined for an id that exists in neither the workspace nor the base catalog', () => {
		const registry = composeWorkspaceCatalogRegistry(docWithBoth());
		expect(registry.getCatalogItem('field.custom.999')).toBeUndefined();
	});

	it('an empty workspace composes to exactly the base catalog', () => {
		const doc = emptyWorkspace('workspace_1', 'Test', NOW);
		const registry = composeWorkspaceCatalogRegistry(doc);
		expect(registry.listCatalogItems().length).toBe(
			builtinCatalogRegistry.listCatalogItems().length
		);
	});
});

describe('composeWorkspaceCatalogRegistry: listCatalogItems / searchCatalogItems', () => {
	it('includes workspace items in an unfiltered listing, alongside every built-in item', () => {
		const registry = composeWorkspaceCatalogRegistry(docWithBoth());
		const ids = registry.listCatalogItems().map((i) => i.id);
		expect(ids).toContain('field.custom.1');
		expect(ids).toContain('study.custom.1');
		expect(ids.length).toBe(builtinCatalogRegistry.listCatalogItems().length + 2);
	});

	it('filters workspace items by kind exactly like built-in ones', () => {
		const registry = composeWorkspaceCatalogRegistry(docWithBoth());
		const fields = registry.listCatalogItems('field').map((i) => i.id);
		expect(fields).toContain('field.custom.1');
		expect(registry.listCatalogItems('study').map((i) => i.id)).toContain('study.custom.1');
	});

	it('finds a workspace field by an id-substring search', () => {
		const registry = composeWorkspaceCatalogRegistry(docWithBoth());
		const matches = registry.searchCatalogItems({ text: 'custom.1' });
		expect(matches.some((m) => m.item.id === 'field.custom.1')).toBe(true);
	});
});

describe('composeWorkspaceCatalogRegistry: isOperatorValidForField', () => {
	it('accepts a workspace field with a compatible operator, exactly like a built-in field', () => {
		const registry = composeWorkspaceCatalogRegistry(docWithBoth());
		expect(registry.isOperatorValidForField('op.greater_than', 'field.custom.1')).toEqual({
			valid: true
		});
	});

	it('still rejects a genuinely unknown field id', () => {
		const registry = composeWorkspaceCatalogRegistry(docWithBoth());
		const result = registry.isOperatorValidForField('op.greater_than', 'field.nope');
		expect(result.valid).toBe(false);
	});
});

describe('composeWorkspaceCatalogRegistry: suggestCatalogIds', () => {
	it('suggests a workspace item id when it is the closer match', () => {
		const registry = composeWorkspaceCatalogRegistry(docWithBoth());
		expect(registry.suggestCatalogIds('field.custom.1')).toContain('field.custom.1');
	});
});
