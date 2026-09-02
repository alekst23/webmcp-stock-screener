// The alert record (T-1014-8): what `create_alert_draft` writes and every
// other alert tool reads. Mirrors chart/domain/capturedSetup.ts's
// self-contained-record pattern (a screener-bound alert freezes the filter
// tree and universe it was drafted against, rather than holding a live
// reference) and screener/state.ts's extension-key storage convention.
//
// Domain layer: pure construction, normalization and serialization. No I/O.
import type { ResourceId } from '../../domain/ids';
import { parseId } from '../../domain/ids';
import type { Revision, WorkspaceDocument } from '../../domain/workspace';
import { normalizeCondition, type Condition } from '../../../screener/conditions';
import type { FilterNode, UniverseSpec } from '../../../screener/definition';
import { normalizeUniverse } from '../../../screener/definition';
import { readScreener } from '../../../screener/state';
import { ALERT_STATES, INITIAL_ALERT_STATE, type AlertState } from './alertStateMachine';

export const ALERT_EXTENSION_KEY = 'alerts';

// A screener-bound alert's source is a frozen snapshot taken at draft-create
// or draft-edit time -- not a live reference into the screener. Reconfiguring
// or re-editing the source screener afterwards never changes an already-drawn
// snapshot, matching CapturedChartSetup's self-containment guarantee.
export interface ScreenerRevisionSource {
	kind: 'screener_revision';
	screenerId: ResourceId;
	screenerRevision: Revision;
	filterTree: FilterNode;
	universe: UniverseSpec;
}

// A flat set of EPIC-1009 typed conditions, implicitly ANDed together.
export interface TypedConditionsSource {
	kind: 'conditions';
	conditions: Condition[];
}

export type AlertConditionSource = ScreenerRevisionSource | TypedConditionsSource;

