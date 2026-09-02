// Turns a before-state and an after-state into the structured diff and the
// one-line summary the safety layer reports. Traversal is shape-driven rather
// than kind-driven: nothing here names `panels`, `layout` or `links`, so a
// sibling epic's entity kind appears in diffs without editing this file. See
// docs/design/safety-preview-apply/technical.md's "Diff shape".
import type { DiffEntry, FieldChange, WorkspaceDiff } from './preview';
import type { WorkspaceDocument } from './workspace';

// Bookkeeping the revision service stamps at commit time, not an effect of the
// batch. Including them would make every diff report a change and would break
// the preview-equals-apply equality the honesty guarantee is measured by.
const BOOKKEEPING_KEYS: ReadonlySet<string> = new Set(['revision', 'updatedAt']);

const EXTENSIONS_KEY = 'extensions';

const WORKSPACE_ENTITY_TYPE = 'workspace';

// Beyond this the sentence stops being readable at a glance and degrades to a
// count of what is left.
const MAX_SUMMARY_CLAUSES = 3;

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Empty arrays count: an emptied collection must still diff as a collection
// rather than as a whole-value field change.
function isEntityArray(value: unknown): value is Row[] {
	return Array.isArray(value) && value.every(isRecord);
}

// A stable `id` when there is one; otherwise the single `*Id` property, which
// is what lets layout entries (keyed by `panelId`) diff without being named.
// Two `*Id` properties are ambiguous, so identity is refused rather than
// guessed.
function identityOf(item: Row): string | null {
	if (typeof item.id === 'string') {
		return item.id;
	}
	const [only, ...rest] = Object.keys(item).filter(
		(key) => key.endsWith('Id') && typeof item[key] === 'string'
	);
	if (only === undefined || rest.length > 0) {
		return null;
	}
	return item[only] as string;
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (!isRecord(a) && !Array.isArray(a)) {
		// Reference inequality on two non-containers only ties on NaN.
		return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		return a.every((item, index) => deepEqual(item, b[index]));
	}
	if (!isRecord(b)) {
		return false;
	}
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) {
		return false;
	}
	return keys.every((key) => key in b && deepEqual(a[key], b[key]));
}

// Locale-independent, so ordering cannot shift with the runtime's collation.
function compareStrings(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	return a < b ? -1 : 1;
}

function sortedKeyUnion(...sources: readonly Row[]): string[] {
	const keys = new Set<string>();
	for (const source of sources) {
		for (const key of Object.keys(source)) {
			keys.add(key);
		}
	}
	// Sorted so nothing downstream inherits object-key iteration order.
	return [...keys].sort();
}

function changedFields(before: Row, after: Row): FieldChange[] {
	const fields: FieldChange[] = [];
	for (const field of sortedKeyUnion(before, after)) {
		if (!deepEqual(before[field], after[field])) {
			fields.push({ field, before: before[field], after: after[field] });
		}
	}
	return fields;
}

// First occurrence wins: a duplicated identity is a defect upstream, and
// picking deterministically keeps the diff comparable rather than hiding it.
function indexByIdentity(rows: readonly Row[]): Map<string, Row> {
	const byId = new Map<string, Row>();
	for (const row of rows) {
		const id = identityOf(row);
		if (id !== null && !byId.has(id)) {
			byId.set(id, row);
		}
	}
	return byId;
}

interface CollectionDiff {
	entries: DiffEntry[];
	// Elements with no derivable identity, reported on the workspace entry
	// rather than dropped.
	positional: FieldChange[];
}

function positionalChanges(
	key: string,
	before: readonly Row[],
	after: readonly Row[]
): FieldChange[] {
	const indices = new Set<number>();
	before.forEach((row, index) => {
		if (identityOf(row) === null) {
			indices.add(index);
		}
	});
	after.forEach((row, index) => {
		if (identityOf(row) === null) {
			indices.add(index);
		}
	});
	const fields: FieldChange[] = [];
	for (const index of [...indices].sort((a, b) => a - b)) {
		if (!deepEqual(before[index], after[index])) {
			fields.push({ field: `${key}[${index}]`, before: before[index], after: after[index] });
		}
	}
	return fields;
}

function diffCollection(
	entityType: string,
	before: readonly Row[],
	after: readonly Row[]
): CollectionDiff {
	const beforeById = indexByIdentity(before);
	const afterById = indexByIdentity(after);
	const entries: DiffEntry[] = [];
	const emitted = new Set<string>();
	for (const row of after) {
		const id = identityOf(row);
		if (id === null || emitted.has(id)) {
			continue;
		}
		emitted.add(id);
		const previous = beforeById.get(id);
		if (previous === undefined) {
			entries.push({ change: 'added', entityType, id, fields: [] });
		} else if (!deepEqual(previous, row)) {
			entries.push({ change: 'updated', entityType, id, fields: changedFields(previous, row) });
		}
	}
	for (const row of before) {
		const id = identityOf(row);
		if (id !== null && !afterById.has(id)) {
			entries.push({ change: 'removed', entityType, id, fields: [] });
		}
	}
	return { entries, positional: positionalChanges(entityType, before, after) };
}

interface Traversal {
	collections: Map<string, DiffEntry[]>;
	workspaceFields: FieldChange[];
}

