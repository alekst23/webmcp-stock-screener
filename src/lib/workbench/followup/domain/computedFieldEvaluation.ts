// Batch, per-row evaluation of a computed field (T-1014-2, AC8). Reuses
// T-1014-1's expressionEvaluator.ts unchanged -- this module's only job is
// the batching/counting/warning-message layer on top: collecting each row's
// EvaluatedValue into a wire-safe "not available" column value, and
// producing the run-level warning noting how many rows were affected.
//
// This is the reusable primitive expressionEvaluator.ts's own comment
// anticipates ("wiring a real, panel-data-backed context is T-1014-2's...
// concern"). Wiring it into run_screener's actual per-instrument loop is
// screener/engine/engine.ts (EPIC-1009, already merged) -- deliberately not
// done here; see the ticket's Solution Approach.
//
// Domain layer: no I/O. Depends only on T-1014-1's evaluator port.
import type { ResourceId } from '../../domain/ids';
import type { ComputedFieldRecord } from './computedField';
import { evaluateExpression, type ExpressionEvaluationContext } from './expressionEvaluator';
import type { LiteralValue } from './expressionModel';

export type ComputedFieldCellValue = LiteralValue | null;

export interface ComputedFieldRowResult {
	values: Map<string, ComputedFieldCellValue>;
	unavailableCount: number;
	totalCount: number;
}

// Mirrors screener/run.ts's ScreenerWarning shape (structurally -- this
// module does not import it, to keep the domain layer free of that
// cross-epic dependency) so a caller wiring this into a real run can spread
// the result directly into `warnings` without reshaping it.
export interface ComputedFieldWarning {
	code: 'computed_field_unavailable';
	message: string;
	nodeIds?: ResourceId[];
}

export interface RowInput {
	instrumentId: string;
	context: ExpressionEvaluationContext;
}

// `null` (never a fabricated 0/""/false) is this module's own "not
// available" wire value for a row -- matching expressionEvaluator.ts's own
// convention.
export function evaluateComputedFieldForRows(
	field: ComputedFieldRecord,
	rows: readonly RowInput[]
): ComputedFieldRowResult {
	const values = new Map<string, ComputedFieldCellValue>();
	let unavailableCount = 0;
	for (const row of rows) {
		const outcome = evaluateExpression(field.expression, row.context);
		if (outcome.available) {
			values.set(row.instrumentId, outcome.value);
		} else {
			values.set(row.instrumentId, null);
			unavailableCount += 1;
		}
	}
	return { values, unavailableCount, totalCount: rows.length };
}

// null when every row was available -- absence, not an empty-but-present
// warning, matching this area's "no warning at all beats a warning nobody
// needs to act on" convention.
export function computedFieldUnavailableWarning(
	field: ComputedFieldRecord,
	result: ComputedFieldRowResult
): ComputedFieldWarning | null {
	if (result.unavailableCount === 0) {
		return null;
	}
	return {
		code: 'computed_field_unavailable',
		message:
			`Computed field "${field.name}" (${field.id}) was not available for ` +
			`${result.unavailableCount} of ${result.totalCount} row(s): missing data or an ` +
			'undefined operation (e.g. division by zero) for that instrument.'
	};
}
