// The computed field record (T-1014-2, AC1, AC2): what `create_computed_field`
// writes and everything else -- the composed catalog registry, the results
// table, ranking, filter conditions -- reads. Mirrors
// alerts/domain/alert.ts's extension-key storage convention.
//
// Domain layer: pure construction, normalization, serialization and catalog
// projection. No I/O.
import type { FieldItem } from '../../../catalog/types';
import type { ResourceId } from '../../domain/ids';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { ValidatedExpression } from './expressionModel';

export const COMPUTED_FIELD_EXTENSION_KEY = 'followup.computed_fields';

export interface ComputedFieldRecord {
	id: string;
	workspaceId: ResourceId;
	name: string;
	expression: ValidatedExpression;
	createdAt: string;
	updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A structural shape check, not a re-validation -- the expression was
// already proven safe by validateExpression at creation time; a read only
// needs to reject something too malformed to be what this module wrote.
function isValidatedExpressionShaped(value: unknown): value is ValidatedExpression {
	return (
		isRecord(value) &&
		isRecord(value.node) &&
		typeof value.node.kind === 'string' &&
		typeof value.resultType === 'string' &&
		typeof value.usage === 'string'
	);
}

export function normalizeComputedField(value: unknown): ComputedFieldRecord | null {
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
		createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : ''
	};
}

function computedFieldMap(doc: WorkspaceDocument): Record<string, unknown> {
	const raw = doc.extensions[COMPUTED_FIELD_EXTENSION_KEY];
	return isRecord(raw) ? raw : {};
}

export function readComputedField(doc: WorkspaceDocument, id: string): ComputedFieldRecord | null {
	const raw = computedFieldMap(doc)[id];
	if (raw === undefined) {
		return null;
	}
	const normalized = normalizeComputedField(raw);
	return normalized && normalized.id === id ? normalized : null;
}

export function readComputedFields(doc: WorkspaceDocument): ComputedFieldRecord[] {
	const out: ComputedFieldRecord[] = [];
	for (const entry of Object.values(computedFieldMap(doc))) {
		const field = normalizeComputedField(entry);
		if (field) {
			out.push(field);
		}
	}
	return out;
}

// Pure: never mutates `doc`.
export function writeComputedField(
	doc: WorkspaceDocument,
	field: ComputedFieldRecord
): WorkspaceDocument {
	const map = { ...computedFieldMap(doc), [field.id]: field };
	return { ...doc, extensions: { ...doc.extensions, [COMPUTED_FIELD_EXTENSION_KEY]: map } };
}

export function findComputedFieldByName(
	doc: WorkspaceDocument,
	name: string
): ComputedFieldRecord | null {
	const needle = name.trim().toLowerCase();
	return (
		readComputedFields(doc).find((field) => field.name.trim().toLowerCase() === needle) ?? null
	);
}

export function toWireComputedField(field: ComputedFieldRecord): Record<string, unknown> {
	return {
		computed_field_id: field.id,
		name: field.name,
		result_type: field.expression.resultType,
		result_unit: field.expression.resultUnit ?? null,
		usage: field.expression.usage,
		created_at: field.createdAt,
		updated_at: field.updatedAt
	};
}

// Projects a computed field into the shape every catalog consumer already
// understands (AC2): a plain FieldItem, resolvable by
// CatalogRegistry.getCatalogItem exactly like a built-in field. `nullable`
// is always true -- a computed field's value can always come back "not
// available" (AC8), so a consumer that only checks built-in fields'
// declared nullability must not assume this one never is.
export function toFieldItem(field: ComputedFieldRecord): FieldItem {
	return {
		id: field.id,
		kind: 'field',
		label: field.name,
		description: `Computed field "${field.name}", authored via create_computed_field.`,
		aliases: [],
		tags: ['computed'],
		valueType: field.expression.resultType,
		unit: field.expression.resultUnit,
		nullable: true,
		availability: {
			status: 'available',
			requiresReferenceData: false,
			intervalIds: ['interval.1d']
		}
	};
}
