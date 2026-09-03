// The `export_results` tool (T-1014-10): the wire face of exportResults.ts's
// bounded, provenance-carrying export. Accepts a pinned run_id directly
// (unlike get_screener_results, this tool is not panel-bound -- the ticket's
// AC1 is explicit that a run_id is the input). Writes nothing to disk and
// calls no external service (AC9): it only returns a JSON payload for the
// app to offer as a download. Read-only with respect to workspace state
// (AC10): no mutation envelope, no expected_revision, no idempotency_key,
// no undo_token -- there is nothing here to undo.
import { fail, ok } from '../../../webmcp/toolResult';
import type { ToolResult, ToolSpec } from '../../../webmcp/types';
import type { RunNotAvailable } from '../../../screener/ports';
import type { TickerResolver } from '../../../results/domain/page';
import {
	RESULTS_TABLE_CONFIG_SCHEMA,
	parseWireResultsTableConfig
} from '../../../results/application/tableConfigWire';
import type { ResultsTableConfig } from '../../../results/domain/tableConfig';
import { toWireScreenerRunExport } from '../domain/exportRun';
import { exportResults, type ExportResultsOutcome } from '../application/exportResults';
import type { PinnedRunStore } from '../../../screener/ports';
import type { ExportIdGenerator } from '../domain/exportId';

export const EXPORT_RESULTS_TOOL_NAME = 'export_results';

// The suffix results/tools/resultsTools.ts's own RUN_AGAIN_SUFFIX uses for
// the same "run not available" condition, reworded for export: exporting
// never re-runs the screener itself (AC5), but a fresh run can always be
// exported afresh under its own run_id.
const RUN_AGAIN_SUFFIX =
	' Run the screener again and export the new run_id if you need current results.';

export interface ExportResultsDeps {
	runs: PinnedRunStore;
	// Absent resolves to "no ticker available", matching
	// getScreenerResults.ts's own default.
	resolveTicker?: TickerResolver;
	now?: () => Date;
	nextExportId?: ExportIdGenerator;
}

interface WireInput {
	run_id?: unknown;
	table_config?: unknown;
	columns?: unknown;
	limit?: unknown;
	cursor?: unknown;
}

function isRunNotAvailable(value: ExportResultsOutcome): value is RunNotAvailable {
	return typeof value === 'object' && value !== null && 'available' in value;
}

function isRejected(
	value: ExportResultsOutcome
): value is Extract<ExportResultsOutcome, { rejected: true }> {
	return typeof value === 'object' && value !== null && 'rejected' in value;
}

function failWithCode(
	code: string,
	message: string,
	details: Record<string, unknown> = {}
): ToolResult {
	return fail(message, { error: code, message, ...details });
}

function parseTableConfig(
	raw: unknown
): { ok: true; config: ResultsTableConfig | undefined } | { ok: false; result: ToolResult } {
	if (raw === undefined) {
		return { ok: true, config: undefined };
	}
	const parsed = parseWireResultsTableConfig(raw);
	if (!parsed.ok) {
		return {
			ok: false,
			result: failWithCode('invalid_table_config', '"table_config" is invalid.', {
				errors: parsed.errors
			})
		};
	}
	return { ok: true, config: parsed.config };
}

function parseColumnIds(
	raw: unknown
): { ok: true; columnIds: string[] | undefined } | { ok: false } {
	if (raw === undefined) {
		return { ok: true, columnIds: undefined };
	}
	if (!Array.isArray(raw) || !raw.every((item): item is string => typeof item === 'string')) {
		return { ok: false };
	}
	return { ok: true, columnIds: raw };
}

export function buildExportResultsTool(deps: ExportResultsDeps): ToolSpec {
	return {
		name: EXPORT_RESULTS_TOOL_NAME,
		description:
			"Exports a pinned screener run's rows together with everything needed to understand and " +
			'reproduce them: the exact filter tree and ranking the run executed, the universe, the ' +
			'run id and timestamp, and the full market-data provenance envelope (as_of, source, ' +
			'live/delayed status, timezone, currency, price adjustment, fundamentals reporting ' +
			'period where applicable, and calculation-engine version). Optionally scoped to a subset ' +
			'of table_config columns, including computed columns. Bounded per call (default 500 rows, ' +
			'maximum 5000); a next_cursor in the response continues a larger export. Read-only: it ' +
			'never re-runs the screener, even implicitly -- an unknown or expired run_id is reported ' +
			'as an explicit error, not covered by a fresh execution. Writes nothing to disk and calls ' +
			'no external service; the app offers the returned payload to the researcher as a download.',
		inputSchema: {
			type: 'object',
			properties: {
				run_id: {
					type: 'string',
					description: 'A pinned screener run, as returned by run_screener.'
				},
				table_config: {
					...RESULTS_TABLE_CONFIG_SCHEMA,
					description:
						'Optional results-table configuration to project rows through (same shape ' +
						'get_screener_results accepts). Omit for the base identity columns only.'
				},
				columns: {
					type: 'array',
					items: { type: 'string' },
					description:
						'Optional subset of table_config.columns ids to include; omit to include every ' +
						'configured column.'
				},
				limit: {
					type: 'number',
					description: 'Rows per export call, up to 5000. Defaults to 500.'
				},
				cursor: {
					type: 'string',
					description:
						"Opaque resume token from a previous export's selection.next_cursor. Omit for " +
						'the first slice.'
				}
			},
			required: ['run_id']
		},
		available: () => true,
		execute: async (rawInput: unknown): Promise<ToolResult> => {
			const input = (rawInput ?? {}) as WireInput;
			if (typeof input.run_id !== 'string' || input.run_id.length === 0) {
				return fail('"run_id" is required.');
			}

			const tableConfigResult = parseTableConfig(input.table_config);
			if (!tableConfigResult.ok) {
				return tableConfigResult.result;
			}

			const columnsResult = parseColumnIds(input.columns);
			if (!columnsResult.ok) {
				return fail('"columns" must be an array of column id strings.');
			}

			const outcome = exportResults(
				deps.runs,
				{
					runId: input.run_id,
					tableConfig: tableConfigResult.config,
					columnIds: columnsResult.columnIds,
					limit: typeof input.limit === 'number' ? input.limit : undefined,
					cursor: typeof input.cursor === 'string' ? input.cursor : undefined
				},
				{ resolveTicker: deps.resolveTicker, now: deps.now, nextExportId: deps.nextExportId }
			);

			if (isRunNotAvailable(outcome)) {
				return failWithCode(outcome.reason, `${outcome.message}${RUN_AGAIN_SUFFIX}`, {
					run_id: outcome.runId
				});
			}
			if (isRejected(outcome)) {
				const { message, reason, ...rest } = outcome;
				// unknown_columns is this ticket's own rejection shape (the others
				// -- limit/cursor rejections -- are shared types reused verbatim
				// elsewhere in the wire, matching resultsTools.ts's own precedent
				// for page_size/cursor rejections), so its one camelCase field is
				// snake-cased here rather than left inconsistent with every other
				// key this tool returns.
				const details =
					'columnIds' in rest ? { column_ids: (rest as { columnIds: string[] }).columnIds } : rest;
				return failWithCode(reason, message, details);
			}
			return ok(toWireScreenerRunExport(outcome));
		}
	};
}
