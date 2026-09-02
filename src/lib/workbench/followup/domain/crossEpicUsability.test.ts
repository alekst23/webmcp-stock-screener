// AC2 / AC4: "usable as a results-table column, a ranking input, and an
// operand in a filter condition" / "usable in a study-output filter
// condition". These claims are proven here directly against the sibling
// epics' own, unmodified exported validators (EPIC-1009's
// screener/conditionValidation.ts#validateCondition, EPIC-1010's
// results/domain/tableConfig.ts#validateResultsTableConfig) fed the
// workspace-composed registry -- no source edit to either module, and no
// second, parallel notion of "is this field/study usable" invented here.
//
// Ranking (screener/ranking.ts) deliberately does not check catalog
// existence itself (that check lives at its tool layer, gated off today
// like every other tool group) -- the assertion below instead uses the
// exact predicate that tool layer would need (a resolvable, numeric
// FieldItem), mirroring tableConfig.ts's own permittedFieldIds filter.
import { describe, expect, it } from 'vitest';
import { validateCondition } from '../../../screener/conditionValidation';
import type { ScalarCondition, StudyOutputCondition } from '../../../screener/conditions';
import { validateResultsTableConfig } from '../../../results/domain/tableConfig';
import type { DisplayColumn, ResultsTableConfig } from '../../../results/domain/tableConfig';
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

function registryWithBoth() {
	const doc = writeCustomStudy(
		writeComputedField(emptyWorkspace('workspace_1', 'Test', NOW), COMPUTED_FIELD),
		CUSTOM_STUDY
	);
	return composeWorkspaceCatalogRegistry(doc);
}

describe('AC2: a computed field validates as a filter condition operand exactly like a built-in field', () => {
	it('validateCondition (EPIC-1009, unmodified) accepts a scalar condition addressed by the computed field id', () => {
		const registry = registryWithBoth();
		const condition: ScalarCondition = {
			type: 'scalar',
			fieldId: 'field.custom.1',
			operator: 'op.greater_than',
			value: 100,
			unit: null
		};
		expect(validateCondition(condition, { registry })).toEqual([]);
	});

	it('the same condition is rejected against the base registry alone -- proving the composed registry is what made it valid', () => {
		const condition: ScalarCondition = {
			type: 'scalar',
			fieldId: 'field.custom.1',
			operator: 'op.greater_than',
			value: 100,
			unit: null
		};
		const problems = validateCondition(condition); // defaults to builtinCatalogRegistry
		expect(problems.length).toBeGreaterThan(0);
	});
});

describe('AC4: a custom study validates as a study-output filter condition source exactly like a built-in study', () => {
	it('validateCondition (EPIC-1009, unmodified) accepts a study_output condition addressed by the custom study id', () => {
		const registry = registryWithBoth();
		const condition: StudyOutputCondition = {
			type: 'study_output',
			studyId: 'study.custom.1',
			params: {},
			outputName: 'value',
			predicate: 'rising'
		};
		expect(validateCondition(condition, { registry })).toEqual([]);
	});
});

describe('AC2: a computed field validates as a results-table column exactly like a built-in field', () => {
	it('validateResultsTableConfig (EPIC-1010, unmodified) accepts a display column addressed by the computed field id', () => {
		const registry = registryWithBoth();
		const column: DisplayColumn = {
			id: 'column_1',
			identity: { source: 'catalog_field', fieldId: 'field.custom.1' },
			label: 'Above 50 SMA',
			unit: 'currency',
			valueType: 'number'
		};
		const config: ResultsTableConfig = {
			columns: [column],
			computedColumns: [],
			sort: null,
			grouping: null,
			formattingRules: [],
			pageSize: null,
			chartPanelId: null
		};
		const result = validateResultsTableConfig(config, registry);
		expect(
			result.ok,
			result.ok ? '' : JSON.stringify((result as { rejections: unknown[] }).rejections)
		).toBe(true);
	});
});

describe('AC2: a computed field is usable as a ranking input the same way a built-in field is', () => {
	it('resolves as a numeric field through the composed registry -- the exact predicate a ranking-field-existence check uses', () => {
		const registry = registryWithBoth();
		const item = registry.getCatalogItem('field.custom.1');
		expect(item?.kind).toBe('field');
		expect(item && item.kind === 'field' ? item.valueType : null).toBe('number');
	});
});