export interface AlertRecord {
	alertId: ResourceId;
	workspaceId: ResourceId;
	name: string;
	state: AlertState;
	source: AlertConditionSource;
	// Computed by the not-previewable check (AC8) at create/edit time and
	// simply read back by preview_alert -- never recomputed on a read, so a
	// preview can never disagree with the mark stored on the draft.
	previewable: boolean;
	previewProblems: string[];
	createdAt: string;
	updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeConditionArray(value: unknown): Condition[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: Condition[] = [];
	for (const item of value) {
		const condition = normalizeCondition(item);
		if (condition) {
			out.push(condition);
		}
	}
	return out;
}

function isFilterNodeShaped(value: unknown): value is FilterNode {
	return isRecord(value) && typeof value.nodeId === 'string' && typeof value.kind === 'string';
}

// Never throws: a corrupt or foreign persisted source normalizes to an empty
// typed-conditions source rather than breaking the whole alert record.
function normalizeSource(value: unknown): AlertConditionSource {
	const source = isRecord(value) ? value : {};
	if (source.kind === 'screener_revision' && isFilterNodeShaped(source.filterTree)) {
		return {
			kind: 'screener_revision',
			screenerId: typeof source.screenerId === 'string' ? source.screenerId : '',
			screenerRevision:
				typeof source.screenerRevision === 'number' && source.screenerRevision > 0
					? source.screenerRevision
					: 1,
			filterTree: source.filterTree,
			universe: normalizeUniverse(source.universe)
		};
	}
	return { kind: 'conditions', conditions: normalizeConditionArray(source.conditions) };
}

// A faithful reader of whatever state is actually stored: T-1014-9 writes
// pending_activation, armed and disarmed records this same normalizer must
// read back correctly, so this cannot be the layer that enforces "only
// draft". That guarantee belongs to the *write* path instead -- every
// operation in this ticket hard-codes the literal 'draft' in its apply(),
// never reading a state from its input at all, so there is no write path
// here for this function's leniency to be exploited through. An
// unrecognized string still repairs to the safe default rather than being
// trusted verbatim.
function normalizeState(value: unknown): AlertState {
	return (ALERT_STATES as readonly string[]).includes(value as string)
		? (value as AlertState)
		: INITIAL_ALERT_STATE;
}

export function normalizeAlert(value: unknown): AlertRecord | null {
	if (!isRecord(value) || typeof value.alertId !== 'string' || value.alertId.length === 0) {
		return null;
	}
	return {
		alertId: value.alertId,
		workspaceId: typeof value.workspaceId === 'string' ? value.workspaceId : '',
		name: typeof value.name === 'string' ? value.name : '',
		state: normalizeState(value.state),
		source: normalizeSource(value.source),
		previewable: value.previewable !== false,
		previewProblems: Array.isArray(value.previewProblems)
			? value.previewProblems.filter((p): p is string => typeof p === 'string')
			: [],
		createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : ''
	};
}

function alertMap(doc: WorkspaceDocument): Record<string, unknown> {
	const raw = doc.extensions[ALERT_EXTENSION_KEY];
	return isRecord(raw) ? raw : {};
}

export function readAlert(doc: WorkspaceDocument, alertId: ResourceId): AlertRecord | null {
	const raw = alertMap(doc)[alertId];
	if (raw === undefined) {
		return null;
	}
	const normalized = normalizeAlert(raw);
	return normalized && normalized.alertId === alertId ? normalized : null;
}

export function readAlerts(doc: WorkspaceDocument): AlertRecord[] {
	const out: AlertRecord[] = [];
	for (const entry of Object.values(alertMap(doc))) {
		const alert = normalizeAlert(entry);
		if (alert) {
			out.push(alert);
		}
	}
	return out;
}

// Pure: never mutates `doc`. Used for both create (new alertId) and edit
// (existing alertId, replacing its entry) -- the caller decides which by
// what alertId it passes.
export function writeAlert(doc: WorkspaceDocument, alert: AlertRecord): WorkspaceDocument {
	const map = { ...alertMap(doc), [alert.alertId]: alert };
	return { ...doc, extensions: { ...doc.extensions, [ALERT_EXTENSION_KEY]: map } };
}

export function alertIdSeed(doc: WorkspaceDocument | null): Record<string, number> {
	if (!doc) {
		return {};
	}
	const seed: Record<string, number> = {};
	for (const alertId of Object.keys(alertMap(doc))) {
		const parsed = parseId(alertId);
		if (!parsed || parsed.kind !== 'alert') {
			continue;
		}
		const key = parsed.discriminator ? `alert:${parsed.discriminator}` : 'alert';
		seed[key] = Math.max(seed[key] ?? 0, parsed.sequence);
	}
	return seed;
}

function toWireCondition(condition: Condition): Record<string, unknown> {
	// Typed conditions are already a plain, JSON-safe shape -- camelCase field
	// names are the one exception the epic's typed-condition contract keeps
	// (conditions.ts is shared verbatim with the screener's own wire format).
	return condition as unknown as Record<string, unknown>;
}

function toWireSource(source: AlertConditionSource): Record<string, unknown> {
	if (source.kind === 'screener_revision') {
		return {
			kind: 'screener_revision',
			screener_id: source.screenerId,
			screener_revision: source.screenerRevision,
			filter_tree: source.filterTree,
			universe: source.universe
		};
	}
	return { kind: 'conditions', conditions: source.conditions.map(toWireCondition) };
}

export function toWireAlert(alert: AlertRecord): Record<string, unknown> {
	return {
		alert_id: alert.alertId,
		name: alert.name,
		state: alert.state,
		armed: false,
		source: toWireSource(alert.source),
		previewable: alert.previewable,
		preview_problems: alert.previewProblems,
		created_at: alert.createdAt,
		updated_at: alert.updatedAt
	};
}

// Snapshots the *current* screener's filter tree, universe and revision into a
// frozen ScreenerRevisionSource. Returns null when the named screener does not
// exist in this workspace -- the caller turns that into a validation issue.
export function snapshotScreenerSource(
	doc: WorkspaceDocument,
	screenerId: ResourceId
): ScreenerRevisionSource | null {
	const screener = readScreener(doc, screenerId);
	if (!screener) {
		return null;
	}
	return {
		kind: 'screener_revision',
		screenerId: screener.screenerId,
		screenerRevision: screener.revision,
		filterTree: screener.filterTree,
		universe: screener.universe
	};
}

// An alert bound to a screener revision needs defined behaviour when that
// revision is superseded (this ticket's Technical Considerations). The
// defined behaviour here: the alert keeps evaluating its frozen snapshot
// (self-contained, like a captured chart setup), and this function makes the
// staleness fact available for a caller -- preview_alert surfaces it as a
// warning -- rather than silently hiding it. Acting on it (invalidating a
// pending activation request) is T-1014-9's job.
export function isScreenerSourceSuperseded(
	source: AlertConditionSource,
	doc: WorkspaceDocument
): boolean {
	if (source.kind !== 'screener_revision') {
		return false;
	}
	const current = readScreener(doc, source.screenerId);
	return current !== null && current.revision > source.screenerRevision;
}
