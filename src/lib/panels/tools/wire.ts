// Snake_case wire shapes <-> camelCase use-case shapes. Every tool input
// key is snake_case (matching EPIC-1006's existing tools); the use-case
// layer stays camelCase throughout. This module is the one place that
// boundary is crossed.
import type { GridRect } from '../domain/grid';
import type { MutationContext } from '../../workbench/domain/mutation';
import type { OccupiedRect } from '../domain/layout';

export interface WireGridRect {
	col: number;
	row: number;
	col_span: number;
	row_span: number;
}

export function fromWireRect(rect: WireGridRect): GridRect {
	return { col: rect.col, row: rect.row, colSpan: rect.col_span, rowSpan: rect.row_span };
}

export function toWireRect(rect: GridRect): WireGridRect {
	return { col: rect.col, row: rect.row, col_span: rect.colSpan, row_span: rect.rowSpan };
}

export interface WireOccupiedRect {
	panel_id: string;
	rect: WireGridRect;
}

export function toWireOccupiedRect(occupied: OccupiedRect): WireOccupiedRect {
	return { panel_id: occupied.panelId, rect: toWireRect(occupied.rect) };
}

// Every revisioned tool accepts these two fields; maximize_panel is the
// one exception (T-1007-4 AC10) and never calls this.
export function parseContext(input: {
	expected_revision?: unknown;
	idempotency_key?: unknown;
}): MutationContext {
	return {
		expectedRevision:
			typeof input.expected_revision === 'number' ? input.expected_revision : undefined,
		idempotencyKey: typeof input.idempotency_key === 'string' ? input.idempotency_key : undefined,
		actor: 'agent'
	};
}
