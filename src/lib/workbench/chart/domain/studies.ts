// Study instances on a chart, and the pure transitions that change them.
//
// A study instance is addressed by a stable `study_N` ID minted from the
// workspace ID sequencer. Every transition here preserves the IDs of the
// studies it does not remove -- an agent that reorders or toggles a study must
// be able to keep talking about it by the same name afterwards.
//
// Resolving `catalogItemId` to its parameters, defaults and valid ranges is the
// catalog's job, deliberately not done here: this module stays pure and
// dependency-free so it can be reasoned about without a registry.
import type { ResourceId } from '../../domain/ids';

export type StudyPane = 'price_overlay' | 'sub_pane';

const STUDY_PANES: Record<StudyPane, true> = {
	price_overlay: true,
	sub_pane: true
};

export type StudyParamValue = number | string | boolean;

export interface StudyInstance {
	id: ResourceId;
	catalogItemId: string;
	// Fully resolved, defaults included -- never partial, so a reader never has
	// to consult the catalog to know what was actually computed.
	params: Record<string, StudyParamValue>;
	pane: StudyPane;
	// Display order within its own pane. Contiguous from 0 after every
	// transition, so "third from the top" is always answerable.
	order: number;
	enabled: boolean;
}

export type StudyTransition =
	{ ok: true; studies: StudyInstance[]; changes: string[] } | { ok: false; issues: string[] };

