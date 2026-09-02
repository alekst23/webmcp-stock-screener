// The `preview_alert` tool (T-1014-8, AC4-8, AC12). Modeled on
// get_chart_data.ts: a read, so it rejects expected_revision outright (there
// is no revision for it to guard) and never touches applyOperations,
// ChangeHistory, or anything else that writes.
import { fail, ok } from '../../../webmcp/tools';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import {
	previewAlert as previewAlertUseCase,
	type PreviewAlertDeps
} from '../application/previewAlert';
import { toWireAlert } from '../domain/alert';
import type { AlertPreviewReport } from '../domain/alertPreview';

export const PREVIEW_ALERT_TOOL_NAME = 'preview_alert';

interface WireInput {
	workspace_id?: string;
	alert_id?: string;
	window?: { start?: string; end?: string };
	expected_revision?: unknown;
}

function invalid(message: string, error = 'invalid_request'): ToolResult {
	return fail(message, { error, message });
}

function toWireReport(report: AlertPreviewReport) {
	return {
		window: report.window,
		evaluated_days: report.evaluatedDays,
		firing_count: report.firingCount,
		firing_rate: report.firingRate,
		noisy: report.noisy,
		noise_threshold: report.noiseThreshold,
		instruments: report.instruments,
		firings: report.firings.map((f) => ({ instrument_id: f.instrumentId, fired_at: f.firedAt })),
		firings_truncated: report.firingsTruncated,
		warnings: report.warnings
	};
}

function previewAlert(deps: PreviewAlertDeps) {
	return async (rawInput: unknown): Promise<ToolResult> => {
		const input = (rawInput ?? {}) as WireInput;
		if (input.expected_revision !== undefined) {
			return invalid(
				`${PREVIEW_ALERT_TOOL_NAME} is a read and takes no expected_revision: it changes no state, ` +
					'so there is no revision for it to guard.',
				'read_only_tool'
			);
		}
		if (typeof input.alert_id !== 'string' || input.alert_id.length === 0) {
			return invalid('alert_id: expected the stable ID of an alert draft.');
		}
		const outcome = await previewAlertUseCase(deps, input.workspace_id, {
			alertId: input.alert_id,
			...(input.window !== undefined ? { window: input.window } : {})
		});
		if (!outcome.ok) {
			return fail(outcome.message, {
				error: outcome.reason,
				message: outcome.message
			});
		}
		if (outcome.kind === 'not_previewable') {
			return ok({
				alert_id: outcome.alert.alertId,
				alert: toWireAlert(outcome.alert),
				previewable: false,
				preview_problems: outcome.problems
			});
		}
		return ok({
			alert_id: outcome.alert.alertId,
			alert: toWireAlert(outcome.alert),
			previewable: true,
			preview_problems: [],
			...toWireReport(outcome.report),
			warnings: [...outcome.warnings, ...outcome.report.warnings]
		});
	};
}

const DESCRIPTION =
	'Previews an alert draft over a recent historical window: the firing count, the firing rate ' +
	'(fires per evaluated trading day), and the instruments and dates it would have fired on. Never ' +
	"arms anything and never changes the draft's state -- previewing is read-only and emits no " +
	'notification. Zero firings is reported plainly, not as an error. A firing rate above the ' +
	'configured noise threshold is flagged as noisy, with the observed rate stated. A draft ' +
	'referencing unavailable data or contradictory conditions is reported as not previewable, naming ' +
	'the specific problem, instead of being evaluated. Window defaults to the trailing 90 days when ' +
	'omitted, and is capped at 365 days -- this is a cheap recent-window read, not a full backtest.';

export function buildPreviewAlertTool(deps: PreviewAlertDeps): ToolSpec {
	return {
		name: PREVIEW_ALERT_TOOL_NAME,
		description: DESCRIPTION,
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string', description: 'Defaults to the active workspace.' },
				alert_id: { type: 'string' },
				window: {
					type: 'object',
					description:
						'Both start and end (ISO dates, inclusive), or omit entirely for the default.',
					properties: {
						start: { type: 'string' },
						end: { type: 'string' }
					}
				}
			},
			required: ['alert_id']
		},
		available: () => true,
		execute: previewAlert(deps)
	};
}
