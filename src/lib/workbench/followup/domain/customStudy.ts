// The custom study record (T-1014-2, AC3, AC4): what `create_custom_study`
// writes, what appears in the catalog describing itself "the same way a
// built-in study does", and what a study-output condition or a
// chart-added study resolves against. The declared-parameter machinery
// (node-path resolution, resolving a declaration into a CatalogParameter,
// call-time override substitution) lives in customStudyParameters.ts --
// split out to keep each file within the project's size guidance.
//
// Domain layer: pure construction, normalization, serialization and
// catalog projection. No I/O.
import type {
	CatalogOutput,
	CatalogParameter,
	NumericRange,
	StudyItem
} from '../../../catalog/types';
import type { ResourceId } from '../../domain/ids';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { CustomStudyParameter } from './customStudyParameters';
import type { ValidatedExpression } from './expressionModel';

export const CUSTOM_STUDY_EXTENSION_KEY = 'followup.custom_studies';

export type { CustomStudyParameter } from './customStudyParameters';

export interface CustomStudyRecord {
	id: string;
	workspaceId: ResourceId;
	name: string;
	expression: ValidatedExpression;
	parameters: readonly CustomStudyParameter[];
	// The CatalogParameter[] resolved from `parameters` at creation time
	// (resolveParameterDeclarations), persisted rather than re-derived on
	// every read -- re-deriving would need a CatalogRegistry at read time
	// (workspaceCatalog.ts's whole job is building one, so it cannot itself
	// depend on having one already) and would silently drift from what was
	// actually validated if the underlying catalog function's own
	// declaration ever changed.
	catalogParameters: readonly CatalogParameter[];
	createdAt: string;
	updatedAt: string;
}

// ---------------------------------------------------------------------------
// Storage: read/write/normalize/toWire (mirrors computedField.ts)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidatedExpressionShaped(value: unknown): value is ValidatedExpression {
	return (
		isRecord(value) &&
		isRecord(value.node) &&
		typeof value.node.kind === 'string' &&
		typeof value.resultType === 'string' &&
		typeof value.usage === 'string'
	);
}

function normalizeParameter(value: unknown): CustomStudyParameter | null {
	if (
		!isRecord(value) ||
		typeof value.name !== 'string' ||
		typeof value.nodePath !== 'string' ||
		typeof value.argName !== 'string'
	) {
		return null;
	}
	const range = isRecord(value.range) ? (value.range as NumericRange) : undefined;
	return { name: value.name, nodePath: value.nodePath, argName: value.argName, range };
}

function normalizeParameterArray(value: unknown): CustomStudyParameter[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: CustomStudyParameter[] = [];
	for (const item of value) {
		const parameter = normalizeParameter(item);
		if (parameter) {
			out.push(parameter);
		}
	}
	return out;
}

function normalizeCatalogParameter(value: unknown): CatalogParameter | null {
	if (!isRecord(value) || typeof value.name !== 'string' || typeof value.valueType !== 'string') {
		return null;
	}
	return {
		name: value.name,
		valueType: value.valueType as CatalogParameter['valueType'],
		unit: typeof value.unit === 'string' ? value.unit : undefined,
		defaultValue:
			typeof value.defaultValue === 'number' ||
			typeof value.defaultValue === 'string' ||
			typeof value.defaultValue === 'boolean'
				? value.defaultValue
				: null,
		range: isRecord(value.range) ? (value.range as NumericRange) : undefined,
		enumValues: Array.isArray(value.enumValues) ? (value.enumValues as string[]) : undefined,
		required: value.required === true
	};
}

function normalizeCatalogParameterArray(value: unknown): CatalogParameter[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: CatalogParameter[] = [];
	for (const item of value) {
		const parameter = normalizeCatalogParameter(item);
		if (parameter) {
			out.push(parameter);
		}
	}
	return out;
}

export function normalizeCustomStudy(value: unknown): CustomStudyRecord | null {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		value.id.length === 0 ||
		!isValidatedExpressionShaped(value.expression)
	) {
		return null;
	}
	return {
		id: value.id,
		workspaceId: typeof value.workspaceId === 'string' ? value.workspaceId : '',
		name: typeof value.name === 'string' ? value.name : '',
		expression: value.expression,
		parameters: normalizeParameterArray(value.parameters),
		catalogParameters: normalizeCatalogParameterArray(value.catalogParameters),
		createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : ''
	};
}

function customStudyMap(doc: WorkspaceDocument): Record<string, unknown> {
	const raw = doc.extensions[CUSTOM_STUDY_EXTENSION_KEY];
	return isRecord(raw) ? raw : {};
}

export function readCustomStudy(doc: WorkspaceDocument, id: string): CustomStudyRecord | null {
	const raw = customStudyMap(doc)[id];
	if (raw === undefined) {
		return null;
	}
	const normalized = normalizeCustomStudy(raw);
	return normalized && normalized.id === id ? normalized : null;
}

export function readCustomStudies(doc: WorkspaceDocument): CustomStudyRecord[] {
	const out: CustomStudyRecord[] = [];
	for (const entry of Object.values(customStudyMap(doc))) {
		const study = normalizeCustomStudy(entry);
		if (study) {
			out.push(study);
		}
	}
	return out;
}

export function writeCustomStudy(
	doc: WorkspaceDocument,
	study: CustomStudyRecord
): WorkspaceDocument {
	const map = { ...customStudyMap(doc), [study.id]: study };
	return { ...doc, extensions: { ...doc.extensions, [CUSTOM_STUDY_EXTENSION_KEY]: map } };
}

export function findCustomStudyByName(
	doc: WorkspaceDocument,
	name: string
): CustomStudyRecord | null {
	const needle = name.trim().toLowerCase();
	return readCustomStudies(doc).find((study) => study.name.trim().toLowerCase() === needle) ?? null;
}

export function toWireCustomStudy(study: CustomStudyRecord): Record<string, unknown> {
	return {
		custom_study_id: study.id,
		name: study.name,
		result_type: study.expression.resultType,
		result_unit: study.expression.resultUnit ?? null,
		parameters: study.catalogParameters,
		created_at: study.createdAt,
		updated_at: study.updatedAt
	};
}

// Projects a custom study into a plain StudyItem (AC4) -- resolvable by
// CatalogRegistry.resolveStudy/getCatalogItem exactly like a built-in
// study, describing its parameters/ranges/defaults/outputs/units the same
// way. A single output named 'value': no AC asks for more than one, and
// T-1014-1's expression model only ever produces one result per tree.
export function toStudyItem(study: CustomStudyRecord): StudyItem {
	const output: CatalogOutput = {
		name: 'value',
		valueType: study.expression.resultType,
		unit: study.expression.resultUnit
	};
	return {
		id: study.id,
		kind: 'study',
		label: study.name,
		description: `Custom study "${study.name}", authored via create_custom_study.`,
		aliases: [],
		tags: ['custom'],
		parameters: study.catalogParameters,
		outputs: [output],
		defaultIntervalId: 'interval.1d',
		availability: {
			status: 'available',
			requiresReferenceData: false,
			intervalIds: ['interval.1d']
		}
	};
}