export function isStudyPane(value: unknown): value is StudyPane {
	return typeof value === 'string' && value in STUDY_PANES;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStudyParamValue(value: unknown): value is StudyParamValue {
	if (typeof value === 'number') {
		return Number.isFinite(value);
	}
	return typeof value === 'string' || typeof value === 'boolean';
}

export function copyStudy(study: StudyInstance): StudyInstance {
	return {
		id: study.id,
		catalogItemId: study.catalogItemId,
		params: { ...study.params },
		pane: study.pane,
		order: study.order,
		enabled: study.enabled
	};
}

export function copyStudies(studies: readonly StudyInstance[]): StudyInstance[] {
	return studies.map(copyStudy);
}

function failed(...issues: string[]): StudyTransition {
	return { ok: false, issues };
}

function paneOf(studies: readonly StudyInstance[], pane: StudyPane): StudyInstance[] {
	return studies.filter((s) => s.pane === pane);
}

// Renumbers `order` to 0..n-1 within each pane, preserving the relative order
// the caller established. Keeps gaps from ever appearing after a removal.
function renumber(studies: readonly StudyInstance[]): StudyInstance[] {
	const nextOrder = new Map<StudyPane, number>();
	return studies.map((study) => {
		const order = nextOrder.get(study.pane) ?? 0;
		nextOrder.set(study.pane, order + 1);
		return { ...copyStudy(study), order };
	});
}

export function validateStudyInstance(value: unknown, field: string): string[] {
	if (!isRecord(value)) {
		return [`${field}: expected a study instance object.`];
	}
	const issues: string[] = [];
	if (typeof value.id !== 'string' || value.id.length === 0) {
		issues.push(`${field}.id: expected a stable study ID.`);
	}
	if (typeof value.catalogItemId !== 'string' || value.catalogItemId.length === 0) {
		issues.push(`${field}.catalogItemId: expected a catalog item ID.`);
	}
	if (!isStudyPane(value.pane)) {
		issues.push(`${field}.pane: "${String(value.pane)}" is not price_overlay or sub_pane.`);
	}
	if (typeof value.enabled !== 'boolean') {
		issues.push(`${field}.enabled: expected a boolean.`);
	}
	issues.push(...validateStudyParams(value.params, `${field}.params`));
	return issues;
}

export function validateStudyParams(value: unknown, field: string): string[] {
	if (!isRecord(value)) {
		return [`${field}: expected an object of parameter values.`];
	}
	const issues: string[] = [];
	for (const [name, param] of Object.entries(value)) {
		if (!isStudyParamValue(param)) {
			issues.push(
				`${field}.${name}: expected a finite number, string or boolean, got ${String(param)}.`
			);
		}
	}
	return issues;
}

function validateOrder(order: unknown, paneSize: number, field: string): string[] {
	if (typeof order !== 'number' || !Number.isInteger(order)) {
		return [`${field}: expected an integer display order.`];
	}
	if (order < 0 || order > paneSize) {
		return [`${field}: ${order} is out of bounds; expected 0 to ${paneSize} for this pane.`];
	}
	return [];
}

// `order` may be omitted on the instance to append; when given it is an
// insertion position within the target pane, so 0 puts the study on top.
export function addStudy(
	studies: readonly StudyInstance[],
	instance: StudyInstance
): StudyTransition {
	const issues = validateStudyInstance(instance, 'study');
	if (issues.length > 0) {
		return failed(...issues);
	}
	if (studies.some((s) => s.id === instance.id)) {
		return failed(`study.id: "${instance.id}" is already a study on this chart.`);
	}
	const target = paneOf(studies, instance.pane);
	const orderIssues = validateOrder(instance.order, target.length, 'study.order');
	if (orderIssues.length > 0) {
		return failed(...orderIssues);
	}
	const others = studies.filter((s) => s.pane !== instance.pane);
	const inserted = [...target];
	inserted.splice(instance.order, 0, copyStudy(instance));
	return {
		ok: true,
		studies: renumber([...others, ...inserted]),
		changes: [`added ${instance.catalogItemId} as ${instance.id} on ${instance.pane}`]
	};
}

export function updateStudyParams(
	studies: readonly StudyInstance[],
	studyId: ResourceId,
	params: Record<string, StudyParamValue>
): StudyTransition {
	const existing = studies.find((s) => s.id === studyId);
	if (!existing) {
		return failed(`study_id: "${studyId}" is not a study on this chart.`);
	}
	const issues = validateStudyParams(params, 'params');
	if (issues.length > 0) {
		return failed(...issues);
	}
	const merged = { ...existing.params, ...params };
	const changed = Object.keys(params).filter((k) => existing.params[k] !== params[k]);
	return {
		ok: true,
		studies: studies.map((s) =>
			s.id === studyId ? { ...copyStudy(s), params: merged } : copyStudy(s)
		),
		changes: changed.map(
			(k) => `${studyId}.${k}: ${String(existing.params[k])} -> ${String(params[k])}`
		)
	};
}

export function setStudyEnabled(
	studies: readonly StudyInstance[],
	studyId: ResourceId,
	enabled: boolean
): StudyTransition {
	const existing = studies.find((s) => s.id === studyId);
	if (!existing) {
		return failed(`study_id: "${studyId}" is not a study on this chart.`);
	}
	return {
		ok: true,
		studies: studies.map((s) => (s.id === studyId ? { ...copyStudy(s), enabled } : copyStudy(s))),
		changes: existing.enabled === enabled ? [] : [`${studyId}.enabled: ${enabled}`]
	};
}

export function toggleStudy(
	studies: readonly StudyInstance[],
	studyId: ResourceId
): StudyTransition {
	const existing = studies.find((s) => s.id === studyId);
	if (!existing) {
		return failed(`study_id: "${studyId}" is not a study on this chart.`);
	}
	return setStudyEnabled(studies, studyId, !existing.enabled);
}

// Takes the complete new ordering rather than a move instruction: a partial
// list would leave the position of the studies it omits ambiguous.
export function reorderStudies(
	studies: readonly StudyInstance[],
	orderedIds: readonly ResourceId[]
): StudyTransition {
	const known = new Set(studies.map((s) => s.id));
	const seen = new Set<ResourceId>();
	const issues: string[] = [];
	for (const id of orderedIds) {
		if (!known.has(id)) {
			issues.push(`ordered_ids: "${id}" is not a study on this chart.`);
		}
		if (seen.has(id)) {
			issues.push(`ordered_ids: "${id}" appears more than once.`);
		}
		seen.add(id);
	}
	for (const id of known) {
		if (!seen.has(id)) {
			issues.push(`ordered_ids: "${id}" is missing; supply the complete ordering.`);
		}
	}
	if (issues.length > 0) {
		return failed(...issues);
	}
	const byId = new Map(studies.map((s) => [s.id, s]));
	const ordered = orderedIds.map((id) => byId.get(id) as StudyInstance);
	return {
		ok: true,
		studies: renumber(ordered),
		changes: [`reordered ${orderedIds.length} studies`]
	};
}

export function removeStudy(
	studies: readonly StudyInstance[],
	studyId: ResourceId
): StudyTransition {
	if (!studies.some((s) => s.id === studyId)) {
		return failed(`study_id: "${studyId}" is not a study on this chart.`);
	}
	return {
		ok: true,
		studies: renumber(studies.filter((s) => s.id !== studyId)),
		changes: [`removed ${studyId}`]
	};
}

// Price-overlay studies draw on the main pane and are listed first, then each
// pane's studies in their own display order.
export function sortStudiesForDisplay(studies: readonly StudyInstance[]): StudyInstance[] {
	const rank: Record<StudyPane, number> = { price_overlay: 0, sub_pane: 1 };
	return copyStudies(studies).sort((a, b) => rank[a.pane] - rank[b.pane] || a.order - b.order);
}

// Normalize-on-read: individual malformed entries are dropped and the rest of
// the list survives, matching the workspace document's own resilience.
export function normalizeStudies(value: unknown): StudyInstance[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: StudyInstance[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (!isRecord(entry) || typeof entry.id !== 'string' || seen.has(entry.id)) {
			continue;
		}
		const candidate = { ...entry, order: typeof entry.order === 'number' ? entry.order : 0 };
		if (validateStudyInstance(candidate, 'study').length > 0) {
			continue;
		}
		seen.add(entry.id);
		out.push(copyStudy(candidate as unknown as StudyInstance));
	}
	return renumber(sortStudiesForDisplay(out));
}