function visit(prefix: string, before: Row, after: Row, into: Traversal): void {
	for (const key of sortedKeyUnion(before, after)) {
		const beforeValue = before[key];
		const afterValue = after[key];
		const name = `${prefix}${key}`;
		if (isEntityArray(beforeValue) || isEntityArray(afterValue)) {
			const collection = diffCollection(
				name,
				isEntityArray(beforeValue) ? beforeValue : [],
				isEntityArray(afterValue) ? afterValue : []
			);
			if (collection.entries.length > 0) {
				into.collections.set(name, collection.entries);
			}
			into.workspaceFields.push(...collection.positional);
			continue;
		}
		if (!deepEqual(beforeValue, afterValue)) {
			into.workspaceFields.push({ field: name, before: beforeValue, after: afterValue });
		}
	}
}

function scalarSource(doc: WorkspaceDocument): Row {
	const source: Row = {};
	for (const [key, value] of Object.entries(doc)) {
		if (!BOOKKEEPING_KEYS.has(key) && key !== EXTENSIONS_KEY) {
			source[key] = value;
		}
	}
	return source;
}

function extensionSource(doc: WorkspaceDocument): Row {
	return isRecord(doc.extensions) ? doc.extensions : {};
}

// Pure: reads both documents, mutates neither, and consults no clock, no I/O
// and no module state, so the same pair of states always yields the same diff.
export function diffWorkspaces(before: WorkspaceDocument, after: WorkspaceDocument): WorkspaceDiff {
	const traversal: Traversal = { collections: new Map(), workspaceFields: [] };
	visit('', scalarSource(before), scalarSource(after), traversal);
	visit(`${EXTENSIONS_KEY}.`, extensionSource(before), extensionSource(after), traversal);

	const diff: WorkspaceDiff = [];
	if (traversal.workspaceFields.length > 0) {
		diff.push({
			change: 'updated',
			entityType: WORKSPACE_ENTITY_TYPE,
			id: after.id,
			fields: [...traversal.workspaceFields].sort((a, b) => compareStrings(a.field, b.field))
		});
	}
	const collections = [...traversal.collections.entries()].sort((a, b) =>
		compareStrings(a[0], b[0])
	);
	for (const [, entries] of collections) {
		diff.push(...entries);
	}
	return diff;
}

interface SummaryClause {
	text: string;
	// How many diff entries the clause stands for, so the trailing count
	// describes changes rather than clauses.
	changeCount: number;
}

const CHANGE_VERBS: Record<string, string> = {
	added: 'Added',
	removed: 'Removed',
	updated: 'Updated'
};

// `entityType` is the collection key, which reads as a plural; a single change
// should not say "1 panels".
function singularize(entityType: string): string {
	if (entityType.endsWith('ies')) {
		return `${entityType.slice(0, -3)}y`;
	}
	return entityType.endsWith('s') ? entityType.slice(0, -1) : entityType;
}

function derivedClauses(diff: WorkspaceDiff): SummaryClause[] {
	const groups = new Map<string, { change: string; entityType: string; count: number }>();
	for (const entry of diff) {
		const key = `${entry.change}:${entry.entityType}`;
		const group = groups.get(key);
		if (group === undefined) {
			groups.set(key, { change: entry.change, entityType: entry.entityType, count: 1 });
		} else {
			group.count += 1;
		}
	}
	// Insertion order, which is the diff's own deterministic order.
	return [...groups.values()].map((group) => ({
		text:
			group.count === 1
				? `${CHANGE_VERBS[group.change]} ${singularize(group.entityType)}`
				: `${CHANGE_VERBS[group.change]} ${group.count} ${group.entityType}`,
		changeCount: group.count
	}));
}

function lowerFirst(text: string): string {
	if (text.length === 0) {
		return text;
	}
	// An acronym-led fragment must survive: "RSI 40-70 filter" is not "rSI ...".
	const second = text[1];
	if (second !== undefined && second !== second.toLowerCase() && second === second.toUpperCase()) {
		return text;
	}
	return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function upperFirst(text: string): string {
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function joinClauses(texts: readonly string[], remaining: number): string {
	const parts = texts.map((text, index) => (index === 0 ? upperFirst(text) : lowerFirst(text)));
	if (remaining > 0) {
		const noun = remaining === 1 ? 'change' : 'changes';
		return `${parts.join(', ')} and ${remaining} more ${noun}`;
	}
	const last = parts[parts.length - 1] ?? '';
	return parts.length < 2 ? last : `${parts.slice(0, -1).join(', ')} and ${last}`;
}

// Derived from the structured diff, so it can never describe a change the diff
// does not contain: operation-contributed fragments only supply phrasing, and
// only when there is something to describe.
export function summarizeDiff(diff: WorkspaceDiff, fragments?: readonly string[]): string {
	if (diff.length === 0) {
		return 'No changes.';
	}
	const supplied = (fragments ?? []).map((fragment) => fragment.trim()).filter((f) => f.length > 0);
	const clauses: SummaryClause[] =
		supplied.length > 0 ? supplied.map((text) => ({ text, changeCount: 1 })) : derivedClauses(diff);
	const head = clauses.slice(0, MAX_SUMMARY_CLAUSES);
	const remaining = clauses
		.slice(MAX_SUMMARY_CLAUSES)
		.reduce((total, clause) => total + clause.changeCount, 0);
	return joinClauses(
		head.map((clause) => clause.text),
		remaining
	);
}
