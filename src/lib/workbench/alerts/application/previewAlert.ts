// The `preview_alert` use case (T-1014-8, AC4-8, AC12). Read-only: no
// operation, no ChangeHistory entry, no mutation envelope -- previewing
// cannot change an alert's state or emit a notification by construction,
// because this module never calls into anything that writes.
import type { WorkspaceDocument } from '../../domain/workspace';
import { readAlert, isScreenerSourceSuperseded, type AlertRecord } from '../domain/alert';
import { toEvaluableDefinition } from '../domain/alertConditions';
import {
	summarizePreview,
	DEFAULT_PREVIEW_WINDOW_DAYS,
	MAX_PREVIEW_WINDOW_DAYS,
	type AlertHistoricalDataPort,
	type AlertPreviewReport,
	type AlertPreviewWindow
} from '../domain/alertPreview';

export interface PreviewAlertRequest {
	alertId: string;
	window?: { start?: string; end?: string };
	noiseThreshold?: number;
}

export type PreviewAlertOutcome =
	| { ok: true; kind: 'not_previewable'; alert: AlertRecord; problems: string[] }
	| {
			ok: true;
			kind: 'evaluated';
			alert: AlertRecord;
			report: AlertPreviewReport;
			warnings: string[];
	  }
	| { ok: false; reason: 'unknown_alert' | 'invalid_window'; message: string };

function defaultWindow(nowIso: string): AlertPreviewWindow {
	const end = new Date(nowIso);
	const start = new Date(end);
	start.setUTCDate(start.getUTCDate() - DEFAULT_PREVIEW_WINDOW_DAYS);
	return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function daysBetween(window: AlertPreviewWindow): number {
	const start = Date.parse(`${window.start}T00:00:00Z`);
	const end = Date.parse(`${window.end}T00:00:00Z`);
	return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function resolveWindow(
	requested: PreviewAlertRequest['window'],
	nowIso: string
): AlertPreviewWindow | { error: string } {
	if (!requested || (requested.start === undefined && requested.end === undefined)) {
		return defaultWindow(nowIso);
	}
	if (requested.start === undefined || requested.end === undefined) {
		return { error: 'window: give both start and end, or omit window entirely for the default.' };
	}
	const window: AlertPreviewWindow = { start: requested.start, end: requested.end };
	const span = daysBetween(window);
	if (!Number.isFinite(span) || span < 0) {
		return { error: `window: end (${window.end}) must not precede start (${window.start}).` };
	}
	if (span > MAX_PREVIEW_WINDOW_DAYS) {
		return {
			error:
				`window: spans ${span} days, above the ${MAX_PREVIEW_WINDOW_DAYS}-day cap. ` +
				'A preview is a bounded recent-window read, not a full backtest.'
		};
	}
	return window;
}

export interface PreviewAlertDeps {
	repository: { get(workspaceId: string): WorkspaceDocument | null; getActiveId(): string | null };
	port: AlertHistoricalDataPort;
	clock: { now(): string };
}

export async function previewAlert(
	deps: PreviewAlertDeps,
	workspaceId: string | undefined,
	request: PreviewAlertRequest
): Promise<PreviewAlertOutcome> {
	const resolvedWorkspaceId = workspaceId ?? deps.repository.getActiveId();
	const doc = resolvedWorkspaceId ? deps.repository.get(resolvedWorkspaceId) : null;
	const alert = doc ? readAlert(doc, request.alertId) : null;
	if (!doc || !alert) {
		return {
			ok: false,
			reason: 'unknown_alert',
			message: `Alert "${request.alertId}" is not an alert in this workspace.`
		};
	}

	const window = resolveWindow(request.window, deps.clock.now());
	if ('error' in window) {
		return { ok: false, reason: 'invalid_window', message: window.error };
	}

	// The stored mark, never recomputed here (AC8, AC12): a read must not risk
	// disagreeing with what create/edit already established, and must not do
	// the async validation work again just to answer a read.
	if (!alert.previewable) {
		return { ok: true, kind: 'not_previewable', alert, problems: alert.previewProblems };
	}

	const supersededWarning = isScreenerSourceSuperseded(alert.source, doc)
		? [
				'The source screener has moved to a newer revision since this draft was created; the ' +
					'preview still reflects the filter tree and universe frozen when the draft was made.'
			]
		: [];

	// Reuses the same throwaway-definition builder the not-previewable check
	// (prepareAlertSource.ts) already goes through, so preview never carries a
	// second, potentially drifting notion of "what this alert's filter tree
	// and universe are".
	const definition = toEvaluableDefinition(alert.source, doc.id);
	const instrumentIds = await deps.port.resolveUniverse(definition.universe);
	const evaluation = await deps.port.evaluate({
		instrumentIds,
		filterTree: definition.filterTree,
		window
	});
	const report = summarizePreview({
		window,
		evaluation,
		...(request.noiseThreshold !== undefined ? { noiseThreshold: request.noiseThreshold } : {})
	});
	return { ok: true, kind: 'evaluated', alert, report, warnings: supersededWarning };
}
