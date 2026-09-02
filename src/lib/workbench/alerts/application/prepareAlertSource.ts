// Resolving an alert's source from wire input, and checking whether it is
// previewable (T-1014-8, AC1, AC8). Shared by create_alert_draft and
// edit_alert_draft so both go through the identical structural checks and the
// identical not-previewable check -- one place a caller reaching either
// operation directly, or through the tool, gets the same protection.
//
// `alertSourceIssues` is synchronous (usable from an OperationDefinition's own
// `validate()`, which cannot be async) and `computeAlertPreviewability` is
// async (it calls EPIC-1009's `validateScreenerDefinition`), so a tool calls
// both in an async "prepare" phase before handing a fully-resolved,
// synchronous input to `applyOperations` -- the same two-phase shape
// chart/application/captureSetup.ts's `prepareCapture` uses.
import type { CatalogRegistry } from '../../../catalog/registry';
import { normalizeCondition, type Condition } from '../../../screener/conditions';
import { validateScreenerDefinition } from '../../../screener/screenerValidation';
import type { WorkspaceDocument } from '../../domain/workspace';
import type { AlertConditionSource } from '../domain/alert';
import { snapshotScreenerSource } from '../domain/alert';
import { toEvaluableDefinition } from '../domain/alertConditions';

export interface AlertSourceWireInput {
	screener_id?: unknown;
	conditions?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function conditionIssues(value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		return ['conditions: expected a non-empty array of typed conditions.'];
	}
	const issues: string[] = [];
	value.forEach((entry, index) => {
		if (!normalizeCondition(entry)) {
			const type = isRecord(entry) ? String(entry.type) : String(entry);
			issues.push(`conditions[${index}]: "${type}" is not a recognized typed condition.`);
		}
	});
	return issues;
}

// Structural issues only -- whether the request names a usable source at
// all. Previewability (AC8) is a separate, async concern computed once the
// source is known to be structurally sound.
export function alertSourceIssues(input: AlertSourceWireInput, doc: WorkspaceDocument): string[] {
	const hasScreenerId = input.screener_id !== undefined;
	const hasConditions = input.conditions !== undefined;
	if (hasScreenerId === hasConditions) {
		return [
			'Exactly one of screener_id or conditions must be given: a screener revision or a set of ' +
				'typed conditions, never both and never neither.'
		];
	}
	if (hasScreenerId) {
		if (typeof input.screener_id !== 'string' || input.screener_id.length === 0) {
			return ['screener_id: expected a screener id.'];
		}
		return snapshotScreenerSource(doc, input.screener_id)
			? []
			: [`screener_id: "${input.screener_id}" is not a screener in this workspace.`];
	}
	return conditionIssues(input.conditions);
}

// Only valid once `alertSourceIssues` returns no issues for the same input.
export function resolveAlertSource(
	input: AlertSourceWireInput,
	doc: WorkspaceDocument
): AlertConditionSource {
	if (typeof input.screener_id === 'string') {
		const snapshot = snapshotScreenerSource(doc, input.screener_id);
		if (!snapshot) {
			throw new Error(`resolveAlertSource: screener "${input.screener_id}" does not exist.`);
		}
		return snapshot;
	}
	const conditions = (input.conditions as unknown[])
		.map((entry) => normalizeCondition(entry))
		.filter((c): c is Condition => c !== null);
	return { kind: 'conditions', conditions };
}

export interface AlertPreviewability {
	previewable: boolean;
	previewProblems: string[];
}

// Reuses EPIC-1009's validate_screener detection wholesale (AC8): a
// contradiction or an unavailable-data reference is exactly what
// `validateScreenerDefinition` already reports as a blocking problem. Only
// blocking problems mark a draft not-previewable -- an advisory (e.g. the
// cost-budget warning) never gates a draft's previewability, since AC8 is
// specifically about unavailable data and contradictory conditions.
export async function computeAlertPreviewability(
	source: AlertConditionSource,
	workspaceId: string,
	options?: { registry?: CatalogRegistry }
): Promise<AlertPreviewability> {
	const definition = toEvaluableDefinition(source, workspaceId);
	const report = await validateScreenerDefinition(definition, {
		...(options?.registry ? { registry: options.registry } : {})
	});
	return {
		previewable: report.valid,
		previewProblems: report.problems
			.filter((problem) => problem.severity === 'blocking')
			.map((problem) => problem.message)
	};
}
